-- What: a limit decision can be sent to a named, senior colleague for
--       VALIDATION before it exists — obligatorily when it is beyond the
--       author's authority, voluntarily (a second opinion, with a comment)
--       when it is not.
--         * tci.user_profiles.manager_id   optional direct manager, set by
--                                          admin (set_user_manager); offered
--                                          as the default validator
--         * tci.limit_validations          one row per step of a chain:
--                                          the PROPOSED decision (outcome,
--                                          amount, conditions, rating it rests
--                                          on, comment), who proposed it, who
--                                          must validate it, and how it ended
--                                          (approved / approved_modified /
--                                          returned / rejected / forwarded /
--                                          cancelled). Steps are inserted; a
--                                          step's outcome is written once
--         * credit stream                  decide_limit_request no longer
--                                          escalates an over-authority amount
--                                          to an anonymous pool: it answers
--                                          `needs_validation` and records
--                                          nothing; submit_limit_for_validation
--                                          stores the proposal and parks the
--                                          request as `escalated` with a named
--                                          validator
--         * commercial stream              adjust_limit_commercial answers
--                                          `needs_validation` above authority;
--                                          submit_adjustment_for_validation
--                                          stores the proposal and HOLDS the
--                                          credit decision so neither reaches
--                                          the client meanwhile
--         * resolve_limit_validation       the validator approves (as is or
--                                          modified, within THEIR authority —
--                                          the decision is made through the
--                                          ordinary decide / adjust functions,
--                                          so every guard still applies),
--                                          returns it to the author with a
--                                          comment, rejects it, or forwards it
--                                          to someone senior (a chain of any
--                                          length)
--         * four eyes                      nobody validates a step they
--                                          proposed or validated earlier in the
--                                          same chain
--         * Agenda                         limit_validation (to the validator,
--                                          a person) and limit_validation_result
--                                          (to the author; manual close),
--                                          through a ninth trigger on
--                                          tci.workflow_events
-- Why:  owner request (2026-10-22). Until now an over-authority decision was
--       lost — the request became `escalated` and whoever picked it up
--       decided from scratch — and the commercial stage had no path above
--       authority at all.
--
-- Unchanged on purpose: reductions and revocations (the emergency path) need
-- no validation — a commercial REDUCTION is no longer authority-checked
-- either; a group-limit breach still escalates to the credit pool (0040);
-- admin is unlimited and never needs validation (a voluntary second opinion
-- is still possible). A decision does not exist until validated, so it is
-- not in force, not visible to the client, and the sales window starts only
-- from the validated decision.

-- ---------------------------------------------------------------------------
-- 1. Types, task types, the manager column
-- ---------------------------------------------------------------------------
alter type tci.task_type add value if not exists 'limit_validation';
alter type tci.task_type add value if not exists 'limit_validation_result';

create type tci.validation_status as enum
  ('pending', 'approved', 'approved_modified', 'returned', 'rejected', 'forwarded', 'cancelled');
create type tci.validation_kind as enum ('required', 'voluntary');

alter table tci.user_profiles
  add column manager_id uuid references auth.users (id) on delete set null,
  add constraint user_profiles_manager_not_self check (manager_id is null or manager_id <> user_id);

comment on column tci.user_profiles.manager_id is
  'Direct manager (optional, set by admin through tci.set_user_manager). Offered first as the validator of this person''s limit decisions when they have the authority (0060).';

-- A person reads their own profile row (0022); the manager column is not
-- theirs to write: it changes only through set_user_manager.
revoke update (manager_id) on tci.user_profiles from authenticated;

-- ---------------------------------------------------------------------------
-- 2. The validation chain
-- ---------------------------------------------------------------------------
create table tci.limit_validations (
  id                   uuid primary key default gen_random_uuid(),
  chain_id             uuid not null,
  parent_id            uuid references tci.limit_validations (id),
  request_id           uuid not null references tci.credit_limit_requests (id),
  stream               tci.authority_scope not null,
  kind                 tci.validation_kind not null,
  -- the proposal
  outcome              tci.decision_outcome not null,
  amount               numeric(18,2),
  currency_code        char(3) not null references tci.currencies (code),
  payment_terms_days   integer,
  valid_from           date,
  valid_until          date,
  conditions           jsonb not null default '[]'::jsonb,
  assessment_id        uuid references tci.credit_assessments (id),
  adjusts_decision_id  uuid references tci.credit_limit_decisions (id),
  grade_band           tci.grade_band not null,
  amount_uzs           numeric,
  comment              text,
  -- who
  proposed_by          uuid not null references auth.users (id),
  forwarded_by         uuid references auth.users (id),
  validator_id         uuid not null references auth.users (id),
  -- how it ended
  status               tci.validation_status not null default 'pending',
  resolution_comment   text,
  resolved_by          uuid references auth.users (id),
  resolved_at          timestamptz,
  resulting_decision_id uuid references tci.credit_limit_decisions (id),
  held_credit_decision boolean not null default false,
  created_at           timestamptz not null default now(),

  constraint limit_validations_four_eyes check (validator_id <> proposed_by
                                                and (forwarded_by is null or validator_id <> forwarded_by)),
  constraint limit_validations_stream_shape check (
    (stream = 'credit' and adjusts_decision_id is null)
    or (stream = 'commercial' and adjusts_decision_id is not null and outcome in ('approved', 'partial'))),
  constraint limit_validations_amount check (
    (outcome in ('approved', 'partial') and amount > 0) or (outcome = 'declined' and amount is null)),
  constraint limit_validations_resolution check (
    (status = 'pending') = (resolved_at is null))
);

create index limit_validations_request_idx on tci.limit_validations (request_id);
create index limit_validations_validator_idx on tci.limit_validations (validator_id) where status = 'pending';
create index limit_validations_chain_idx on tci.limit_validations (chain_id);
-- One open step per request (credit and commercial both live on the request).
create unique index limit_validations_one_pending_uq
  on tci.limit_validations (request_id) where status = 'pending';

comment on table tci.limit_validations is
  'Limit decisions awaiting validation by a senior colleague (0060). Each row is one step of a chain (chain_id = the first step); the proposal is stored, the decision is only created when a validator approves it, through decide_limit_request / adjust_limit_commercial.';

alter table tci.credit_limit_decisions
  add column validation_id uuid references tci.limit_validations (id);
comment on column tci.credit_limit_decisions.validation_id is
  'The validation step that approved this decision (0060); null for a decision made within the decider''s own authority.';

