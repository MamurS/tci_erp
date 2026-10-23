-- 0063_acting_role.sql
--
-- What: (1) A person acts in ONE role at a time — the role of the active
--       workspace — stored server-side per session (tci.acting_roles, keyed
--       by the token's session_id, set only through tci.set_acting_role from
--       roles the person holds). tci.has_role(), tci.is_staff() and
--       tci.current_user_roles() — and through them every RLS policy and
--       every gate — answer for the ACTING role only; tci.held_roles() is the
--       union the workspace switcher lists. A single-role user acts in that
--       role without choosing anything.
--       (2) Four eyes on credit limits: whoever raised a request never takes
--       it into review, decides it, proposes its decision or validates it;
--       on the commercial stage neither the requester nor whoever made the
--       credit decision adjusts it (tci.limit_four_eyes_refusal, one rule for
--       every caller). Admin is not exempt.
--       (3) Admin holds no business decision rights on limits: no admin
--       branch in deciding, adjusting, holding, releasing, revoking,
--       validating, setting an ADT or a group limit, and admin is no longer
--       "unlimited" authority (tci.user_authority_uzs).
-- Why:  Prompt 29. The owner's account holds every staff role; with
--       has_role() answering for the UNION, the commercial workspace still
--       carried credit underwriting's rights, and nothing stopped a requester
--       from deciding their own request. Verified on canonical 2026-10-23
--       before this migration: the owner's own request (Ankara Tekstil,
--       10 bn UZS) was taken into review by the owner 2 s after submitting.
--
-- Reads stay strict too: a multi-role person sees, in each workspace, exactly
-- what a single-role user of the acting role sees (decided in Prompt 29 §1 as
-- the simpler option — no policy is rewritten, every one already says what a
-- single role may see). Tasks addressed to the person by name stay visible in
-- every workspace (tasks: read mine checks target_user first).
--
-- Not in this migration (Prompt 29, later PRs): routing and
-- information_gathering, the credit analyst role, authority levels and
-- committees. Admin business powers OUTSIDE credit limits (claims approval,
-- declaration acceptance, policy status, bind) are untouched here and listed
-- in the PR as a follow-up.

-- ---------------------------------------------------------------------------
-- 1. The acting role
-- ---------------------------------------------------------------------------

-- No foreign key to auth.users on purpose: a row is only ever read joined to
-- the person's CURRENT tci.user_roles, so a row left by a removed account or
-- an ended session is inert.
create table tci.acting_roles (
  user_id    uuid not null,
  session_id uuid not null,
  role       tci.user_role not null,
  set_at     timestamptz not null default now(),
  primary key (user_id, session_id)
);
comment on table tci.acting_roles is
  'The role a person acts in, per sign-in session (the access token''s session_id). Written only by tci.set_acting_role; read by tci.acting_role. No API role reads or writes it directly.';
alter table tci.acting_roles enable row level security;
revoke all on tci.acting_roles from public, anon, authenticated;

-- The token's session id; null outside a signed-in API call.
create function tci.jwt_session_id()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  return nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id', '')::uuid;
exception when others then
  return null;
end;
$$;

-- The role the caller acts in now: the one set for this session if they
-- still hold it; otherwise their only role; otherwise none (a multi-role
-- person who has not chosen acts in no role, and every gate closes).
create function tci.acting_role()
returns tci.user_role
language sql
stable
security definer
set search_path = ''
as $$
  with held as (
    select r.role from tci.user_roles r where r.user_id = (select auth.uid())
  )
  select coalesce(
    (select a.role
       from tci.acting_roles a
      where a.user_id = (select auth.uid())
        and a.session_id = tci.jwt_session_id()
        and a.role in (select h.role from held h)),
    (select min(h.role::text)::tci.user_role from held h having count(*) = 1)
  )
$$;

-- Every role the caller holds: what the workspace switcher offers.
create function tci.held_roles()
returns setof tci.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from tci.user_roles where user_id = (select auth.uid())
$$;

create function tci.set_acting_role(p_role tci.user_role)
returns tci.user_role
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_session uuid := tci.jwt_session_id();
  v_changed integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if v_session is null then
    raise exception 'acting_role_no_session: no sign-in session to set an acting role for'
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.user_roles where user_id = v_uid and role = p_role) then
    raise exception 'acting_role_not_held: you do not hold the role %', p_role using errcode = '42501';
  end if;

  insert into tci.acting_roles (user_id, session_id, role)
  values (v_uid, v_session, p_role)
  on conflict (user_id, session_id) do update
    set role = excluded.role, set_at = now()
    where tci.acting_roles.role is distinct from excluded.role;
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    perform tci.log_auth_event('session.acting_role', v_uid, v_uid, jsonb_build_object('role', p_role));
  end if;
  return p_role;
end;
$$;

create or replace function tci.has_role(variadic p_roles tci.user_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(tci.acting_role() = any(p_roles), false)
  and not tci.password_rotation_pending()
  and tci.mfa_satisfied()
$$;

create or replace function tci.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(tci.acting_role() <> 'client', false)
  and not tci.password_rotation_pending()
  and tci.mfa_satisfied()
$$;

-- Read by the Agenda's "tasks: read mine" policy and tci.task_is_mine: a
-- department task shows in the workspace of that department.
create or replace function tci.current_user_roles()
returns setof tci.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select r from (select tci.acting_role() as r) x where r is not null
$$;

-- ---------------------------------------------------------------------------
-- 2. Four eyes on a credit limit
-- ---------------------------------------------------------------------------

-- Why p_user may not act on p_request_id in p_stream, or null. One rule for
-- the decider, the proposer, the validator and the adjuster.
create function tci.limit_four_eyes_refusal(p_request_id uuid, p_user uuid, p_stream tci.authority_scope)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_user is null then null
    when r.requested_by = p_user then
      'four_eyes_own_request: you raised this limit request and cannot decide or change it'
    when p_stream = 'commercial' and exists (
           select 1 from tci.credit_limit_decisions d
            where d.request_id = p_request_id and d.stage = 'credit' and d.decided_by = p_user) then
      'four_eyes_own_credit_decision: you made the credit decision on this request and cannot adjust it commercially'
  end
  from tci.credit_limit_requests r
  where r.id = p_request_id
$$;

-- ---------------------------------------------------------------------------
-- 3. Credit limits: four eyes, and no admin branch (definitions as of
--    0043 / 0047 / 0060 / 0061, changed only where marked 0063)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION tci.decide_limit_request(p_request_id uuid, p_outcome tci.decision_outcome, p_amount numeric DEFAULT NULL::numeric, p_currency character DEFAULT NULL::bpchar, p_valid_from date DEFAULT CURRENT_DATE, p_valid_until date DEFAULT NULL::date, p_conditions jsonb DEFAULT '[]'::jsonb, p_comment text DEFAULT NULL::text, p_assessment_id uuid DEFAULT NULL::uuid)
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
  v_refusal  text;
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

  if not tci.has_role('credit_underwriter') then
    raise exception 'only credit underwriting may decide' using errcode = '42501';
  end if;
  -- 0063: four eyes (tci.limit_four_eyes_refusal).
  v_refusal := tci.limit_four_eyes_refusal(p_request_id, (select auth.uid()), 'credit');
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = '42501';
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

    -- 0063: no admin bypass: admin holds no business decision rights
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
    -- group. Since 0063 nobody is exempt.
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
$function$
;

CREATE OR REPLACE FUNCTION tci.adjust_limit_commercial(p_decision_id uuid, p_new_amount numeric, p_new_payment_terms integer DEFAULT NULL::integer, p_comment text DEFAULT NULL::text)
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
  v_refusal  text;
begin
  perform tci.begin_internal_call();
  if not tci.has_role('commercial_underwriter') then
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
  -- 0063: four eyes (tci.limit_four_eyes_refusal).
  v_refusal := tci.limit_four_eyes_refusal(v_credit.request_id, (select auth.uid()), 'commercial');
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = '42501';
  end if;

  -- 0060: an adjustment on validation is made only by its validator.
  select * into v_pending from tci.pending_validation_of(v_credit.request_id, 'commercial');
  if found and (v_resolving is distinct from v_pending.id
                or v_pending.validator_id <> (select auth.uid())) then
    raise exception 'limit_validation_pending: an adjustment of this limit is on validation'
      using errcode = 'P0001';
  end if;

  v_band := tci.grade_band_for_assessment(v_credit.based_on_assessment_id);
  -- 0063: no admin bypass: admin holds no business decision rights.
  if not v_is_reduction then
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
$function$
;

CREATE OR REPLACE FUNCTION tci.start_limit_review(p_request_id uuid)
 RETURNS tci.credit_limit_requests
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_request tci.credit_limit_requests%rowtype;
  v_refusal text;
begin
  -- 0063: taking a request into review is credit underwriting's step, and
  -- never on a request one raised oneself.
  if not tci.has_role('credit_underwriter') then
    raise exception 'only credit underwriting may take a request into review' using errcode = '42501';
  end if;
  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found then
    raise exception 'limit request % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;
  -- 0063: four eyes (tci.limit_four_eyes_refusal).
  v_refusal := tci.limit_four_eyes_refusal(p_request_id, (select auth.uid()), 'credit');
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = '42501';
  end if;
  if v_request.status <> 'submitted' then
    raise exception 'only submitted requests can move to review (current: %)', v_request.status
      using errcode = 'P0001';
  end if;
  update tci.credit_limit_requests set status = 'under_review'
   where id = p_request_id returning * into v_request;
  return v_request;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.submit_limit_for_validation(p_request_id uuid, p_validator_id uuid, p_outcome tci.decision_outcome, p_amount numeric DEFAULT NULL::numeric, p_currency character DEFAULT NULL::bpchar, p_valid_from date DEFAULT CURRENT_DATE, p_valid_until date DEFAULT NULL::date, p_conditions jsonb DEFAULT '[]'::jsonb, p_comment text DEFAULT NULL::text, p_assessment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_request  tci.credit_limit_requests%rowtype;
  v_currency char(3);
  v_band     tci.grade_band;
  v_amount_uzs numeric;
  v_kind     tci.validation_kind;
  v_row      tci.limit_validations%rowtype;
  v_id       uuid := gen_random_uuid();
  v_refusal  text;
begin
  perform tci.require_role('credit_underwriter');
  perform tci.begin_trusted_call();

  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found then
    raise exception 'limit request % not found', p_request_id using errcode = 'P0002';
  end if;
  if v_request.status not in ('submitted', 'under_review', 'escalated') then
    raise exception 'request is % and cannot be decided', v_request.status using errcode = 'P0001';
  end if;
  -- 0063: four eyes (tci.limit_four_eyes_refusal).
  v_refusal := tci.limit_four_eyes_refusal(p_request_id, (select auth.uid()), 'credit');
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = '42501';
  end if;
  v_refusal := tci.limit_four_eyes_refusal(p_request_id, p_validator_id, 'credit');
  if v_refusal is not null then
    raise exception 'validator_%', v_refusal using errcode = 'P0001';
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
              when p_amount is not null
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
$function$
;

CREATE OR REPLACE FUNCTION tci.submit_adjustment_for_validation(p_decision_id uuid, p_validator_id uuid, p_new_amount numeric, p_new_payment_terms integer DEFAULT NULL::integer, p_comment text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_credit  tci.credit_limit_decisions%rowtype;
  v_band    tci.grade_band;
  v_amount_uzs numeric;
  v_kind    tci.validation_kind;
  v_row     tci.limit_validations%rowtype;
  v_id      uuid := gen_random_uuid();
  v_held    boolean := false;
  v_refusal text;
begin
  perform tci.require_role('commercial_underwriter');
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
  -- 0063: four eyes (tci.limit_four_eyes_refusal).
  v_refusal := tci.limit_four_eyes_refusal(v_credit.request_id, (select auth.uid()), 'commercial');
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = '42501';
  end if;
  v_refusal := tci.limit_four_eyes_refusal(v_credit.request_id, p_validator_id, 'commercial');
  if v_refusal is not null then
    raise exception 'validator_%', v_refusal using errcode = 'P0001';
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
              when v_amount_uzs > tci.user_authority_uzs((select auth.uid()), 'commercial', v_band) then 'required'
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
$function$
;

CREATE OR REPLACE FUNCTION tci.resolve_limit_validation(p_validation_id uuid, p_action text, p_amount numeric DEFAULT NULL::numeric, p_payment_terms integer DEFAULT NULL::integer, p_comment text DEFAULT NULL::text, p_forward_to uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform tci.require_role('credit_underwriter', 'commercial_underwriter');
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
    -- 0063: four eyes on the next validator as well.
    if tci.limit_four_eyes_refusal(v_row.request_id, p_forward_to, v_row.stream) is not null then
      raise exception 'validator_%', tci.limit_four_eyes_refusal(v_row.request_id, p_forward_to, v_row.stream)
        using errcode = 'P0001';
    end if;
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
$function$
;

CREATE OR REPLACE FUNCTION tci.validation_candidates(p_stream tci.authority_scope, p_band tci.grade_band, p_amount numeric, p_currency character, p_chain_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(user_id uuid, full_name text, email text, is_manager boolean, authority_uzs numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me        uuid := (select auth.uid());
  v_manager   uuid;
  v_needed    numeric;
begin
  perform tci.require_role('credit_underwriter', 'commercial_underwriter');
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
$function$
;

CREATE OR REPLACE FUNCTION tci.user_authority_uzs(p_user uuid, p_stream tci.authority_scope, p_band tci.grade_band)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- 0063: admin is no longer unlimited; authority comes from grants only.
  select coalesce((
      select max(g.max_amount * tci.latest_uzs_rate(g.currency_code))
        from tci.authority_grants g
       where g.user_id = p_user
         and g.applies_to = p_stream
         and g.grade_band = p_band
         and g.valid_from <= current_date
         and (g.valid_to is null or g.valid_to >= current_date)
         and tci.latest_uzs_rate(g.currency_code) is not null), 0)
$function$
;

CREATE OR REPLACE FUNCTION tci.hold_decision(p_decision_id uuid, p_comment text)
 RETURNS tci.credit_limit_decisions
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_row tci.credit_limit_decisions%rowtype;
begin
  perform tci.begin_internal_call();
  if not tci.has_role('sales') then
    raise exception 'only sales may hold a decision' using errcode = '42501';
  end if;
  if coalesce(btrim(p_comment), '') = '' then
    raise exception 'a hold needs a comment saying what must be discussed'
      using errcode = 'P0001';
  end if;

  select * into v_row from tci.credit_limit_decisions where id = p_decision_id;
  if not found then
    raise exception 'decision % not found or not accessible', p_decision_id
      using errcode = 'P0002';
  end if;
  if v_row.released_at is not null then
    raise exception 'the client has already seen this decision - it cannot be held'
      using errcode = 'P0001';
  end if;

  update tci.credit_limit_decisions
     set held = true, hold_comment = p_comment
   where id = p_decision_id
   returning * into v_row;

  perform tci.emit_workflow_event(
    'limit.held', 'credit_limit_decision', p_decision_id,
    jsonb_build_object('comment', p_comment),
    'commercial_underwriter'::tci.user_role
  );
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.release_decision(p_decision_id uuid, p_comment text DEFAULT NULL::text)
 RETURNS tci.credit_limit_decisions
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_row tci.credit_limit_decisions%rowtype;
begin
  perform tci.begin_internal_call();
  if not tci.has_role('sales') then
    raise exception 'only sales may release a decision to the client' using errcode = '42501';
  end if;
  update tci.credit_limit_decisions
     set released_at = coalesce(released_at, now()),
         release_kind = coalesce(release_kind, 'sales_confirmed'),
         held = false,
         hold_comment = null
   where id = p_decision_id
   returning * into v_row;
  if not found then
    raise exception 'decision % not found or not accessible', p_decision_id
      using errcode = 'P0002';
  end if;

  perform tci.emit_workflow_event(
    'limit.released', 'credit_limit_decision', p_decision_id,
    jsonb_build_object('release_kind', v_row.release_kind, 'comment', p_comment),
    'client'::tci.user_role
  );
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.revoke_effective_limit(p_policy_id uuid, p_entity_id uuid, p_comment text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_effective tci.credit_limit_decisions%rowtype;
  v_new tci.credit_limit_decisions%rowtype;
  v_band tci.grade_band;
begin
  if not tci.has_role('credit_underwriter') then
    raise exception 'only credit underwriting may revoke' using errcode = '42501';
  end if;
  -- 0047: mark the transaction trusted for the guard on credit_limit_decisions.
  perform tci.begin_internal_call();

  select d.* into v_effective
  from tci.credit_limit_decisions d
  join tci.credit_limit_requests r on r.id = d.request_id
  where r.policy_id = p_policy_id and r.entity_id = p_entity_id
    and d.lifecycle = 'effective'
    and d.outcome in ('approved', 'partial')
  order by d.decided_at desc
  limit 1
  for update of d;
  if not found then
    raise exception 'no effective approved limit for this (policy, entity)'
      using errcode = 'P0002';
  end if;

  -- The band of the limit being revoked decides which authority applies.
  v_band := tci.grade_band_for_assessment(v_effective.based_on_assessment_id);

  -- 0063: no admin bypass: admin holds no business decision rights.
  if tci.to_uzs(v_effective.approved_amount, v_effective.currency_code)
         > tci.my_authority_uzs(v_band) then
    raise exception 'revoking this limit exceeds your authority for grade band %', v_band
      using errcode = '42501';
  end if;

  update tci.credit_limit_decisions set lifecycle = 'revoked_lc' where id = v_effective.id;

  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code, valid_from, comment
  ) values (
    v_effective.request_id, 'revoked', 0, v_effective.currency_code, current_date, p_comment
  ) returning * into v_new;

  return jsonb_build_object('result', 'revoked', 'decision_id', v_new.id, 'grade_band', v_band);
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.set_buyer_adt(p_entity_id uuid, p_max_amount numeric, p_currency character, p_total_count integer, p_assessment_id uuid DEFAULT NULL::uuid, p_comment text DEFAULT NULL::text)
 RETURNS tci.buyer_adt
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_assessment uuid;
  v_band       tci.grade_band;
  v_amount_uzs numeric;
  v_row        tci.buyer_adt%rowtype;
begin
  perform tci.require_role('credit_underwriter');
  perform tci.begin_trusted_call();
  if p_max_amount is null or p_max_amount <= 0 or p_total_count is null or p_total_count < 1 then
    raise exception 'adt_invalid: the ADT needs a positive amount and at least one decision' using errcode = 'P0001';
  end if;
  -- The band of the buyer's latest rating (or the one named): an ADT is set
  -- at a review, on the rating it confirms.
  if p_assessment_id is not null then
    select a.id into v_assessment from tci.credit_assessments a
     where a.id = p_assessment_id and a.entity_id = p_entity_id;
    if not found then
      raise exception 'adt_assessment_mismatch: that rating is not this buyer''s' using errcode = 'P0001';
    end if;
  else
    select a.id into v_assessment from tci.credit_assessments a
     where a.entity_id = p_entity_id order by a.created_at desc limit 1;
  end if;
  if v_assessment is null then
    raise exception 'adt_no_rating: rate the buyer before setting an ADT' using errcode = 'P0001';
  end if;
  v_band := tci.grade_band_for_assessment(v_assessment);

  -- Not above the setter's own authority for that band.
  v_amount_uzs := tci.uzs_or_null(p_max_amount, p_currency);
  if v_amount_uzs is null then
    raise exception 'adt_fx_missing: no UZS rate for %', p_currency using errcode = 'P0001';
  end if;
  if v_amount_uzs > tci.my_authority_uzs(v_band) then
    raise exception 'adt_beyond_authority: the ADT amount is beyond your authority for rating band %', v_band
      using errcode = 'P0001';
  end if;

  update tci.buyer_adt
     set status = 'replaced', ended_at = now(), ended_by = (select auth.uid()),
         suspended_reason = null, suspended_at = null
   where entity_id = p_entity_id and status in ('active', 'suspended');

  insert into tci.buyer_adt (entity_id, max_amount, currency_code, total_count, grade_band,
                             assessment_id, comment, set_by)
  values (p_entity_id, p_max_amount, p_currency, p_total_count, v_band, v_assessment,
          nullif(btrim(p_comment), ''), (select auth.uid()))
  returning * into v_row;

  perform tci.emit_workflow_event('adt.set', 'legal_entity', p_entity_id,
    jsonb_build_object('adt_id', v_row.id, 'max_amount', p_max_amount, 'currency', p_currency,
                       'total_count', p_total_count, 'grade_band', v_band), null);
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.disable_buyer_adt(p_entity_id uuid, p_comment text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform tci.require_role('credit_underwriter');
  perform tci.begin_trusted_call();
  update tci.buyer_adt
     set status = 'disabled', ended_at = now(), ended_by = (select auth.uid()),
         suspended_reason = null, suspended_at = null
   where entity_id = p_entity_id and status in ('active', 'suspended');
  if not found then
    raise exception 'adt_none: this buyer has no ADT' using errcode = 'P0002';
  end if;
  perform tci.emit_workflow_event('adt.disabled', 'legal_entity', p_entity_id,
    jsonb_build_object('comment', nullif(btrim(p_comment), '')), null);
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.set_buyer_adt_block(p_entity_id uuid, p_blocked boolean, p_reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform tci.require_role('credit_underwriter');
  perform tci.begin_trusted_call();
  if p_blocked and coalesce(btrim(p_reason), '') = '' then
    raise exception 'adt_block_reason: say why auto decisions are banned for this buyer' using errcode = 'P0001';
  end if;
  insert into tci.buyer_adt_blocks (entity_id, blocked, reason, set_by)
  values (p_entity_id, p_blocked, nullif(btrim(p_reason), ''), (select auth.uid()))
  on conflict (entity_id) do update
     set blocked = excluded.blocked, reason = excluded.reason, set_by = excluded.set_by, set_at = now();
  perform tci.emit_workflow_event(case when p_blocked then 'adt.blocked' else 'adt.unblocked' end,
    'legal_entity', p_entity_id, jsonb_build_object('reason', nullif(btrim(p_reason), '')), null);
  if p_blocked then
    perform tci.suspend_buyer_adt(p_entity_id, 'manual_block');
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.set_group_limit(p_ultimate_parent_id uuid, p_max_amount numeric, p_currency character, p_valid_from date DEFAULT CURRENT_DATE, p_comment text DEFAULT NULL::text)
 RETURNS tci.group_limits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row  tci.group_limits%rowtype;
  v_band tci.grade_band;
  v_assessment uuid;
  v_amount_uzs numeric;
  v_authority  numeric;
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('credit_underwriter') then
    raise exception 'only credit underwriting may set a group limit' using errcode = '42501';
  end if;
  if coalesce(p_max_amount, 0) <= 0 then
    raise exception 'a group limit needs a positive amount' using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.legal_entities where id = p_ultimate_parent_id) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;

  -- 0063: no admin bypass: admin holds no business decision rights
  select a.id into v_assessment
    from tci.credit_assessments a
   where a.entity_id = p_ultimate_parent_id
   order by a.created_at desc limit 1;
  v_band := tci.grade_band_for_assessment(v_assessment);
  v_amount_uzs := tci.to_uzs(p_max_amount, p_currency);
  v_authority := tci.my_authority_uzs(v_band);
  if v_amount_uzs > v_authority then
    raise exception 'a group limit of % exceeds your authority for grade band % (% > %)',
      p_max_amount, v_band, v_amount_uzs, v_authority using errcode = '42501';
  end if;

  -- Close the standing limit rather than editing it.
  update tci.group_limits
     set valid_to = greatest(coalesce(p_valid_from, current_date) - 1, valid_from - 1)
   where ultimate_parent_entity_id = p_ultimate_parent_id
     and valid_to is null;

  insert into tci.group_limits (
    ultimate_parent_entity_id, max_amount, currency_code, valid_from, comment
  ) values (
    p_ultimate_parent_id, p_max_amount, p_currency,
    coalesce(p_valid_from, current_date), p_comment
  ) returning * into v_row;

  perform tci.emit_workflow_event(
    'group.limit_set', 'legal_entity', p_ultimate_parent_id,
    jsonb_build_object('amount', p_max_amount, 'currency', p_currency,
                       'group_limit_id', v_row.id),
    'credit_underwriter'::tci.user_role);

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION tci.end_group_limit(p_ultimate_parent_id uuid, p_valid_to date DEFAULT NULL::date)
 RETURNS tci.group_limits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row tci.group_limits%rowtype;
begin
  perform tci.begin_trusted_call();
  if not tci.has_role('credit_underwriter') then
    raise exception 'only credit underwriting may remove a group limit' using errcode = '42501';
  end if;
  update tci.group_limits
     set valid_to = greatest(coalesce(p_valid_to, current_date - 1), valid_from - 1)
   where ultimate_parent_entity_id = p_ultimate_parent_id
     and valid_to is null
   returning * into v_row;
  if not found then
    raise exception 'this group has no limit in force' using errcode = 'P0002';
  end if;

  perform tci.emit_workflow_event(
    'group.limit_removed', 'legal_entity', p_ultimate_parent_id,
    jsonb_build_object('group_limit_id', v_row.id, 'valid_to', v_row.valid_to),
    'credit_underwriter'::tci.user_role);

  return v_row;
end;
$function$
;

-- ---------------------------------------------------------------------------
-- 4. The decision queue: no admin shortcut; whether the request is the
--    caller's own (four eyes)
-- ---------------------------------------------------------------------------

-- create or replace resets the view's options, so security_invoker is restated
-- (0053); the assertion in section 6 checks it.
create or replace view tci.v_limit_request_queue
with (security_invoker = true) as
 SELECT r.id AS request_id,
    r.status,
    r.entity_id AS buyer_entity_id,
    b.name AS buyer_name,
    b.country_code AS buyer_country,
    r.policy_id,
    r.insurance_request_id,
    r.requested_amount,
    r.currency_code,
    r.submitted_at,
    a.id AS assessment_id,
    a.rating_grade AS grade,
    tci.grade_band_for_assessment(a.id) AS band,
    r.requested_amount * tci.latest_uzs_rate(r.currency_code) AS amount_uzs,
    tci.latest_uzs_rate(r.currency_code) IS NULL AS rate_missing,
    COALESCE(auth_.authority_uzs, 0::numeric) AS my_authority_uzs,
    tci.latest_uzs_rate(r.currency_code) IS NOT NULL AND (r.requested_amount * tci.latest_uzs_rate(r.currency_code)) <= COALESCE(auth_.authority_uzs, 0::numeric) AS decide_alone,
    r.requested_by = (( SELECT auth.uid() AS uid)) AS own_request
   FROM tci.credit_limit_requests r
     JOIN tci.legal_entities b ON b.id = r.entity_id
     LEFT JOIN LATERAL ( SELECT ca.id,
            ca.rating_grade
           FROM tci.credit_assessments ca
          WHERE ca.entity_id = r.entity_id
          ORDER BY ca.created_at DESC
         LIMIT 1) a ON true
     LEFT JOIN LATERAL ( SELECT max(g.max_amount * tci.latest_uzs_rate(g.currency_code)) AS authority_uzs
           FROM tci.authority_grants g
          WHERE g.user_id = (( SELECT auth.uid() AS uid)) AND g.applies_to = 'credit'::tci.authority_scope AND g.grade_band = tci.grade_band_for_assessment(a.id) AND g.valid_from <= CURRENT_DATE AND (g.valid_to IS NULL OR g.valid_to >= CURRENT_DATE)) auth_ ON true
  WHERE r.status = ANY (ARRAY['submitted'::tci.limit_request_status, 'under_review'::tci.limit_request_status, 'escalated'::tci.limit_request_status]);

-- ---------------------------------------------------------------------------
-- 5. Grants and the definer allow-list
-- ---------------------------------------------------------------------------

revoke all on function tci.jwt_session_id() from public, anon;
revoke all on function tci.acting_role() from public, anon;
revoke all on function tci.held_roles() from public, anon;
revoke all on function tci.set_acting_role(tci.user_role) from public, anon;
revoke all on function tci.limit_four_eyes_refusal(uuid, uuid, tci.authority_scope) from public, anon;
grant execute on function tci.jwt_session_id() to authenticated, service_role;
grant execute on function tci.acting_role() to authenticated, service_role;
grant execute on function tci.held_roles() to authenticated, service_role;
grant execute on function tci.set_acting_role(tci.user_role) to authenticated, service_role;
grant execute on function tci.limit_four_eyes_refusal(uuid, uuid, tci.authority_scope) to authenticated, service_role;

CREATE OR REPLACE FUNCTION tci.definer_gate_allowlist()
 RETURNS TABLE(proname text, justification text)
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  values
    ('has_role',                 'reads only the caller''s own acting role and tci.user_roles rows; it IS the gate'),
    ('is_staff',                 'reads only the caller''s own acting role and tci.user_roles rows; it IS the gate'),
    ('current_user_roles',       'returns only the caller''s own acting role'),
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
    ('is_validation_participant','an RLS predicate of tci.limit_validations: answers only whether the CALLER is in a validation chain'),
    ('record_sign_in',           'marks only the caller''s own fresh sign-in ticket succeeded, keyed by auth.uid(), same network'),
    ('acknowledge_sign_in_failures','writes only the caller''s own acknowledgement watermark, keyed by auth.uid()'),
    ('my_failed_sign_ins',       'lists only the caller''s own counted sign-in failures, keyed by auth.uid()'),
    ('acting_role',              'answers only the caller''s own acting role, from roles they hold; part of the gate'),
    ('held_roles',               'returns only the caller''s own roles'),
    ('set_acting_role',          'writes only the caller''s own acting role for their own session, from roles they hold')
$function$
;

-- ---------------------------------------------------------------------------
-- 6. Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_name text;
  v_src  text;
begin
  for v_name in select unnest(array['has_role', 'is_staff', 'current_user_roles']) loop
    select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'tci' and p.proname = v_name;
    if v_src not like '%tci.acting_role()%' then
      raise exception '0063: % does not answer for the acting role', v_name;
    end if;
  end loop;

  for v_name in select unnest(array['decide_limit_request', 'adjust_limit_commercial', 'start_limit_review',
                                    'submit_limit_for_validation', 'submit_adjustment_for_validation',
                                    'resolve_limit_validation', 'validation_candidates', 'user_authority_uzs',
                                    'hold_decision', 'release_decision', 'revoke_effective_limit',
                                    'set_buyer_adt', 'disable_buyer_adt', 'set_buyer_adt_block',
                                    'set_group_limit', 'end_group_limit']) loop
    select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'tci' and p.proname = v_name;
    if v_src like '%''admin''%' then
      raise exception '0063: % still gives admin a business right', v_name;
    end if;
  end loop;

  for v_name in select unnest(array['decide_limit_request', 'adjust_limit_commercial', 'start_limit_review',
                                    'submit_limit_for_validation', 'submit_adjustment_for_validation',
                                    'resolve_limit_validation']) loop
    select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'tci' and p.proname = v_name;
    if v_src not like '%tci.limit_four_eyes_refusal(%' then
      raise exception '0063: % does not apply the four-eyes rule', v_name;
    end if;
  end loop;

  if not coalesce((select 'security_invoker=true' = any (c.reloptions)
                      from pg_class c where c.oid = 'tci.v_limit_request_queue'::regclass), false) then
    raise exception '0063: tci.v_limit_request_queue lost security_invoker';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'tci.acting_roles'::regclass) then
    raise exception '0063: RLS is not enabled on tci.acting_roles';
  end if;
  if has_table_privilege('authenticated', 'tci.acting_roles', 'select')
     or has_table_privilege('authenticated', 'tci.acting_roles', 'insert')
     or has_table_privilege('authenticated', 'tci.acting_roles', 'update') then
    raise exception '0063: an API role can reach tci.acting_roles directly';
  end if;
  if has_function_privilege('anon', 'tci.set_acting_role(tci.user_role)', 'execute') then
    raise exception '0063: anon may set an acting role';
  end if;
end;
$$;