-- A step is inserted once and its outcome written once: nothing else changes.
create function tci.guard_limit_validation_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'pending' then
    raise exception 'a resolved validation step is final' using errcode = '42501';
  end if;
  if (new.id, new.chain_id, new.parent_id, new.request_id, new.stream, new.kind, new.outcome,
      new.amount, new.currency_code, new.payment_terms_days, new.valid_from, new.valid_until,
      new.conditions, new.assessment_id, new.adjusts_decision_id, new.grade_band, new.amount_uzs,
      new.comment, new.proposed_by, new.forwarded_by, new.validator_id, new.created_at)
     is distinct from
     (old.id, old.chain_id, old.parent_id, old.request_id, old.stream, old.kind, old.outcome,
      old.amount, old.currency_code, old.payment_terms_days, old.valid_from, old.valid_until,
      old.conditions, old.assessment_id, old.adjusts_decision_id, old.grade_band, old.amount_uzs,
      old.comment, old.proposed_by, old.forwarded_by, old.validator_id, old.created_at) then
    raise exception 'a validation step''s proposal is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger limit_validations_guard
  before update on tci.limit_validations
  for each row execute function tci.guard_limit_validation_update();

-- ---------------------------------------------------------------------------
-- 3. Visibility
-- ---------------------------------------------------------------------------
-- A step is visible to admin and to the people of its own chain (the author,
-- every validator and forwarder in it) — nobody else browses validations.
-- SECURITY DEFINER: the predicate reads the same table and would recurse.
create function tci.is_validation_participant(p_chain_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from tci.limit_validations v
     where v.chain_id = p_chain_id
       and (select auth.uid()) in (v.proposed_by, v.validator_id, v.forwarded_by))
$$;

alter table tci.limit_validations enable row level security;
create policy "limit_validations: admin and the chain"
  on tci.limit_validations for select to authenticated
  using (tci.has_role('admin') or (tci.is_staff() and tci.is_validation_participant(chain_id)));

grant select on tci.limit_validations to authenticated;
grant select on tci.limit_validations to service_role;

-- ---------------------------------------------------------------------------
-- 4. Authority helpers
-- ---------------------------------------------------------------------------
-- A person's authority in UZS for a stream and band: admin is unlimited
-- (Infinity), otherwise the MAX over their currently valid grants, grants in a
-- currency with no rate skipped (as in v_limit_request_queue).
create function tci.user_authority_uzs(p_user uuid, p_stream tci.authority_scope, p_band tci.grade_band)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from tci.user_roles r where r.user_id = p_user and r.role = 'admin')
      then 'Infinity'::numeric
    else coalesce((
      select max(g.max_amount * tci.latest_uzs_rate(g.currency_code))
        from tci.authority_grants g
       where g.user_id = p_user
         and g.applies_to = p_stream
         and g.grade_band = p_band
         and g.valid_from <= current_date
         and (g.valid_to is null or g.valid_to >= current_date)
         and tci.latest_uzs_rate(g.currency_code) is not null), 0)
  end
$$;

-- The department a stream belongs to.
create function tci.validation_role(p_stream tci.authority_scope)
returns tci.user_role
language sql
immutable
set search_path = ''
as $$
  select case p_stream when 'credit' then 'credit_underwriter'::tci.user_role
                       else 'commercial_underwriter'::tci.user_role end
$$;

-- Who may validate a proposal of this size in this band: holds the stream's
-- department role, is active, has the authority (admin who also holds the
-- role: unlimited), and is not the caller or anyone already in the chain.
create function tci.validation_candidates(
  p_stream   tci.authority_scope,
  p_band     tci.grade_band,
  p_amount   numeric,
  p_currency char(3),
  p_chain_id uuid default null)
returns table (user_id uuid, full_name text, email text, is_manager boolean, authority_uzs numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me        uuid := (select auth.uid());
  v_manager   uuid;
  v_needed    numeric;
begin
  perform tci.require_role('admin', 'credit_underwriter', 'commercial_underwriter');
  select p.manager_id into v_manager from tci.user_profiles p where p.user_id = v_me;
  v_needed := case when p_amount is null then 0 else tci.to_uzs(p_amount, p_currency) end;

  return query
    select u.id, p.full_name, u.email::text, (u.id = v_manager) as is_manager,
           tci.user_authority_uzs(u.id, p_stream, p_band)
      from auth.users u
      join tci.user_roles r on r.user_id = u.id and r.role = tci.validation_role(p_stream)
      left join tci.user_profiles p on p.user_id = u.id
     where u.deleted_at is null
       and (u.banned_until is null or u.banned_until <= now())
       and u.id <> v_me
       and not exists (select 1 from tci.limit_validations v
                        where p_chain_id is not null and v.chain_id = p_chain_id
                          and u.id in (v.proposed_by, v.validator_id, v.forwarded_by))
       and tci.user_authority_uzs(u.id, p_stream, p_band) >= v_needed
     order by (u.id = v_manager) desc, p.full_name nulls last, u.email;
end;
$$;

comment on function tci.validation_candidates(tci.authority_scope, tci.grade_band, numeric, char, uuid) is
  'Colleagues of the stream''s department whose authority covers the amount in that band, the caller''s direct manager first; never the caller or anyone already in the chain (0060).';

-- Admin sets (or clears) a person's direct manager.
create function tci.set_user_manager(p_user uuid, p_manager uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform tci.require_role('admin');
  if p_manager is not null and p_manager = p_user then
    raise exception 'manager_is_self: a person cannot be their own manager' using errcode = 'P0001';
  end if;
  if p_manager is not null and not exists (
       select 1 from tci.user_roles r where r.user_id = p_manager and r.role <> 'client') then
    raise exception 'manager_not_staff: the manager must be a staff member' using errcode = 'P0001';
  end if;
  insert into tci.user_profiles (user_id, manager_id, must_change_password)
  values (p_user, p_manager, false)
  on conflict (user_id) do update set manager_id = excluded.manager_id;
end;
$$;

-- Managers of everyone, for the admin users screen.
create function tci.user_managers()
returns table (user_id uuid, manager_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_role('admin');
  return query select p.user_id, p.manager_id from tci.user_profiles p where p.manager_id is not null;
end;
$$;

-- What any colleague who can see the request may know: it is on validation,
-- with whom, since when — never the proposal.
create function tci.limit_request_validation_state(p_request_ids uuid[])
returns table (request_id uuid, validation_id uuid, stream tci.authority_scope, kind tci.validation_kind,
               validator_id uuid, validator_name text, since timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff();
  return query
    select v.request_id, v.id, v.stream, v.kind, v.validator_id,
           coalesce(p.full_name, u.email::text), v.created_at
      from tci.limit_validations v
      join auth.users u on u.id = v.validator_id
      left join tci.user_profiles p on p.user_id = v.validator_id
     where v.status = 'pending' and v.request_id = any (p_request_ids);
end;
$$;

-- The chain of a request with names, for its history panel: admin and the
-- people of the chain only (the table's own rule).
create function tci.limit_validation_history(p_request_id uuid)
returns table (id uuid, chain_id uuid, parent_id uuid, stream tci.authority_scope, kind tci.validation_kind,
               outcome tci.decision_outcome, amount numeric, currency_code char(3), payment_terms_days integer,
               grade_band tci.grade_band, comment text,
               proposed_by uuid, proposed_by_name text, forwarded_by uuid, forwarded_by_name text,
               validator_id uuid, validator_name text,
               status tci.validation_status, resolution_comment text, resolved_at timestamptz,
               resulting_decision_id uuid, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff();
  return query
    select v.id, v.chain_id, v.parent_id, v.stream, v.kind, v.outcome, v.amount, v.currency_code,
           v.payment_terms_days, v.grade_band, v.comment,
           v.proposed_by, tci.staff_name(v.proposed_by),
           v.forwarded_by, tci.staff_name(v.forwarded_by),
           v.validator_id, tci.staff_name(v.validator_id),
           v.status, v.resolution_comment, v.resolved_at, v.resulting_decision_id, v.created_at
      from tci.limit_validations v
     where v.request_id = p_request_id
       and (tci.has_role('admin') or tci.is_validation_participant(v.chain_id))
     order by v.created_at;
end;
$$;

-- A colleague's display name (full name, else e-mail). Closed to the API.
create function tci.staff_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_user is null then null
              else coalesce((select p.full_name from tci.user_profiles p where p.user_id = p_user),
                            (select u.email::text from auth.users u where u.id = p_user)) end
$$;

-- ---------------------------------------------------------------------------
-- 5. decide_limit_request: over authority asks for validation; a request on
--    validation is decided only by its validator, through resolve
-- ---------------------------------------------------------------------------
-- The validation step being resolved in THIS transaction, set by
-- resolve_limit_validation just before it calls decide / adjust.
create function tci.resolving_validation()
returns uuid
language sql
stable
set search_path = ''
as $$ select nullif(current_setting('tci.resolving_validation', true), '')::uuid $$;

-- The pending step of a request, whoever asks: decide / adjust run as the
-- CALLER, whose RLS may hide the chain — and a step hidden from a colleague
-- must still stop them deciding over it. Token-gated (both callers set it).
create function tci.pending_validation_of(p_request_id uuid, p_stream tci.authority_scope)
returns table (id uuid, validator_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_internal_call();
  return query
    select v.id, v.validator_id from tci.limit_validations v
     where v.request_id = p_request_id and v.status = 'pending' and v.stream = p_stream;
end;
$$;

create or replace function tci.decide_limit_request(p_request_id uuid, p_outcome tci.decision_outcome, p_amount numeric DEFAULT NULL::numeric, p_currency character DEFAULT NULL::bpchar, p_valid_from date DEFAULT CURRENT_DATE, p_valid_until date DEFAULT NULL::date, p_conditions jsonb DEFAULT '[]'::jsonb, p_comment text DEFAULT NULL::text, p_assessment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_request  tci.credit_limit_requests%rowtype;
  v_currency char(3);
  v_decision tci.credit_limit_decisions%rowtype;
  v_band     tci.grade_band;
  v_amount_uzs numeric;
  v_authority_uzs numeric;
  v_condition jsonb;
  v_group    jsonb;
  v_pending  record;
  v_resolving uuid := tci.resolving_validation();
begin
  perform tci.begin_internal_call();
  if p_outcome = 'revoked' then
    raise exception 'use tci.revoke_effective_limit to revoke an effective limit'
      using errcode = 'P0001';
  end if;

  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found then
    raise exception 'limit request % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;
  if v_request.status not in ('submitted', 'under_review', 'escalated') then
    raise exception 'request is % and cannot be decided', v_request.status
      using errcode = 'P0001';
  end if;

  if not tci.has_role('admin', 'credit_underwriter') then
    raise exception 'only credit underwriting may decide' using errcode = '42501';
  end if;

  -- 0060: a request on validation is decided only by its validator, from
  -- resolve_limit_validation.
  select * into v_pending from tci.pending_validation_of(p_request_id, 'credit');
  if found and (v_resolving is distinct from v_pending.id
                or v_pending.validator_id <> (select auth.uid())) then
    raise exception 'limit_validation_pending: this request is on validation'
      using errcode = 'P0001';
  end if;

  v_currency := coalesce(p_currency, v_request.currency_code);
  v_band := tci.grade_band_for_assessment(p_assessment_id);

  if p_outcome in ('approved', 'partial') then
    if p_amount is null or p_amount <= 0 then
      raise exception 'approved/partial decisions require a positive amount'
        using errcode = 'P0001';
    end if;

    if not tci.has_role('admin') then
      v_amount_uzs := tci.to_uzs(p_amount, v_currency);
      v_authority_uzs := tci.my_authority_uzs(v_band);
      if v_amount_uzs > v_authority_uzs then
        -- 0060: beyond authority nothing is recorded; the author sends it to
        -- a named validator (submit_limit_for_validation), and a validator
        -- beyond THEIR authority forwards it.
        if v_resolving is not null then
          raise exception 'validation_beyond_authority: the amount is beyond your authority for rating band % — forward it',
            v_band using errcode = 'P0001';
        end if;
        return jsonb_build_object(
          'result', 'needs_validation',
          'grade_band', v_band,
          'amount_uzs', v_amount_uzs,
          'authority_uzs', v_authority_uzs
        );
      end if;

      -- PHASE 6: the group control. Blocking, and it escalates rather than
      -- simply failing, so the request reaches someone who can weigh the whole
      -- group. Admin is exempt (documented at the top of 0040).
      v_group := tci.group_exposure_preflight(
        v_request.entity_id, p_amount, v_currency,
        tci.limit_scope(v_request.policy_id, v_request.insurance_request_id));

      if (v_group ->> 'over_limit')::boolean then
        if v_resolving is not null then
          raise exception 'validation_group_limit: this amount would take the group over its limit'
            using errcode = 'P0001', detail = 'limits.errors.groupLimitExceeded';
        end if;
        update tci.credit_limit_requests set status = 'escalated' where id = p_request_id;

        perform tci.emit_workflow_event(
          'limit.group_limit_breached', 'credit_limit_request', p_request_id,
          jsonb_build_object(
            'entity_id', v_request.entity_id,
            'ultimate_parent_id', v_group ->> 'ultimate_parent_id',
            'amount', p_amount,
            'currency', v_currency,
            'exposure_after_uzs', v_group ->> 'exposure_after_uzs',
            'group_limit_uzs', v_group ->> 'group_limit_uzs'),
          'credit_underwriter'::tci.user_role);

        return jsonb_build_object(
          'result', 'group_limit_exceeded',
          'grade_band', v_band,
          'group', v_group
        );
      end if;
    end if;
  elsif p_outcome = 'declined' then
    if p_amount is not null then
      raise exception 'declined decisions carry no amount' using errcode = 'P0001';
    end if;
  end if;

  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code,
    valid_from, valid_until, based_on_assessment_id, comment, validation_id
  ) values (
    p_request_id, p_outcome, p_amount, v_currency,
    coalesce(p_valid_from, current_date), p_valid_until, p_assessment_id, p_comment, v_resolving
  ) returning * into v_decision;

  for v_condition in select * from jsonb_array_elements(coalesce(p_conditions, '[]'::jsonb))
  loop
    insert into tci.decision_conditions (decision_id, condition_type, description)
    values (
      v_decision.id,
      (v_condition->>'condition_type')::tci.condition_type,
      v_condition->>'description'
    );
  end loop;

  update tci.credit_limit_decisions d
     set lifecycle = 'superseded'
    from tci.credit_limit_requests r
   where r.id = d.request_id
     and d.id <> v_decision.id
     and d.lifecycle = 'effective'
     and tci.limit_scope(r.policy_id, r.insurance_request_id)
         = tci.limit_scope(v_request.policy_id, v_request.insurance_request_id)
     and r.entity_id = v_request.entity_id;

  update tci.credit_limit_requests
     set status = 'decided', decided_at = now()
   where id = p_request_id;

  return jsonb_build_object(
    'result', 'decided', 'decision_id', v_decision.id, 'grade_band', v_band);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. adjust_limit_commercial: over authority asks for validation; reductions
--    are never authority-checked (the emergency path)
-- ---------------------------------------------------------------------------
create or replace function tci.adjust_limit_commercial(p_decision_id uuid, p_new_amount numeric, p_new_payment_terms integer DEFAULT NULL::integer, p_comment text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_credit   tci.credit_limit_decisions%rowtype;
  v_new      tci.credit_limit_decisions%rowtype;
  v_request  tci.credit_limit_requests%rowtype;
  v_band     tci.grade_band;
  v_amount_uzs numeric;
  v_authority_uzs numeric;
  v_is_reduction boolean;
  v_group    jsonb;
  v_pending  record;
  v_resolving uuid := tci.resolving_validation();
begin
  perform tci.begin_internal_call();
  if not tci.has_role('admin', 'commercial_underwriter') then
    raise exception 'only commercial underwriting may adjust a limit'
      using errcode = '42501';
  end if;

  select * into v_credit from tci.credit_limit_decisions where id = p_decision_id;
  if not found then
    raise exception 'decision % not found or not accessible', p_decision_id
      using errcode = 'P0002';
  end if;
  if v_credit.stage <> 'credit' then
    raise exception 'only a credit-stage decision can be adjusted commercially'
      using errcode = 'P0001';
  end if;
  if v_credit.lifecycle <> 'effective' then
    raise exception 'decision is % and can no longer be adjusted', v_credit.lifecycle
      using errcode = 'P0001';
  end if;
  if v_credit.outcome not in ('approved', 'partial') then
    raise exception 'only an approved or partial limit can be adjusted'
      using errcode = 'P0001';
  end if;
  if p_new_amount is null or p_new_amount <= 0 then
    raise exception 'the adjusted amount must be positive' using errcode = 'P0001';
  end if;

  select * into v_request from tci.credit_limit_requests where id = v_credit.request_id;
  v_is_reduction := p_new_amount < v_credit.approved_amount;

  -- 0060: an adjustment on validation is made only by its validator.
  select * into v_pending from tci.pending_validation_of(v_credit.request_id, 'commercial');
  if found and (v_resolving is distinct from v_pending.id
                or v_pending.validator_id <> (select auth.uid())) then
    raise exception 'limit_validation_pending: an adjustment of this limit is on validation'
      using errcode = 'P0001';
  end if;

  v_band := tci.grade_band_for_assessment(v_credit.based_on_assessment_id);
  if not tci.has_role('admin') and not v_is_reduction then
    v_amount_uzs := tci.to_uzs(p_new_amount, v_credit.currency_code);
    select coalesce(max(tci.to_uzs(g.max_amount, g.currency_code)), 0)
      into v_authority_uzs
      from tci.authority_grants g
     where g.user_id = (select auth.uid())
       and g.applies_to = 'commercial'
       and g.grade_band = v_band
       and g.valid_from <= current_date
       and (g.valid_to is null or g.valid_to >= current_date);
    if v_amount_uzs > v_authority_uzs then
      if v_resolving is not null then
        raise exception 'validation_beyond_authority: the amount is beyond your authority for rating band % — forward it',
          v_band using errcode = 'P0001';
      end if;
      return jsonb_build_object(
        'result', 'needs_validation',
        'grade_band', v_band,
        'amount_uzs', v_amount_uzs,
        'authority_uzs', v_authority_uzs
      );
    end if;

    -- PHASE 6: the group control, on INCREASES only. A reduction lowers the
    -- group's exposure; blocking it because the group is over its limit would
    -- keep the insurer at the higher number.
    v_group := tci.group_exposure_preflight(
      v_request.entity_id, p_new_amount, v_credit.currency_code,
      tci.limit_scope(v_request.policy_id, v_request.insurance_request_id));
    if (v_group ->> 'over_limit')::boolean then
      raise exception 'this adjustment would take the group to % against a group limit of % (UZS)',
        v_group ->> 'exposure_after_uzs', v_group ->> 'group_limit_uzs'
        using errcode = 'P0001', detail = 'limits.errors.groupLimitExceeded';
    end if;
  end if;

  update tci.credit_limit_decisions
     set lifecycle = 'superseded'
   where adjusts_decision_id = p_decision_id
     and lifecycle = 'effective';

  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code, valid_from, valid_until,
    based_on_assessment_id, comment, stage, adjusts_decision_id, payment_terms_days,
    released_at, release_kind, validation_id
  ) values (
    v_credit.request_id, v_credit.outcome, p_new_amount, v_credit.currency_code,
    v_credit.valid_from, v_credit.valid_until,
    v_credit.based_on_assessment_id, p_comment, 'commercial', p_decision_id,
    coalesce(p_new_payment_terms, v_credit.payment_terms_days),
    case when v_is_reduction then now() else null end,
    case when v_is_reduction then 'immediate'::tci.release_kind else null end,
    v_resolving
  ) returning * into v_new;

  perform tci.emit_workflow_event(
    'limit.commercial_adjusted', 'credit_limit_decision', v_new.id,
    jsonb_build_object(
      'credit_decision_id', p_decision_id,
      'from_amount', v_credit.approved_amount,
      'to_amount', p_new_amount,
      'grade_band', v_band,
      'is_reduction', v_is_reduction
    ),
    case when v_is_reduction then 'client'::tci.user_role else 'sales'::tci.user_role end
  );

  return jsonb_build_object(
    'result', 'adjusted',
    'decision_id', v_new.id,
    'grade_band', v_band,
    'is_reduction', v_is_reduction,
    'released_immediately', v_is_reduction
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Sending a proposal to validation
-- ---------------------------------------------------------------------------
-- Checks a validator for a proposal: four eyes, the department, authority.
create function tci.check_validator(
  p_validator uuid, p_stream tci.authority_scope, p_band tci.grade_band,
  p_amount numeric, p_currency char(3), p_chain_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_internal_call();
  if p_validator is null then
    raise exception 'validator_required: choose who validates the decision' using errcode = 'P0001';
  end if;
  if p_validator = (select auth.uid())
     or exists (select 1 from tci.limit_validations v
                 where p_chain_id is not null and v.chain_id = p_chain_id
                   and p_validator in (v.proposed_by, v.validator_id, v.forwarded_by)) then
    raise exception 'validator_four_eyes: nobody validates a decision they proposed or already validated'
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.user_roles r join auth.users u on u.id = r.user_id
                  where r.user_id = p_validator and r.role = tci.validation_role(p_stream)
                    and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())) then
    raise exception 'validator_wrong_department: the validator must be an active colleague of the same department'
      using errcode = 'P0001';
  end if;
  if p_amount is not null
     and tci.user_authority_uzs(p_validator, p_stream, p_band) < tci.to_uzs(p_amount, p_currency) then
    raise exception 'validator_lacks_authority: the validator''s authority does not cover this amount in rating band %',
      p_band using errcode = 'P0001';
  end if;
end;
$$;

create function tci.submit_limit_for_validation(
  p_request_id    uuid,
  p_validator_id  uuid,
  p_outcome       tci.decision_outcome,
  p_amount        numeric default null,
  p_currency      char(3) default null,
  p_valid_from    date default current_date,
  p_valid_until   date default null,
  p_conditions    jsonb default '[]'::jsonb,
  p_comment       text default null,
  p_assessment_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request  tci.credit_limit_requests%rowtype;
  v_currency char(3);
  v_band     tci.grade_band;
  v_amount_uzs numeric;
  v_kind     tci.validation_kind;
  v_row      tci.limit_validations%rowtype;
  v_id       uuid := gen_random_uuid();
begin
  perform tci.require_role('admin', 'credit_underwriter');
  perform tci.begin_trusted_call();

  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found then
    raise exception 'limit request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_request.status not in ('submitted', 'under_review', 'escalated') then
    raise exception 'request is % and cannot be decided', v_request.status using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.limit_validations where request_id = p_request_id and status = 'pending') then
    raise exception 'limit_validation_pending: this request is already on validation' using errcode = 'P0001';
  end if;
  if p_outcome not in ('approved', 'partial', 'declined') then
    raise exception 'only an approval, a partial approval or a decline can be validated' using errcode = 'P0001';
  end if;
  if p_outcome in ('approved', 'partial') and (p_amount is null or p_amount <= 0) then
    raise exception 'approved/partial decisions require a positive amount' using errcode = 'P0001';
  end if;
  if p_outcome = 'declined' and p_amount is not null then
    raise exception 'declined decisions carry no amount' using errcode = 'P0001';
  end if;

  v_currency := coalesce(p_currency, v_request.currency_code);
  v_band := tci.grade_band_for_assessment(p_assessment_id);
  v_amount_uzs := case when p_amount is null then null else tci.to_uzs(p_amount, v_currency) end;
  v_kind := case
              when p_amount is not null and not tci.has_role('admin')
                   and v_amount_uzs > tci.my_authority_uzs(v_band) then 'required'
              else 'voluntary' end;
  if v_kind = 'voluntary' and coalesce(btrim(p_comment), '') = '' then
    raise exception 'validation_comment_required: say what you want a second opinion on' using errcode = 'P0001';
  end if;

  perform tci.check_validator(p_validator_id, 'credit', v_band, p_amount, v_currency, null);

  insert into tci.limit_validations (
    id, chain_id, request_id, stream, kind, outcome, amount, currency_code,
    valid_from, valid_until, conditions, assessment_id, grade_band, amount_uzs, comment,
    proposed_by, validator_id)
  values (
    v_id, v_id, p_request_id, 'credit', v_kind, p_outcome, p_amount, v_currency,
    coalesce(p_valid_from, current_date), p_valid_until, coalesce(p_conditions, '[]'::jsonb),
    p_assessment_id, v_band, v_amount_uzs, nullif(btrim(p_comment), ''),
    (select auth.uid()), p_validator_id)
  returning * into v_row;

  update tci.credit_limit_requests set status = 'escalated' where id = p_request_id;

  perform tci.emit_validation_requested(v_row);
  return jsonb_build_object('result', 'on_validation', 'validation_id', v_row.id, 'kind', v_kind,
                            'grade_band', v_band);
end;
$$;

create function tci.submit_adjustment_for_validation(
  p_decision_id       uuid,
  p_validator_id      uuid,
  p_new_amount        numeric,
  p_new_payment_terms integer default null,
  p_comment           text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credit  tci.credit_limit_decisions%rowtype;
  v_band    tci.grade_band;
  v_amount_uzs numeric;
  v_kind    tci.validation_kind;
  v_row     tci.limit_validations%rowtype;
  v_id      uuid := gen_random_uuid();
  v_held    boolean := false;
begin
  perform tci.require_role('admin', 'commercial_underwriter');
  perform tci.begin_trusted_call();

  select * into v_credit from tci.credit_limit_decisions where id = p_decision_id for update;
  if not found then
    raise exception 'decision % not found', p_decision_id using errcode = 'P0002';
  end if;
  if v_credit.stage <> 'credit' or v_credit.lifecycle <> 'effective'
     or v_credit.outcome not in ('approved', 'partial') then
    raise exception 'only an effective approved or partial credit-stage limit can be adjusted'
      using errcode = 'P0001';
  end if;
  if p_new_amount is null or p_new_amount <= 0 then
    raise exception 'the adjusted amount must be positive' using errcode = 'P0001';
  end if;
  if p_new_amount < v_credit.approved_amount then
    raise exception 'validation_not_for_reduction: a reduction works at once and needs no validation'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.limit_validations where request_id = v_credit.request_id and status = 'pending') then
    raise exception 'limit_validation_pending: this limit is already on validation' using errcode = 'P0001';
  end if;

  v_band := tci.grade_band_for_assessment(v_credit.based_on_assessment_id);
  v_amount_uzs := tci.to_uzs(p_new_amount, v_credit.currency_code);
  v_kind := case
              when not tci.has_role('admin')
                   and v_amount_uzs > tci.user_authority_uzs((select auth.uid()), 'commercial', v_band) then 'required'
              else 'voluntary' end;
  if v_kind = 'voluntary' and coalesce(btrim(p_comment), '') = '' then
    raise exception 'validation_comment_required: say what you want a second opinion on' using errcode = 'P0001';
  end if;

  perform tci.check_validator(p_validator_id, 'commercial', v_band, p_new_amount, v_credit.currency_code, null);

  -- Nothing reaches the client while the adjustment is weighed: hold the
  -- credit decision unless the client has already seen it.
  if v_credit.released_at is null and not v_credit.held then
    update tci.credit_limit_decisions set held = true where id = p_decision_id;
    v_held := true;
  end if;

  insert into tci.limit_validations (
    id, chain_id, request_id, stream, kind, outcome, amount, currency_code, payment_terms_days,
    valid_from, valid_until, assessment_id, adjusts_decision_id, grade_band, amount_uzs, comment,
    proposed_by, validator_id, held_credit_decision)
  values (
    v_id, v_id, v_credit.request_id, 'commercial', v_kind, v_credit.outcome, p_new_amount,
    v_credit.currency_code, coalesce(p_new_payment_terms, v_credit.payment_terms_days),
    v_credit.valid_from, v_credit.valid_until, v_credit.based_on_assessment_id, p_decision_id,
    v_band, v_amount_uzs, nullif(btrim(p_comment), ''),
    (select auth.uid()), p_validator_id, v_held)
  returning * into v_row;

  perform tci.emit_validation_requested(v_row);
  return jsonb_build_object('result', 'on_validation', 'validation_id', v_row.id, 'kind', v_kind,
                            'grade_band', v_band);
end;
$$;

-- The event a new step emits (also used by forward).
create function tci.emit_validation_requested(p_row tci.limit_validations)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity uuid;
  v_name   text;
  v_number text;
begin
  perform tci.require_internal_call();
  select r.entity_id, e.name into v_entity, v_name
    from tci.credit_limit_requests r join tci.legal_entities e on e.id = r.entity_id
   where r.id = p_row.request_id;
  perform tci.emit_workflow_event(
    'limit.validation_requested', 'limit_validation', p_row.id,
    jsonb_build_object(
      'request_id', p_row.request_id, 'entity_id', v_entity, 'entity_name', v_name,
      'stream', p_row.stream, 'kind', p_row.kind, 'outcome', p_row.outcome,
      'amount', p_row.amount, 'currency', p_row.currency_code, 'grade_band', p_row.grade_band,
      'proposed_by', p_row.proposed_by, 'proposed_by_name', tci.staff_name(p_row.proposed_by),
      'forwarded_by', p_row.forwarded_by),
    null, p_row.validator_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. The validator's answer
-- ---------------------------------------------------------------------------
--   approve           the proposal as it stands, within the validator's authority
--   approve_modified  a different amount (credit: also its outcome follows the
--                     request; commercial: amount and payment terms), within
--                     the validator's authority
--   return            back to the author with a comment; the request reopens
--   reject            credit: the limit is declined (a decision by the
--                     validator, with the comment); commercial: the adjustment
--                     is dropped and the credit decision stands
--   forward           to someone senior, unchanged (a new step of the chain)
create function tci.resolve_limit_validation(
  p_validation_id     uuid,
  p_action            text,
  p_amount            numeric default null,
  p_payment_terms     integer default null,
  p_comment           text default null,
  p_forward_to        uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row      tci.limit_validations%rowtype;
  v_request  tci.credit_limit_requests%rowtype;
  v_result   jsonb;
  v_amount   numeric;
  v_outcome  tci.decision_outcome;
  v_status   tci.validation_status;
  v_decision uuid;
  v_next     tci.limit_validations%rowtype;
  v_id       uuid;
  v_author   uuid;
begin
  perform tci.require_role('admin', 'credit_underwriter', 'commercial_underwriter');
  perform tci.begin_trusted_call();

  select * into v_row from tci.limit_validations where id = p_validation_id for update;
  if not found then
    raise exception 'validation % not found', p_validation_id using errcode = 'P0002';
  end if;
  if v_row.validator_id <> (select auth.uid()) then
    raise exception 'only the assigned validator may answer this validation' using errcode = '42501';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'validation_closed: this validation is already %', v_row.status using errcode = 'P0001';
  end if;
  if p_action not in ('approve', 'approve_modified', 'return', 'reject', 'forward') then
    raise exception 'unknown validation action %', p_action using errcode = 'P0001';
  end if;
  select proposed_by into v_author from tci.limit_validations where id = v_row.chain_id;

  select * into v_request from tci.credit_limit_requests where id = v_row.request_id for update;
  -- A credit request withdrawn meanwhile: the step is moot.
  if v_row.stream = 'credit' and v_request.status not in ('submitted', 'under_review', 'escalated') then
    update tci.limit_validations
       set status = 'cancelled', resolved_by = (select auth.uid()), resolved_at = now(),
           resolution_comment = nullif(btrim(p_comment), '')
     where id = v_row.id;
    perform tci.emit_validation_resolved(v_row, 'cancelled', null, p_comment, v_author);
    return jsonb_build_object('result', 'cancelled');
  end if;

  if p_action in ('return', 'reject') and coalesce(btrim(p_comment), '') = '' then
    raise exception 'validation_comment_required: say why' using errcode = 'P0001';
  end if;

  -- The decision functions run as the validator and accept this step.
  perform set_config('tci.resolving_validation', v_row.id::text, true);

  if p_action in ('approve', 'approve_modified') then
    v_amount := case when p_action = 'approve_modified' then p_amount else v_row.amount end;
    if p_action = 'approve_modified' and (p_amount is null or p_amount <= 0) then
      raise exception 'approve_modified needs the amount you approve' using errcode = 'P0001';
    end if;
    if v_row.stream = 'credit' then
      v_outcome := case
        when v_row.outcome = 'declined' and p_action = 'approve' then 'declined'
        when v_amount is null then 'declined'
        when v_amount < v_request.requested_amount then 'partial'
        else 'approved' end;
      v_result := tci.decide_limit_request(
        v_row.request_id, v_outcome, case when v_outcome = 'declined' then null else v_amount end,
        v_row.currency_code, v_row.valid_from, v_row.valid_until, v_row.conditions,
        coalesce(nullif(btrim(p_comment), ''), v_row.comment), v_row.assessment_id);
    else
      v_result := tci.adjust_limit_commercial(
        v_row.adjusts_decision_id, v_amount,
        case when p_action = 'approve_modified' then coalesce(p_payment_terms, v_row.payment_terms_days)
             else v_row.payment_terms_days end,
        coalesce(nullif(btrim(p_comment), ''), v_row.comment));
    end if;
    if v_result ->> 'result' not in ('decided', 'adjusted') then
      raise exception 'validation_not_recorded: %', v_result ->> 'result' using errcode = 'P0001';
    end if;
    v_decision := (v_result ->> 'decision_id')::uuid;
    v_status := case when p_action = 'approve' then 'approved' else 'approved_modified' end;

  elsif p_action = 'reject' then
    if v_row.stream = 'credit' then
      v_result := tci.decide_limit_request(
        v_row.request_id, 'declined', null, v_row.currency_code, current_date, null, '[]'::jsonb,
        btrim(p_comment), v_row.assessment_id);
      v_decision := (v_result ->> 'decision_id')::uuid;
    end if;
    v_status := 'rejected';

  elsif p_action = 'return' then
    if v_row.stream = 'credit' then
      update tci.credit_limit_requests set status = 'under_review' where id = v_row.request_id;
    end if;
    v_status := 'returned';

  else -- forward
    v_id := gen_random_uuid();
    perform tci.check_validator(p_forward_to, v_row.stream, v_row.grade_band, v_row.amount,
                                v_row.currency_code, v_row.chain_id);
    v_status := 'forwarded';
  end if;

  perform set_config('tci.resolving_validation', '', true);

  -- A commercial step that ends (anything but forward) lets the credit
  -- decision go its way again if this chain held it.
  if v_row.stream = 'commercial' and v_status <> 'forwarded'
     and exists (select 1 from tci.limit_validations c where c.chain_id = v_row.chain_id and c.held_credit_decision) then
    update tci.credit_limit_decisions set held = false
     where id = v_row.adjusts_decision_id and held and released_at is null;
  end if;

  update tci.limit_validations
     set status = v_status, resolved_by = (select auth.uid()), resolved_at = now(),
         resolution_comment = nullif(btrim(p_comment), ''), resulting_decision_id = v_decision
   where id = v_row.id;

  if v_status = 'forwarded' then
    insert into tci.limit_validations (
      id, chain_id, parent_id, request_id, stream, kind, outcome, amount, currency_code,
      payment_terms_days, valid_from, valid_until, conditions, assessment_id, adjusts_decision_id,
      grade_band, amount_uzs, comment, proposed_by, forwarded_by, validator_id, held_credit_decision)
    values (
      v_id, v_row.chain_id, v_row.id, v_row.request_id, v_row.stream, v_row.kind, v_row.outcome,
      v_row.amount, v_row.currency_code, v_row.payment_terms_days, v_row.valid_from, v_row.valid_until,
      v_row.conditions, v_row.assessment_id, v_row.adjusts_decision_id, v_row.grade_band,
      v_row.amount_uzs, v_row.comment, v_row.proposed_by, (select auth.uid()), p_forward_to, false)
    returning * into v_next;
    perform tci.emit_validation_resolved(v_row, 'forwarded', null, p_comment, v_author);
    perform tci.emit_validation_requested(v_next);
    return jsonb_build_object('result', 'forwarded', 'validation_id', v_next.id);
  end if;

  perform tci.emit_validation_resolved(v_row, v_status::text, v_decision, p_comment, v_author);
  return jsonb_build_object('result', v_status, 'decision_id', v_decision);
end;
$$;

create function tci.emit_validation_resolved(
  p_row tci.limit_validations, p_status text, p_decision uuid, p_comment text, p_author uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity uuid;
  v_name   text;
begin
  perform tci.require_internal_call();
  select r.entity_id, e.name into v_entity, v_name
    from tci.credit_limit_requests r join tci.legal_entities e on e.id = r.entity_id
   where r.id = p_row.request_id;
  perform tci.emit_workflow_event(
    'limit.validation_resolved', 'limit_validation', p_row.id,
    jsonb_build_object(
      'request_id', p_row.request_id, 'entity_id', v_entity, 'entity_name', v_name,
      'stream', p_row.stream, 'status', p_status, 'decision_id', p_decision,
      'amount', p_row.amount, 'currency', p_row.currency_code,
      'validator', (select auth.uid()), 'validator_name', tci.staff_name((select auth.uid())),
      'author', p_author, 'comment', nullif(btrim(p_comment), '')),
    null, p_author);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Agenda: the ninth trigger
-- ---------------------------------------------------------------------------
--   limit_validation         the validator (a person)   urgent when required,
--                            high when voluntary        AUTO when answered
--   limit_validation_result  the author (a person)      normal; MANUAL close
create function tci.handle_validation_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.object_type <> 'limit_validation' then
    return null;
  end if;
  perform tci.begin_trusted_call();

  if new.event_type = 'limit.validation_requested' then
    perform tci.open_task(
      'limit_validation', 'limit_validation', new.object_id,
      'agenda.tasks.limit_validation',
      jsonb_build_object(
        'request_id', new.payload ->> 'request_id', 'entity_id', new.payload ->> 'entity_id',
        'entity_name', new.payload ->> 'entity_name', 'stream', new.payload ->> 'stream',
        'kind', new.payload ->> 'kind', 'outcome', new.payload ->> 'outcome',
        'amount', new.payload -> 'amount', 'currency', new.payload ->> 'currency',
        'grade_band', new.payload ->> 'grade_band',
        'proposed_by_name', new.payload ->> 'proposed_by_name'),
      null, new.target_user, null,
      case when new.payload ->> 'kind' = 'required' then 'urgent' else 'high' end::tci.task_priority,
      new.id);

  elsif new.event_type = 'limit.validation_resolved' then
    perform tci.close_tasks(array['limit_validation']::tci.task_type[], new.object_id,
      case when new.payload ->> 'status' = 'cancelled' then 'cancelled' else 'done' end::tci.task_status);
    -- The author hears how it ended (a forward is not an end).
    if new.payload ->> 'status' not in ('forwarded', 'cancelled') and new.target_user is not null then
      perform tci.open_task(
        'limit_validation_result', 'limit_validation', new.object_id,
        'agenda.tasks.limit_validation_result_' || (new.payload ->> 'status'),
        jsonb_build_object(
          'request_id', new.payload ->> 'request_id', 'entity_id', new.payload ->> 'entity_id',
          'entity_name', new.payload ->> 'entity_name', 'stream', new.payload ->> 'stream',
          'amount', new.payload -> 'amount', 'currency', new.payload ->> 'currency',
          'validator_name', new.payload ->> 'validator_name', 'status', new.payload ->> 'status'),
        null, new.target_user, null,
        case when new.payload ->> 'status' = 'returned' then 'high' else 'normal' end::tci.task_priority,
        new.id);
    end if;
  end if;
  return null;
end;
$$;

create trigger workflow_events_to_validation_tasks
  after insert on tci.workflow_events
  for each row execute function tci.handle_validation_event();

-- complete_task: limit_validation_result is the fifth manual type.
create or replace function tci.complete_task(p_task_id uuid)
returns tci.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare v_task tci.tasks%rowtype;
begin
  perform tci.require_staff();

  select * into v_task from tci.tasks t
   where t.id = p_task_id and tci.task_is_mine(t.target_role, t.target_user)
     for update;
  if not found then
    raise exception 'task % not found or not yours', p_task_id using errcode = 'P0002';
  end if;
  if v_task.status <> 'open' then
    raise exception 'task is already %', v_task.status using errcode = 'P0001';
  end if;
  if v_task.task_type not in
     ('submission_declined', 'uncovered_excess_review', 'claim_declined_review',
      'entity_request_resolved', 'limit_validation_result') then
    raise exception 'task type % closes itself when its object moves on', v_task.task_type
      using errcode = 'P0001';
  end if;

  update tci.tasks
     set status = 'done', completed_by = (select auth.uid()), completed_at = now()
   where id = p_task_id
   returning * into v_task;
  return v_task;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------
revoke all on function tci.is_validation_participant(uuid) from public, anon;
grant execute on function tci.is_validation_participant(uuid) to authenticated, service_role;
revoke all on function tci.user_authority_uzs(uuid, tci.authority_scope, tci.grade_band) from public, anon, authenticated;
revoke all on function tci.validation_role(tci.authority_scope) from public, anon;
grant execute on function tci.validation_role(tci.authority_scope) to authenticated, service_role;
revoke all on function tci.validation_candidates(tci.authority_scope, tci.grade_band, numeric, char, uuid) from public, anon;
grant execute on function tci.validation_candidates(tci.authority_scope, tci.grade_band, numeric, char, uuid) to authenticated;
revoke all on function tci.set_user_manager(uuid, uuid) from public, anon;
grant execute on function tci.set_user_manager(uuid, uuid) to authenticated;
revoke all on function tci.user_managers() from public, anon;
grant execute on function tci.user_managers() to authenticated;
revoke all on function tci.limit_request_validation_state(uuid[]) from public, anon;
grant execute on function tci.limit_request_validation_state(uuid[]) to authenticated;
revoke all on function tci.limit_validation_history(uuid) from public, anon;
grant execute on function tci.limit_validation_history(uuid) to authenticated;
revoke all on function tci.staff_name(uuid) from public, anon, authenticated;
revoke all on function tci.pending_validation_of(uuid, tci.authority_scope) from public, anon;
grant execute on function tci.pending_validation_of(uuid, tci.authority_scope) to authenticated, service_role;
revoke all on function tci.resolving_validation() from public, anon;
grant execute on function tci.resolving_validation() to authenticated, service_role;
revoke all on function tci.check_validator(uuid, tci.authority_scope, tci.grade_band, numeric, char, uuid) from public, anon, authenticated;
revoke all on function tci.submit_limit_for_validation(uuid, uuid, tci.decision_outcome, numeric, char, date, date, jsonb, text, uuid) from public, anon;
grant execute on function tci.submit_limit_for_validation(uuid, uuid, tci.decision_outcome, numeric, char, date, date, jsonb, text, uuid) to authenticated;
revoke all on function tci.submit_adjustment_for_validation(uuid, uuid, numeric, integer, text) from public, anon;
grant execute on function tci.submit_adjustment_for_validation(uuid, uuid, numeric, integer, text) to authenticated;
revoke all on function tci.emit_validation_requested(tci.limit_validations) from public, anon, authenticated;
revoke all on function tci.emit_validation_resolved(tci.limit_validations, text, uuid, text, uuid) from public, anon, authenticated;
revoke all on function tci.resolve_limit_validation(uuid, text, numeric, integer, text, uuid) from public, anon;
grant execute on function tci.resolve_limit_validation(uuid, text, numeric, integer, text, uuid) to authenticated;
revoke all on function tci.handle_validation_event() from public, anon, authenticated;
revoke all on function tci.guard_limit_validation_update() from public, anon, authenticated;

-- is_validation_participant answers only whether the CALLER is in a chain;
-- it has no gate of its own because RLS calls it for every row, so it joins
-- the allow-list (the 0048 list, unchanged, plus this one entry).
create or replace function tci.definer_gate_allowlist()
returns table (proname text, justification text)
language sql
immutable
parallel safe
set search_path = ''
as $$
  values
    ('has_role',                 'reads only the caller''s own tci.user_roles rows; it IS the gate'),
    ('is_staff',                 'reads only the caller''s own tci.user_roles rows; it IS the gate'),
    ('current_user_roles',       'returns only the caller''s own roles'),
    ('password_rotation_pending','reads only the caller''s own profile flag; part of the gate'),
    ('complete_password_change', 'writes only the caller''s own profile row, keyed by auth.uid()'),
    ('sales_window_hours',       'one non-sensitive workflow_settings number, needed by views a client reads'),
    ('group_depth_cap',          'one non-sensitive workflow_settings number'),
    ('group_exposure_warn_pct',  'one non-sensitive workflow_settings number'),
    ('decision_is_released',     'pure computation over its arguments and the sales window; no table read'),
    ('begin_internal_call',      'is itself gated on is_staff(); the token it sets dies with the transaction'),
    ('require_staff',            'a gate: only raises'),
    ('require_role',             'a gate: only raises'),
    ('require_claim_access',     'a gate: only raises'),
    ('auth_policy',              'non-sensitive policy numbers the UI mirrors to explain a refusal'),
    ('mfa_satisfied',            'reads only the caller''s own factors, roles and JWT claims; part of the gate'),
    ('my_auth_status',           'reads only the caller''s own rotation, MFA and lockout state'),
    ('login_begin',              'pre-sign-in entry point: salted hashes only, names no account (see pre_auth_entry_points)'),
    ('my_sign_in_notice',        'reads only the caller''s own sign-in attempts, keyed by auth.uid()'),
    ('require_trusted_write',    'a gate: only raises (the guard on workflow-written tables)'),
    ('may_remove_claim_object',  'a storage-policy predicate: true only for the caller''s own unregistered upload to a claim they may upload to'),
    ('is_validation_participant','an RLS predicate of tci.limit_validations: answers only whether the CALLER is in a validation chain')
$$;

-- ---------------------------------------------------------------------------
-- 11. Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if position('needs_validation' in pg_get_functiondef('tci.decide_limit_request(uuid, tci.decision_outcome, numeric, character, date, date, jsonb, text, uuid)'::regprocedure)) = 0 then
    raise exception '0060: decide_limit_request does not ask for validation';
  end if;
  if position('limit.request_escalated' in pg_get_functiondef('tci.decide_limit_request(uuid, tci.decision_outcome, numeric, character, date, date, jsonb, text, uuid)'::regprocedure)) > 0 then
    raise exception '0060: decide_limit_request still escalates an over-authority amount to the pool';
  end if;
  if has_function_privilege('authenticated', 'tci.user_authority_uzs(uuid, tci.authority_scope, tci.grade_band)', 'execute')
     or has_function_privilege('authenticated', 'tci.check_validator(uuid, tci.authority_scope, tci.grade_band, numeric, character, uuid)', 'execute')
     or has_function_privilege('authenticated', 'tci.staff_name(uuid)', 'execute') then
    raise exception '0060: an internal validation helper is reachable by the API';
  end if;
  if has_table_privilege('authenticated', 'tci.limit_validations', 'insert')
     or has_table_privilege('authenticated', 'tci.limit_validations', 'update') then
    raise exception '0060: limit_validations is writable through the API';
  end if;
end;
$$;
