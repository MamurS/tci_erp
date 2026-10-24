-- 0071_authority_levels.sql
--
-- What: authority LEVELS and the credit / commercial COMMITTEE (Prompt 29
--       §4a), replacing the named validator of 0060.
--       * tci.authority_levels: per stream (credit | commercial) five ranks;
--         rank 5 is the committee. Ranks 1–4 carry band authority as grants
--         of the LEVEL (tci.authority_level_grants) and hold named members
--         (tci.authority_level_members); a person sits at one rank 1–4 per
--         stream and may also sit on the committee. The committee has no
--         amount cap: it is the top of the chain.
--       * A person's authority is the larger of their personal grants
--         (tci.authority_grants, unchanged) and their level's grants.
--       * A decision beyond the author's authority is ROUTED, not addressed
--         to a person: workflow_settings.authority_routing 'direct' (the
--         default: straight to the lowest rank whose authority covers it,
--         the ranks in between told for information —
--         'limit_validation_fyi') or 'sequential' (rank by rank upwards; an
--         approval beyond the approver's own authority goes on to the next
--         rank). A voluntary second opinion goes to the next rank up. Any
--         eligible member of the level answers; four eyes over the whole
--         chain, as before.
--       * The committee decides by VOTE (tci.committee_votes, immutable):
--         eligible members vote approve / reject / abstain; a member with a
--         conflict of interest declares it and is barred
--         (tci.committee_conflicts); so are the requester, the proposer,
--         everyone earlier in the chain and — in separate credit analysis —
--         whoever rated the buyer. The chair (or, when the chair is barred
--         or unset, any eligible member) closes the vote once at least half
--         of the electorate has voted: more approvals than rejections
--         approve, more rejections reject, a tie is broken by the chair's
--         own vote, and without it the proposal goes back to its author.
--       * Naming a validator is retired: submit_*_for_validation refuse a
--         validator (named_validator_retired). Steps already pending with a
--         named validator are answered as before.
--
-- The Agenda type it adds (0070 adds the enum value):
--
--   limit_validation_fyi  the eligible members of a skipped rank (persons)
--                         normal; MANUAL close (information: nothing
--                         downstream resolves it)
--   limit_validation      (0060's type) now opens for every eligible member
--                         of the level; before the committee its title is
--                         agenda.tasks.limit_validation_committee and a vote
--                         or a declared conflict closes the member's own copy
-- Why:  authority by seniority level and a committee at the top is how
--       Allianz Trade / Coface / Atradius structure credit authority; a
--       proposal reaches the level that may decide it, not a colleague the
--       author chose.

-- ---------------------------------------------------------------------------
-- 1. Settings and tables
-- ---------------------------------------------------------------------------

alter table tci.workflow_settings
  add column if not exists authority_routing text not null default 'direct'
    check (authority_routing in ('direct', 'sequential'));

comment on column tci.workflow_settings.authority_routing is
  'direct: a proposal goes to the lowest authority level that covers it, the skipped ranks told for information; sequential: rank by rank upwards (0071).';

create table if not exists tci.authority_levels (
  id           uuid primary key default gen_random_uuid(),
  stream       tci.authority_scope not null,
  rank         smallint not null check (rank between 1 and 5),
  is_committee boolean generated always as (rank = 5) stored,
  chair_id     uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  unique (stream, rank)
);
comment on table tci.authority_levels is
  'Authority levels per stream: ranks 1–4 carry band authority (authority_level_grants), rank 5 is the committee (0071).';

insert into tci.authority_levels (stream, rank)
select s, r from unnest(array['credit', 'commercial']::tci.authority_scope[]) s, generate_series(1, 5) r
on conflict (stream, rank) do nothing;

create table if not exists tci.authority_level_grants (
  id            uuid primary key default gen_random_uuid(),
  level_id      uuid not null references tci.authority_levels (id),
  grade_band    tci.grade_band not null,
  max_amount    numeric(18,2) not null check (max_amount > 0),
  currency_code char(3) not null references tci.currencies (code),
  valid_from    date not null default current_date,
  valid_to      date,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from - 1)
);
create index if not exists authority_level_grants_level_idx on tci.authority_level_grants (level_id, grade_band);

create table if not exists tci.authority_level_members (
  id         uuid primary key default gen_random_uuid(),
  level_id   uuid not null references tci.authority_levels (id),
  user_id    uuid not null references auth.users (id),
  valid_from date not null default current_date,
  valid_to   date,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from - 1)
);
create index if not exists authority_level_members_user_idx on tci.authority_level_members (user_id);
create index if not exists authority_level_members_level_idx on tci.authority_level_members (level_id);

alter table tci.limit_validations
  add column if not exists level_id uuid references tci.authority_levels (id);
alter table tci.limit_validations alter column validator_id drop not null;
alter table tci.limit_validations
  add constraint limit_validations_addressee check (validator_id is not null or level_id is not null);

create table if not exists tci.committee_votes (
  id            uuid primary key default gen_random_uuid(),
  validation_id uuid not null references tci.limit_validations (id),
  voter         uuid not null references auth.users (id),
  vote          text not null check (vote in ('approve', 'reject', 'abstain')),
  comment       text,
  voted_at      timestamptz not null default now(),
  unique (validation_id, voter)
);

create table if not exists tci.committee_conflicts (
  id            uuid primary key default gen_random_uuid(),
  validation_id uuid not null references tci.limit_validations (id),
  member        uuid not null references auth.users (id),
  reason        text not null check (btrim(reason) <> ''),
  declared_at   timestamptz not null default now(),
  unique (validation_id, member)
);

create or replace function tci.guard_immutable_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is a record and is never changed', tg_table_name using errcode = '42501';
end;
$$;

create trigger committee_votes_immutable before update on tci.committee_votes
  for each row execute function tci.guard_immutable_row();
create trigger committee_conflicts_immutable before update on tci.committee_conflicts
  for each row execute function tci.guard_immutable_row();

alter table tci.authority_levels enable row level security;
alter table tci.authority_level_grants enable row level security;
alter table tci.authority_level_members enable row level security;
alter table tci.committee_votes enable row level security;
alter table tci.committee_conflicts enable row level security;

create policy "authority_levels: staff read" on tci.authority_levels for select using (tci.is_staff());
create policy "authority_level_grants: staff read" on tci.authority_level_grants for select using (tci.is_staff());
create policy "authority_level_members: staff read" on tci.authority_level_members for select using (tci.is_staff());
create policy "committee_votes: the chain" on tci.committee_votes for select
  using (tci.has_role('admin') or tci.is_validation_participant(
           (select v.chain_id from tci.limit_validations v where v.id = validation_id)));
create policy "committee_conflicts: the chain" on tci.committee_conflicts for select
  using (tci.has_role('admin') or tci.is_validation_participant(
           (select v.chain_id from tci.limit_validations v where v.id = validation_id)));

revoke all on tci.authority_levels, tci.authority_level_grants, tci.authority_level_members,
              tci.committee_votes, tci.committee_conflicts from public, anon, authenticated;
grant select on tci.authority_levels, tci.authority_level_grants, tci.authority_level_members,
                tci.committee_votes, tci.committee_conflicts to authenticated;
grant select, insert on tci.authority_levels, tci.authority_level_grants, tci.authority_level_members,
                        tci.committee_votes, tci.committee_conflicts to service_role;

-- ---------------------------------------------------------------------------
-- 2. Authority with levels
-- ---------------------------------------------------------------------------

-- Band authority a user holds through their rank 1–4 level (UZS; a grant in a
-- currency with no rate is skipped). Invoker: staff read the level tables.
create or replace function tci.level_authority_of(p_user uuid, p_stream tci.authority_scope, p_band tci.grade_band)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(max(g.max_amount * tci.latest_uzs_rate(g.currency_code)), 0)
    from tci.authority_level_members m
    join tci.authority_levels l on l.id = m.level_id and l.stream = p_stream and l.rank < 5
    join tci.authority_level_grants g on g.level_id = l.id and g.grade_band = p_band
   where m.user_id = p_user
     and m.valid_from <= current_date and (m.valid_to is null or m.valid_to >= current_date)
     and g.valid_from <= current_date and (g.valid_to is null or g.valid_to >= current_date)
     and tci.latest_uzs_rate(g.currency_code) is not null
$$;

-- The rank (1–4) a user holds in a stream today; 0 without one.
create or replace function tci.user_rank(p_user uuid, p_stream tci.authority_scope)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(max(l.rank), 0)::integer
    from tci.authority_level_members m
    join tci.authority_levels l on l.id = m.level_id and l.stream = p_stream and l.rank < 5
   where m.user_id = p_user
     and m.valid_from <= current_date and (m.valid_to is null or m.valid_to >= current_date)
$$;

-- A level's own band authority (UZS); the committee is unlimited.
create or replace function tci.level_authority_uzs(p_level_id uuid, p_band tci.grade_band)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case when l.is_committee then 'Infinity'::numeric else coalesce((
           select max(g.max_amount * tci.latest_uzs_rate(g.currency_code))
             from tci.authority_level_grants g
            where g.level_id = l.id and g.grade_band = p_band
              and g.valid_from <= current_date and (g.valid_to is null or g.valid_to >= current_date)
              and tci.latest_uzs_rate(g.currency_code) is not null), 0) end
    from tci.authority_levels l
   where l.id = p_level_id
$$;

CREATE OR REPLACE FUNCTION tci.my_authority_uzs(p_band tci.grade_band)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  -- 0071: personal grants or the caller's level, whichever is larger.
  select greatest(
    coalesce(max(tci.to_uzs(g.max_amount, g.currency_code)), 0),
    tci.level_authority_of((select auth.uid()), 'credit', p_band))
  from tci.authority_grants g
  where g.user_id = (select auth.uid())
    and g.applies_to = 'credit'
    and g.grade_band = p_band
    and g.valid_from <= current_date
    and (g.valid_to is null or g.valid_to >= current_date)
$function$;

create or replace function tci.my_stream_authority_uzs(p_stream tci.authority_scope, p_band tci.grade_band)
returns numeric
language sql
stable
set search_path = ''
as $$
  select greatest(
    coalesce(max(tci.to_uzs(g.max_amount, g.currency_code)), 0),
    tci.level_authority_of((select auth.uid()), p_stream, p_band))
  from tci.authority_grants g
  where g.user_id = (select auth.uid())
    and g.applies_to = p_stream
    and g.grade_band = p_band
    and g.valid_from <= current_date
    and (g.valid_to is null or g.valid_to >= current_date)
$$;

CREATE OR REPLACE FUNCTION tci.user_authority_uzs(p_user uuid, p_stream tci.authority_scope, p_band tci.grade_band)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- 0063: admin is no longer unlimited; authority comes from grants only.
  -- 0071: personal grants or the person's level, whichever is larger.
  select greatest(coalesce((
      select max(g.max_amount * tci.latest_uzs_rate(g.currency_code))
        from tci.authority_grants g
       where g.user_id = p_user
         and g.applies_to = p_stream
         and g.grade_band = p_band
         and g.valid_from <= current_date
         and (g.valid_to is null or g.valid_to >= current_date)
         and tci.latest_uzs_rate(g.currency_code) is not null), 0),
    tci.level_authority_of(p_user, p_stream, p_band))
$function$;

CREATE OR REPLACE FUNCTION tci.underwriters_covering(p_band tci.grade_band, p_amount numeric, p_currency character)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform tci.require_staff_or_internal();
  -- 0071: personal grants or the level, as tci.user_authority_uzs.
  if tci.latest_uzs_rate(p_currency) is null then
    return;
  end if;
  return query
  select distinct ur.user_id
    from tci.user_roles ur
   where ur.role = 'credit_underwriter'
     and tci.user_authority_uzs(ur.user_id, 'credit', p_band) > 0
     and tci.user_authority_uzs(ur.user_id, 'credit', p_band) >= p_amount * tci.latest_uzs_rate(p_currency);
end;
$function$;

-- The committee is resolving this step (set only by close_committee_vote).
create or replace function tci.committee_resolving()
returns uuid
language sql
stable
set search_path = ''
as $$ select nullif(current_setting('tci.committee_resolution', true), '')::uuid $$;

-- ---------------------------------------------------------------------------
-- 3. Who may answer a level, and where a proposal goes
-- ---------------------------------------------------------------------------

-- Members of a level who may answer a step of this request now: active, of the
-- stream's department, not banned, four eyes clear, not anywhere in the chain,
-- not conflicted on the step.
create or replace function tci.level_eligible_members(
  p_level_id uuid, p_request_id uuid, p_chain_id uuid default null, p_step_id uuid default null)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_stream tci.authority_scope;
begin
  perform tci.require_staff_or_internal();
  select l.stream into v_stream from tci.authority_levels l where l.id = p_level_id;
  return query
    select distinct m.user_id
      from tci.authority_level_members m
      join auth.users u on u.id = m.user_id
     where m.level_id = p_level_id
       and m.valid_from <= current_date and (m.valid_to is null or m.valid_to >= current_date)
       and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
       and exists (select 1 from tci.user_roles r where r.user_id = m.user_id and r.role = tci.validation_role(v_stream))
       and tci.limit_four_eyes_refusal(p_request_id, m.user_id, v_stream) is null
       and not exists (select 1 from tci.limit_validations v
                        where p_chain_id is not null and v.chain_id = p_chain_id
                          and m.user_id in (v.proposed_by, v.validator_id, v.forwarded_by, v.resolved_by))
       and not exists (select 1 from tci.committee_conflicts c
                        where p_step_id is not null and c.validation_id = p_step_id and c.member = m.user_id);
end;
$$;

-- The level a proposal goes to, above p_from_rank: 'required' + direct → the
-- lowest rank whose authority covers the amount (the committee when none);
-- 'voluntary', sequential, or a forward → the next rank up. Ranks nobody can
-- answer are skipped. NULL when no level can take it.
create or replace function tci.route_validation_level(
  p_stream tci.authority_scope, p_band tci.grade_band, p_amount_uzs numeric, p_by_amount boolean,
  p_request_id uuid, p_chain_id uuid, p_from_rank integer)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_level tci.authority_levels;
begin
  perform tci.require_staff_or_internal();
  for v_level in
    select * from tci.authority_levels l
     where l.stream = p_stream and l.rank > coalesce(p_from_rank, 0)
     order by l.rank
  loop
    continue when not exists (
      select 1 from tci.level_eligible_members(v_level.id, p_request_id, p_chain_id, null) m
       where m <> (select auth.uid()));
    if not p_by_amount or v_level.is_committee
       or (p_amount_uzs is not null and tci.level_authority_uzs(v_level.id, p_band) >= p_amount_uzs) then
      return v_level.id;
    end if;
  end loop;
  return null;
end;
$$;

-- Eligible members of a level, the caller excluded (the one routing it).
create or replace function tci.level_answerers(p_level_id uuid, p_request_id uuid, p_chain_id uuid, p_step_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m order by m), '{}'::uuid[])
    from tci.level_eligible_members(p_level_id, p_request_id, p_chain_id, p_step_id) m
   where m is distinct from (select auth.uid())
$$;

-- The ranks a direct routing skips, between the author's rank and the
-- target: their eligible members are told for information.
create or replace function tci.skipped_rank_members(
  p_stream tci.authority_scope, p_from_rank integer, p_to_level uuid, p_request_id uuid, p_chain_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct m), '{}'::uuid[])
    from tci.authority_levels l
    cross join lateral tci.level_eligible_members(l.id, p_request_id, p_chain_id, null) m
   where l.stream = p_stream
     and l.rank > coalesce(p_from_rank, 0)
     and l.rank < (select t.rank from tci.authority_levels t where t.id = p_to_level)
     and m is distinct from (select auth.uid())
$$;

-- What the screen shows before sending: where it would go, to whom, who is
-- told. Same rules as the submit functions.
create or replace function tci.validation_route_preview(
  p_request_id uuid, p_stream tci.authority_scope, p_band tci.grade_band, p_amount numeric, p_currency character)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_amount_uzs numeric;
  v_required   boolean;
  v_rank       integer;
  v_level      tci.authority_levels;
  v_level_id   uuid;
  v_routing    text;
  v_members    uuid[];
  v_fyi        uuid[] := '{}';
begin
  perform tci.require_role('credit_underwriter', 'commercial_underwriter');
  perform tci.begin_trusted_call();
  v_amount_uzs := case when p_amount is null then null else tci.to_uzs(p_amount, p_currency) end;
  v_required := v_amount_uzs is not null and v_amount_uzs > tci.my_stream_authority_uzs(p_stream, p_band);
  v_rank := tci.user_rank((select auth.uid()), p_stream);
  select s.authority_routing into v_routing from tci.workflow_settings s where s.id;
  v_level_id := tci.route_validation_level(p_stream, p_band, v_amount_uzs,
                  v_required and v_routing = 'direct', p_request_id, null, v_rank);
  if v_level_id is null then
    return jsonb_build_object('available', false, 'kind', case when v_required then 'required' else 'voluntary' end,
                              'routing', v_routing, 'my_rank', v_rank);
  end if;
  select * into v_level from tci.authority_levels where id = v_level_id;
  v_members := tci.level_answerers(v_level_id, p_request_id, null, null);
  if v_required and v_routing = 'direct' then
    v_fyi := tci.skipped_rank_members(p_stream, v_rank, v_level_id, p_request_id, null);
  end if;
  return jsonb_build_object(
    'available', true,
    'kind', case when v_required then 'required' else 'voluntary' end,
    'routing', v_routing,
    'my_rank', v_rank,
    'level_id', v_level.id, 'rank', v_level.rank, 'is_committee', v_level.is_committee,
    'members', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m, 'name', tci.staff_name(m)) order by tci.staff_name(m)), '[]'::jsonb)
                  from unnest(v_members) m),
    'fyi', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m, 'name', tci.staff_name(m)) order by tci.staff_name(m)), '[]'::jsonb)
              from unnest(v_fyi) m));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Sending a proposal to a level
-- ---------------------------------------------------------------------------

create or replace function tci.emit_level_validation_requested(p_row tci.limit_validations, p_fyi uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity uuid;
  v_name   text;
  v_level  tci.authority_levels;
begin
  perform tci.require_internal_call();
  select r.entity_id, e.name into v_entity, v_name
    from tci.credit_limit_requests r join tci.legal_entities e on e.id = r.entity_id
   where r.id = p_row.request_id;
  select * into v_level from tci.authority_levels where id = p_row.level_id;
  perform tci.emit_workflow_event(
    'limit.validation_requested', 'limit_validation', p_row.id,
    jsonb_build_object(
      'request_id', p_row.request_id, 'entity_id', v_entity, 'entity_name', v_name,
      'stream', p_row.stream, 'kind', p_row.kind, 'outcome', p_row.outcome,
      'amount', p_row.amount, 'currency', p_row.currency_code, 'grade_band', p_row.grade_band,
      'proposed_by', p_row.proposed_by, 'proposed_by_name', tci.staff_name(p_row.proposed_by),
      'forwarded_by', p_row.forwarded_by,
      'level_id', v_level.id, 'level_rank', v_level.rank, 'is_committee', v_level.is_committee,
      'members', to_jsonb(tci.level_answerers(p_row.level_id, p_row.request_id, p_row.chain_id, p_row.id)),
      'fyi', to_jsonb(coalesce(p_fyi, '{}'::uuid[]))),
    null, null);
end;
$$;

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
  v_routing  text;
  v_rank     integer;
  v_level    uuid;
  v_fyi      uuid[] := '{}';
begin
  perform tci.require_role('credit_underwriter');
  perform tci.begin_trusted_call();

  -- 0071: a proposal goes to an authority LEVEL, never to a chosen person.
  if p_validator_id is not null then
    raise exception 'named_validator_retired: a proposal goes to the authority level that may decide it, not to a chosen colleague'
      using errcode = 'P0001';
  end if;

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

  select s.authority_routing into v_routing from tci.workflow_settings s where s.id;
  v_rank := tci.user_rank((select auth.uid()), 'credit');
  v_level := tci.route_validation_level('credit', v_band, v_amount_uzs,
               v_kind = 'required' and v_routing = 'direct', p_request_id, null, v_rank);
  if v_level is null then
    raise exception 'authority_level_missing: no authority level above yours can take this decision — ask the administrator to set up the levels'
      using errcode = 'P0001';
  end if;
  if v_kind = 'required' and v_routing = 'direct' then
    v_fyi := tci.skipped_rank_members('credit', v_rank, v_level, p_request_id, null);
  end if;

  insert into tci.limit_validations (
    id, chain_id, request_id, stream, kind, outcome, amount, currency_code,
    valid_from, valid_until, conditions, assessment_id, grade_band, amount_uzs, comment,
    proposed_by, validator_id, level_id)
  values (
    v_id, v_id, p_request_id, 'credit', v_kind, p_outcome, p_amount, v_currency,
    coalesce(p_valid_from, current_date), p_valid_until, coalesce(p_conditions, '[]'::jsonb),
    p_assessment_id, v_band, v_amount_uzs, nullif(btrim(p_comment), ''),
    (select auth.uid()), null, v_level)
  returning * into v_row;

  update tci.credit_limit_requests set status = 'escalated' where id = p_request_id;

  perform tci.emit_level_validation_requested(v_row, v_fyi);
  return jsonb_build_object('result', 'on_validation', 'validation_id', v_row.id, 'kind', v_kind,
                            'grade_band', v_band, 'level_id', v_level,
                            'rank', (select l.rank from tci.authority_levels l where l.id = v_level));
end;
$function$;

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
  v_routing text;
  v_rank    integer;
  v_level   uuid;
  v_fyi     uuid[] := '{}';
begin
  perform tci.require_role('commercial_underwriter');
  perform tci.begin_trusted_call();

  -- 0071: a proposal goes to an authority LEVEL, never to a chosen person.
  if p_validator_id is not null then
    raise exception 'named_validator_retired: a proposal goes to the authority level that may decide it, not to a chosen colleague'
      using errcode = 'P0001';
  end if;

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

  select s.authority_routing into v_routing from tci.workflow_settings s where s.id;
  v_rank := tci.user_rank((select auth.uid()), 'commercial');
  v_level := tci.route_validation_level('commercial', v_band, v_amount_uzs,
               v_kind = 'required' and v_routing = 'direct', v_credit.request_id, null, v_rank);
  if v_level is null then
    raise exception 'authority_level_missing: no authority level above yours can take this decision — ask the administrator to set up the levels'
      using errcode = 'P0001';
  end if;
  if v_kind = 'required' and v_routing = 'direct' then
    v_fyi := tci.skipped_rank_members('commercial', v_rank, v_level, v_credit.request_id, null);
  end if;

  -- Nothing reaches the client while the adjustment is weighed: hold the
  -- credit decision unless the client has already seen it.
  if v_credit.released_at is null and not v_credit.held then
    update tci.credit_limit_decisions set held = true where id = p_decision_id;
    v_held := true;
  end if;

  insert into tci.limit_validations (
    id, chain_id, request_id, stream, kind, outcome, amount, currency_code, payment_terms_days,
    valid_from, valid_until, assessment_id, adjusts_decision_id, grade_band, amount_uzs, comment,
    proposed_by, validator_id, level_id, held_credit_decision)
  values (
    v_id, v_id, v_credit.request_id, 'commercial', v_kind, v_credit.outcome, p_new_amount,
    v_credit.currency_code, coalesce(p_new_payment_terms, v_credit.payment_terms_days),
    v_credit.valid_from, v_credit.valid_until, v_credit.based_on_assessment_id, p_decision_id,
    v_band, v_amount_uzs, nullif(btrim(p_comment), ''),
    (select auth.uid()), null, v_level, v_held)
  returning * into v_row;

  perform tci.emit_level_validation_requested(v_row, v_fyi);
  return jsonb_build_object('result', 'on_validation', 'validation_id', v_row.id, 'kind', v_kind,
                            'grade_band', v_band, 'level_id', v_level,
                            'rank', (select l.rank from tci.authority_levels l where l.id = v_level));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Answering a step
-- ---------------------------------------------------------------------------

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
  v_action   text := p_action;
  v_level    tci.authority_levels;
  v_next_level uuid;
begin
  perform tci.require_role('credit_underwriter', 'commercial_underwriter');
  perform tci.begin_trusted_call();

  select * into v_row from tci.limit_validations where id = p_validation_id for update;
  if not found then
    raise exception 'validation % not found', p_validation_id using errcode = 'P0002';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'validation_closed: this validation is already %', v_row.status using errcode = 'P0001';
  end if;
  if v_action not in ('approve', 'approve_modified', 'return', 'reject', 'forward') then
    raise exception 'unknown validation action %', v_action using errcode = 'P0001';
  end if;

  -- Who answers: the named validator of a 0060 step; for a level step any
  -- eligible member (0071); the committee only through its vote.
  if v_row.level_id is null then
    if v_row.validator_id <> (select auth.uid()) then
      raise exception 'only the assigned validator may answer this validation' using errcode = '42501';
    end if;
  else
    select * into v_level from tci.authority_levels where id = v_row.level_id;
    if v_level.is_committee then
      if tci.committee_resolving() is distinct from v_row.id then
        raise exception 'committee_votes_decide: the committee decides this by vote' using errcode = 'P0001';
      end if;
    elsif not exists (select 1 from tci.level_eligible_members(v_row.level_id, v_row.request_id, v_row.chain_id, v_row.id) m
                       where m = (select auth.uid())) then
      raise exception 'only a member of the authority level this step sits with may answer it' using errcode = '42501';
    end if;
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

  if v_action in ('return', 'reject') and coalesce(btrim(p_comment), '') = '' then
    raise exception 'validation_comment_required: say why' using errcode = 'P0001';
  end if;

  -- 0071: a level member approving as is beyond their OWN authority passes
  -- it on to the next rank (the sequential routing; in direct routing only
  -- when the level's authority has changed since).
  if v_row.level_id is not null and not v_level.is_committee and v_action = 'approve'
     and v_row.amount is not null
     and v_row.amount_uzs > tci.user_authority_uzs((select auth.uid()), v_row.stream, v_row.grade_band) then
    v_action := 'forward';
  end if;

  -- The decision functions run as the validator and accept this step.
  perform set_config('tci.resolving_validation', v_row.id::text, true);

  if v_action in ('approve', 'approve_modified') then
    v_amount := case when v_action = 'approve_modified' then p_amount else v_row.amount end;
    if v_action = 'approve_modified' and (p_amount is null or p_amount <= 0) then
      raise exception 'approve_modified needs the amount you approve' using errcode = 'P0001';
    end if;
    if v_row.stream = 'credit' then
      v_outcome := case
        when v_row.outcome = 'declined' and v_action = 'approve' then 'declined'
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
        case when v_action = 'approve_modified' then coalesce(p_payment_terms, v_row.payment_terms_days)
             else v_row.payment_terms_days end,
        coalesce(nullif(btrim(p_comment), ''), v_row.comment));
    end if;
    if v_result ->> 'result' not in ('decided', 'adjusted') then
      raise exception 'validation_not_recorded: %', v_result ->> 'result' using errcode = 'P0001';
    end if;
    v_decision := (v_result ->> 'decision_id')::uuid;
    v_status := case when v_action = 'approve' then 'approved' else 'approved_modified' end;

  elsif v_action = 'reject' then
    if v_row.stream = 'credit' then
      v_result := tci.decide_limit_request(
        v_row.request_id, 'declined', null, v_row.currency_code, current_date, null, '[]'::jsonb,
        btrim(p_comment), v_row.assessment_id);
      v_decision := (v_result ->> 'decision_id')::uuid;
    end if;
    v_status := 'rejected';

  elsif v_action = 'return' then
    if v_row.stream = 'credit' then
      update tci.credit_limit_requests set status = 'under_review' where id = v_row.request_id;
    end if;
    v_status := 'returned';

  else -- forward
    v_id := gen_random_uuid();
    if v_row.level_id is not null then
      -- 0071: to the next rank up that someone eligible can answer.
      if v_level.is_committee then
        raise exception 'committee_is_last: the committee is the top of the chain' using errcode = 'P0001';
      end if;
      v_next_level := tci.route_validation_level(v_row.stream, v_row.grade_band, v_row.amount_uzs, false,
                        v_row.request_id, v_row.chain_id, v_level.rank);
      if v_next_level is null then
        raise exception 'authority_level_missing: no authority level above this one can take the decision'
          using errcode = 'P0001';
      end if;
    else
      -- 0063: four eyes on the next validator as well.
      if tci.limit_four_eyes_refusal(v_row.request_id, p_forward_to, v_row.stream) is not null then
        raise exception 'validator_%', tci.limit_four_eyes_refusal(v_row.request_id, p_forward_to, v_row.stream)
          using errcode = 'P0001';
      end if;
      perform tci.check_validator(p_forward_to, v_row.stream, v_row.grade_band, v_row.amount,
                                  v_row.currency_code, v_row.chain_id);
    end if;
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
      grade_band, amount_uzs, comment, proposed_by, forwarded_by, validator_id, level_id, held_credit_decision)
    values (
      v_id, v_row.chain_id, v_row.id, v_row.request_id, v_row.stream, v_row.kind, v_row.outcome,
      v_row.amount, v_row.currency_code, v_row.payment_terms_days, v_row.valid_from, v_row.valid_until,
      v_row.conditions, v_row.assessment_id, v_row.adjusts_decision_id, v_row.grade_band,
      v_row.amount_uzs, v_row.comment, v_row.proposed_by, (select auth.uid()),
      case when v_row.level_id is null then p_forward_to end, v_next_level, false)
    returning * into v_next;
    perform tci.emit_validation_resolved(v_row, 'forwarded', null, p_comment, v_author);
    if v_next.level_id is not null then
      perform tci.emit_level_validation_requested(v_next, '{}'::uuid[]);
    else
      perform tci.emit_validation_requested(v_next);
    end if;
    return jsonb_build_object('result', 'forwarded', 'validation_id', v_next.id,
                              'rank', (select l.rank from tci.authority_levels l where l.id = v_next.level_id));
  end if;

  perform tci.emit_validation_resolved(v_row, v_status::text, v_decision, p_comment, v_author);
  return jsonb_build_object('result', v_status, 'decision_id', v_decision);
end;
$function$;

-- The committee's authority is the top of the chain: when its vote is being
-- carried out the decide / adjust functions take no personal authority.
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('tci.decide_limit_request(uuid, tci.decision_outcome, numeric, character, date, date, jsonb, text, uuid)'::regprocedure);
  if v_def not like '%    v_authority_uzs := tci.my_authority_uzs(v_band);%' then
    raise exception '0071: decide_limit_request is not the body this migration expects';
  end if;
  v_def := replace(v_def,
    '    v_authority_uzs := tci.my_authority_uzs(v_band);',
    '    -- 0071: a committee vote being carried out is the top of the chain.
    v_authority_uzs := case when v_resolving is not null and tci.committee_resolving() = v_resolving
                            then ''Infinity''::numeric else tci.my_authority_uzs(v_band) end;');
  execute v_def;

  v_def := pg_get_functiondef('tci.adjust_limit_commercial(uuid, numeric, integer, text)'::regprocedure);
  if v_def not like '%    select coalesce(max(tci.to_uzs(g.max_amount, g.currency_code)), 0)
      into v_authority_uzs
      from tci.authority_grants g
     where g.user_id = (select auth.uid())
       and g.applies_to = ''commercial''
       and g.grade_band = v_band
       and g.valid_from <= current_date
       and (g.valid_to is null or g.valid_to >= current_date);%' then
    raise exception '0071: adjust_limit_commercial is not the body this migration expects';
  end if;
  v_def := replace(v_def,
    '    select coalesce(max(tci.to_uzs(g.max_amount, g.currency_code)), 0)
      into v_authority_uzs
      from tci.authority_grants g
     where g.user_id = (select auth.uid())
       and g.applies_to = ''commercial''
       and g.grade_band = v_band
       and g.valid_from <= current_date
       and (g.valid_to is null or g.valid_to >= current_date);',
    '    -- 0071: personal grants or the level; a committee vote is the top.
    v_authority_uzs := case when v_resolving is not null and tci.committee_resolving() = v_resolving
                            then ''Infinity''::numeric
                            else tci.my_stream_authority_uzs(''commercial'', v_band) end;');
  execute v_def;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The committee's vote
-- ---------------------------------------------------------------------------

-- The committee step, locked, with its level; refuses anything else.
create or replace function tci.committee_step(p_validation_id uuid)
returns tci.limit_validations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row tci.limit_validations;
begin
  perform tci.require_internal_call();
  select * into v_row from tci.limit_validations where id = p_validation_id for update;
  if not found then
    raise exception 'validation % not found', p_validation_id using errcode = 'P0002';
  end if;
  if v_row.level_id is null or not (select l.is_committee from tci.authority_levels l where l.id = v_row.level_id) then
    raise exception 'not_a_committee_step: this validation is not before the committee' using errcode = 'P0001';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'validation_closed: this validation is already %', v_row.status using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

-- The electorate of a committee step: who may vote now, plus whoever already
-- voted (a vote cast stays counted).
create or replace function tci.committee_electorate(p_row tci.limit_validations)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x), '{}'::uuid[]) from (
    select m as x from tci.level_eligible_members(p_row.level_id, p_row.request_id, p_row.chain_id, p_row.id) m
    union
    select v.voter from tci.committee_votes v where v.validation_id = p_row.id) e
$$;

create or replace function tci.cast_committee_vote(p_validation_id uuid, p_vote text, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row tci.limit_validations;
begin
  perform tci.require_role('credit_underwriter', 'commercial_underwriter');
  perform tci.begin_trusted_call();
  v_row := tci.committee_step(p_validation_id);
  if p_vote is null or p_vote not in ('approve', 'reject', 'abstain') then
    raise exception 'committee_vote_invalid: vote approve, reject or abstain' using errcode = 'P0001';
  end if;
  if p_vote = 'reject' and coalesce(btrim(p_comment), '') = '' then
    raise exception 'validation_comment_required: say why' using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.committee_votes v where v.validation_id = v_row.id and v.voter = (select auth.uid())) then
    raise exception 'committee_already_voted: your vote on this proposal is recorded' using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.level_eligible_members(v_row.level_id, v_row.request_id, v_row.chain_id, v_row.id) m
                  where m = (select auth.uid())) then
    raise exception 'committee_not_eligible: you are not a voting member of the committee on this proposal'
      using errcode = '42501';
  end if;
  insert into tci.committee_votes (validation_id, voter, vote, comment)
  values (v_row.id, (select auth.uid()), p_vote, nullif(btrim(p_comment), ''));
  -- The voter's own task is done; the others stay open.
  update tci.tasks t
     set status = 'done', completed_by = (select auth.uid()), completed_at = now()
   where t.task_type = 'limit_validation' and t.object_id = v_row.id
     and t.target_user = (select auth.uid()) and t.status = 'open';
  return tci.validation_step_state(v_row.id);
end;
$$;

create or replace function tci.declare_committee_conflict(p_validation_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row tci.limit_validations;
begin
  perform tci.require_role('credit_underwriter', 'commercial_underwriter');
  perform tci.begin_trusted_call();
  v_row := tci.committee_step(p_validation_id);
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'committee_conflict_reason_required: say what the conflict is' using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.committee_votes v where v.validation_id = v_row.id and v.voter = (select auth.uid())) then
    raise exception 'committee_already_voted: your vote on this proposal is recorded' using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.level_eligible_members(v_row.level_id, v_row.request_id, v_row.chain_id, v_row.id) m
                  where m = (select auth.uid())) then
    raise exception 'committee_not_eligible: you are not a voting member of the committee on this proposal'
      using errcode = '42501';
  end if;
  insert into tci.committee_conflicts (validation_id, member, reason)
  values (v_row.id, (select auth.uid()), btrim(p_reason));
  update tci.tasks t
     set status = 'cancelled', completed_by = (select auth.uid()), completed_at = now()
   where t.task_type = 'limit_validation' and t.object_id = v_row.id
     and t.target_user = (select auth.uid()) and t.status = 'open';
  return tci.validation_step_state(v_row.id);
end;
$$;

-- Closes the vote: quorum = at least half of the electorate voted; more
-- approvals approve, more rejections reject, a tie goes the chair's way, and
-- without the chair's vote the proposal returns to its author.
create or replace function tci.close_committee_vote(p_validation_id uuid, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       tci.limit_validations;
  v_chair     uuid;
  v_elect     uuid[];
  v_eligible  uuid[];
  v_approve   integer;
  v_reject    integer;
  v_cast      integer;
  v_chair_vote text;
  v_action    text;
  v_result    jsonb;
begin
  perform tci.require_role('credit_underwriter', 'commercial_underwriter');
  perform tci.begin_trusted_call();
  v_row := tci.committee_step(p_validation_id);
  select l.chair_id into v_chair from tci.authority_levels l where l.id = v_row.level_id;
  v_eligible := array(select m from tci.level_eligible_members(v_row.level_id, v_row.request_id, v_row.chain_id, v_row.id) m);
  v_elect := tci.committee_electorate(v_row);

  -- The chair closes; when the chair cannot sit on this proposal (or there is
  -- none), any eligible member does.
  if not ((select auth.uid()) = v_chair and v_chair = any (v_elect))
     and not (((v_chair is null) or not (v_chair = any (v_elect))) and (select auth.uid()) = any (v_eligible)) then
    raise exception 'committee_chair_closes: only the chair closes the vote' using errcode = '42501';
  end if;

  select count(*) filter (where v.vote = 'approve'), count(*) filter (where v.vote = 'reject'), count(*)
    into v_approve, v_reject, v_cast
    from tci.committee_votes v where v.validation_id = v_row.id;
  if cardinality(v_elect) = 0 or v_cast * 2 < cardinality(v_elect) then
    raise exception 'committee_no_quorum: at least half of the committee must vote (% of % so far)', v_cast, cardinality(v_elect)
      using errcode = 'P0001';
  end if;

  select v.vote into v_chair_vote from tci.committee_votes v where v.validation_id = v_row.id and v.voter = v_chair;
  v_action := case
    when v_approve > v_reject then 'approve'
    when v_reject > v_approve then 'reject'
    when v_chair_vote = 'approve' then 'approve'
    when v_chair_vote = 'reject' then 'reject'
    else 'return' end;
  if v_action in ('reject', 'return') and coalesce(btrim(p_comment), '') = '' then
    raise exception 'committee_comment_required: the minutes need a reason when the committee does not approve'
      using errcode = 'P0001';
  end if;

  perform set_config('tci.committee_resolution', v_row.id::text, true);
  v_result := tci.resolve_limit_validation(v_row.id, v_action, null, null, p_comment, null);
  perform set_config('tci.committee_resolution', '', true);
  return v_result || jsonb_build_object('committee', jsonb_build_object(
    'approve', v_approve, 'reject', v_reject, 'cast', v_cast, 'electorate', cardinality(v_elect),
    'action', v_action, 'chair_vote', v_chair_vote));
end;
$$;

-- Everything the screen needs about one step: where it sits, whether the
-- caller may answer it, and — before the committee — the tally.
create or replace function tci.validation_step_state(p_validation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row      tci.limit_validations;
  v_level    tci.authority_levels;
  v_me       uuid := (select auth.uid());
  v_eligible uuid[] := '{}';
  v_elect    uuid[] := '{}';
  v_member   boolean := false;
  v_votes    jsonb := '[]';
  v_conf     jsonb := '[]';
  v_cast     integer := 0;
  v_out      jsonb;
begin
  perform tci.require_staff();
  perform tci.begin_trusted_call();
  select * into v_row from tci.limit_validations where id = p_validation_id;
  if not found then
    raise exception 'validation % not found', p_validation_id using errcode = 'P0002';
  end if;
  select * into v_level from tci.authority_levels where id = v_row.level_id;
  v_member := v_row.level_id is not null and exists (
    select 1 from tci.authority_level_members m
     where m.level_id = v_row.level_id and m.user_id = v_me
       and m.valid_from <= current_date and (m.valid_to is null or m.valid_to >= current_date));
  if not (tci.has_role('admin') or tci.is_validation_participant(v_row.chain_id) or v_member) then
    raise exception 'not a participant of this validation' using errcode = '42501';
  end if;

  if v_row.level_id is not null and v_row.status = 'pending' then
    v_eligible := array(select m from tci.level_eligible_members(v_row.level_id, v_row.request_id, v_row.chain_id, v_row.id) m);
  end if;
  v_out := jsonb_build_object(
    'id', v_row.id, 'status', v_row.status, 'stream', v_row.stream,
    'level_id', v_row.level_id, 'rank', v_level.rank, 'is_committee', coalesce(v_level.is_committee, false),
    'can_answer', v_row.status = 'pending' and (
        (v_row.level_id is null and v_row.validator_id = v_me)
        or (v_row.level_id is not null and not coalesce(v_level.is_committee, false) and v_me = any (v_eligible))),
    'answerers', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m, 'name', tci.staff_name(m)) order by tci.staff_name(m)), '[]'::jsonb)
                    from unnest(v_eligible) m));

  if coalesce(v_level.is_committee, false) then
    v_elect := case when v_row.status = 'pending' then tci.committee_electorate(v_row)
                    else array(select v.voter from tci.committee_votes v where v.validation_id = v_row.id) end;
    select coalesce(jsonb_agg(jsonb_build_object('voter', v.voter, 'name', tci.staff_name(v.voter), 'vote', v.vote,
                                                 'comment', v.comment, 'voted_at', v.voted_at) order by v.voted_at), '[]'::jsonb),
           count(*)
      into v_votes, v_cast
      from tci.committee_votes v where v.validation_id = v_row.id;
    select coalesce(jsonb_agg(jsonb_build_object('member', c.member, 'name', tci.staff_name(c.member),
                                                 'reason', c.reason, 'declared_at', c.declared_at) order by c.declared_at), '[]'::jsonb)
      into v_conf
      from tci.committee_conflicts c where c.validation_id = v_row.id;
    v_out := v_out || jsonb_build_object('committee', jsonb_build_object(
      'chair_id', v_level.chair_id, 'chair_name', tci.staff_name(v_level.chair_id),
      'electorate', cardinality(v_elect),
      'votes', v_votes, 'conflicts', v_conf, 'cast', v_cast,
      'approve', (select count(*) from jsonb_array_elements(v_votes) x where x ->> 'vote' = 'approve'),
      'reject', (select count(*) from jsonb_array_elements(v_votes) x where x ->> 'vote' = 'reject'),
      'abstain', (select count(*) from jsonb_array_elements(v_votes) x where x ->> 'vote' = 'abstain'),
      'quorum_met', cardinality(v_elect) > 0 and v_cast * 2 >= cardinality(v_elect),
      'my_vote', (select v.vote from tci.committee_votes v where v.validation_id = v_row.id and v.voter = v_me),
      'i_may_vote', v_row.status = 'pending' and v_me = any (v_eligible)
                    and not exists (select 1 from tci.committee_votes v where v.validation_id = v_row.id and v.voter = v_me),
      'i_am_conflicted', exists (select 1 from tci.committee_conflicts c where c.validation_id = v_row.id and c.member = v_me),
      'i_may_close', v_row.status = 'pending' and (
          (v_me = v_level.chair_id and v_level.chair_id = any (v_elect))
          or ((v_level.chair_id is null or not (v_level.chair_id = any (v_elect))) and v_me = any (v_eligible)))));
  end if;
  return v_out;
end;
$$;

-- The level each step of a request sits with (the history adds it to
-- limit_validation_history; same visibility).
create or replace function tci.limit_validation_levels(p_request_id uuid)
returns table (validation_id uuid, level_id uuid, rank smallint, is_committee boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff();
  return query
    select v.id, l.id, l.rank, l.is_committee
      from tci.limit_validations v
      join tci.authority_levels l on l.id = v.level_id
     where v.request_id = p_request_id
       and (tci.has_role('admin') or tci.is_validation_participant(v.chain_id))
     order by v.created_at;
end;
$$;

-- With whom a pending step sits, for anyone on staff (the level form of
-- limit_request_validation_state).
create or replace function tci.limit_request_validation_levels(p_request_ids uuid[])
returns table (request_id uuid, validation_id uuid, rank smallint, is_committee boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff();
  return query
    select v.request_id, v.id, l.rank, l.is_committee
      from tci.limit_validations v
      join tci.authority_levels l on l.id = v.level_id
     where v.status = 'pending' and v.request_id = any (p_request_ids);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Restated 0060 pieces: visibility, the state, the guard, the Agenda
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION tci.is_validation_participant(p_chain_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- 0071: and the members of every level the chain went to.
  select exists (
    select 1 from tci.limit_validations v
     where v.chain_id = p_chain_id
       and (select auth.uid()) in (v.proposed_by, v.validator_id, v.forwarded_by, v.resolved_by))
  or exists (
    select 1 from tci.limit_validations v
      join tci.authority_level_members m on m.level_id = v.level_id
     where v.chain_id = p_chain_id
       and m.user_id = (select auth.uid())
       and m.valid_from <= current_date and (m.valid_to is null or m.valid_to >= current_date))
$function$;

CREATE OR REPLACE FUNCTION tci.limit_request_validation_state(p_request_ids uuid[])
 RETURNS TABLE(request_id uuid, validation_id uuid, stream tci.authority_scope, kind tci.validation_kind, validator_id uuid, validator_name text, since timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform tci.require_staff();
  -- 0071: a level step has no named validator (limit_request_validation_levels).
  return query
    select v.request_id, v.id, v.stream, v.kind, v.validator_id,
           case when v.validator_id is null then null else coalesce(p.full_name, u.email::text) end, v.created_at
      from tci.limit_validations v
      left join auth.users u on u.id = v.validator_id
      left join tci.user_profiles p on p.user_id = v.validator_id
     where v.status = 'pending' and v.request_id = any (p_request_ids);
end;
$function$;

CREATE OR REPLACE FUNCTION tci.guard_limit_validation_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.status <> 'pending' then
    raise exception 'a resolved validation step is final' using errcode = '42501';
  end if;
  if (new.id, new.chain_id, new.parent_id, new.request_id, new.stream, new.kind, new.outcome,
      new.amount, new.currency_code, new.payment_terms_days, new.valid_from, new.valid_until,
      new.conditions, new.assessment_id, new.adjusts_decision_id, new.grade_band, new.amount_uzs,
      new.comment, new.proposed_by, new.forwarded_by, new.validator_id, new.level_id, new.created_at)
     is distinct from
     (old.id, old.chain_id, old.parent_id, old.request_id, old.stream, old.kind, old.outcome,
      old.amount, old.currency_code, old.payment_terms_days, old.valid_from, old.valid_until,
      old.conditions, old.assessment_id, old.adjusts_decision_id, old.grade_band, old.amount_uzs,
      old.comment, old.proposed_by, old.forwarded_by, old.validator_id, old.level_id, old.created_at) then
    raise exception 'a validation step''s proposal is immutable' using errcode = '42501';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION tci.handle_validation_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid;
  v_params jsonb;
begin
  if new.object_type <> 'limit_validation' then
    return null;
  end if;
  perform tci.begin_trusted_call();

  if new.event_type = 'limit.validation_requested' then
    v_params := jsonb_build_object(
      'request_id', new.payload ->> 'request_id', 'entity_id', new.payload ->> 'entity_id',
      'entity_name', new.payload ->> 'entity_name', 'stream', new.payload ->> 'stream',
      'kind', new.payload ->> 'kind', 'outcome', new.payload ->> 'outcome',
      'amount', new.payload -> 'amount', 'currency', new.payload ->> 'currency',
      'grade_band', new.payload ->> 'grade_band',
      'proposed_by_name', new.payload ->> 'proposed_by_name',
      'level_rank', new.payload -> 'level_rank');
    if new.payload ? 'level_id' then
      -- 0071: every eligible member of the level, each their own task.
      for v_user in select (jsonb_array_elements_text(coalesce(new.payload -> 'members', '[]'::jsonb)))::uuid loop
        perform tci.open_task(
          'limit_validation', 'limit_validation', new.object_id,
          case when (new.payload ->> 'is_committee')::boolean then 'agenda.tasks.limit_validation_committee'
               else 'agenda.tasks.limit_validation' end,
          v_params, null, v_user, null,
          case when new.payload ->> 'kind' = 'required' then 'urgent' else 'high' end::tci.task_priority,
          new.id);
      end loop;
      -- The ranks the direct routing skipped hear of it.
      for v_user in select (jsonb_array_elements_text(coalesce(new.payload -> 'fyi', '[]'::jsonb)))::uuid loop
        perform tci.open_task(
          'limit_validation_fyi', 'limit_validation', new.object_id,
          'agenda.tasks.limit_validation_fyi', v_params, null, v_user, null, 'normal', new.id);
      end loop;
    else
      perform tci.open_task(
        'limit_validation', 'limit_validation', new.object_id,
        'agenda.tasks.limit_validation', v_params,
        null, new.target_user, null,
        case when new.payload ->> 'kind' = 'required' then 'urgent' else 'high' end::tci.task_priority,
        new.id);
    end if;

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
$function$;

CREATE OR REPLACE FUNCTION tci.complete_task(p_task_id uuid)
 RETURNS tci.tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- 0071: the information that a rank was skipped is read and put away.
  if v_task.task_type not in
     ('submission_declined', 'uncovered_excess_review', 'claim_declined_review',
      'entity_request_resolved', 'limit_validation_result', 'limit_validation_fyi') then
    raise exception 'task type % closes itself when its object moves on', v_task.task_type
      using errcode = 'P0001';
  end if;

  update tci.tasks
     set status = 'done', completed_by = (select auth.uid()), completed_at = now()
   where id = p_task_id
   returning * into v_task;
  return v_task;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Setting up the levels (admin, a technical setting like authority grants)
-- ---------------------------------------------------------------------------

create or replace function tci.set_authority_routing(p_routing text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform tci.require_role('admin');
  if p_routing is null or p_routing not in ('direct', 'sequential') then
    raise exception 'authority_routing_invalid: the routing must be direct or sequential' using errcode = 'P0001';
  end if;
  update tci.workflow_settings
     set authority_routing = p_routing, updated_by = (select auth.uid()), updated_at = now()
   where id;
  return p_routing;
end;
$$;

create or replace function tci.authority_routing()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff();
  return coalesce((select s.authority_routing from tci.workflow_settings s where s.id), 'direct');
end;
$$;

-- A level's grant for a band: the previous one ends today, the new one runs
-- from today. Ranks 1–4 only — the committee is unlimited.
create or replace function tci.save_authority_level_grant(
  p_level_id uuid, p_band tci.grade_band, p_amount numeric, p_currency character)
returns tci.authority_level_grants
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level tci.authority_levels;
  v_row   tci.authority_level_grants;
begin
  perform tci.require_role('admin');
  select * into v_level from tci.authority_levels where id = p_level_id;
  if not found then
    raise exception 'authority level not found' using errcode = 'P0002';
  end if;
  if v_level.is_committee then
    raise exception 'committee_unlimited: the committee is the top of the chain and has no amount cap' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'authority_amount_invalid: the amount must be positive' using errcode = 'P0001';
  end if;
  update tci.authority_level_grants g
     set valid_to = current_date - 1
   where g.level_id = p_level_id and g.grade_band = p_band
     and (g.valid_to is null or g.valid_to >= current_date);
  insert into tci.authority_level_grants (level_id, grade_band, max_amount, currency_code, valid_from, created_by)
  values (p_level_id, p_band, p_amount, upper(p_currency), current_date, (select auth.uid()))
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function tci.end_authority_level_grant(p_grant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform tci.require_role('admin');
  update tci.authority_level_grants g
     set valid_to = current_date - 1
   where g.id = p_grant_id and (g.valid_to is null or g.valid_to >= current_date);
  if not found then
    raise exception 'no live level grant %', p_grant_id using errcode = 'P0002';
  end if;
end;
$$;

-- A member of a level: of the stream's department, one rank 1–4 per stream
-- (and a committee seat besides).
create or replace function tci.add_authority_level_member(p_level_id uuid, p_user_id uuid)
returns tci.authority_level_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level tci.authority_levels;
  v_row   tci.authority_level_members;
begin
  perform tci.require_role('admin');
  select * into v_level from tci.authority_levels where id = p_level_id;
  if not found then
    raise exception 'authority level not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from tci.user_roles r where r.user_id = p_user_id and r.role = tci.validation_role(v_level.stream)) then
    raise exception 'level_member_wrong_department: a member must hold the % role', tci.validation_role(v_level.stream)
      using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.authority_level_members m
              where m.level_id = p_level_id and m.user_id = p_user_id
                and (m.valid_to is null or m.valid_to >= current_date)) then
    raise exception 'level_member_exists: already a member of this level' using errcode = 'P0001';
  end if;
  if not v_level.is_committee and exists (
       select 1 from tci.authority_level_members m
         join tci.authority_levels l on l.id = m.level_id
        where m.user_id = p_user_id and l.stream = v_level.stream and l.rank < 5
          and (m.valid_to is null or m.valid_to >= current_date)) then
    raise exception 'level_member_one_rank: a person sits at one rank per stream — end the other membership first'
      using errcode = 'P0001';
  end if;
  insert into tci.authority_level_members (level_id, user_id, valid_from, created_by)
  values (p_level_id, p_user_id, current_date, (select auth.uid()))
  returning * into v_row;
  return v_row;
end;
$$;

create or replace function tci.end_authority_level_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row tci.authority_level_members;
begin
  perform tci.require_role('admin');
  update tci.authority_level_members m
     set valid_to = current_date - 1
   where m.id = p_member_id and (m.valid_to is null or m.valid_to >= current_date)
  returning * into v_row;
  if not found then
    raise exception 'no live membership %', p_member_id using errcode = 'P0002';
  end if;
  -- a chair who leaves the committee is no longer its chair
  update tci.authority_levels l set chair_id = null where l.id = v_row.level_id and l.chair_id = v_row.user_id;
end;
$$;

create or replace function tci.set_committee_chair(p_level_id uuid, p_user_id uuid)
returns tci.authority_levels
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level tci.authority_levels;
begin
  perform tci.require_role('admin');
  select * into v_level from tci.authority_levels where id = p_level_id for update;
  if not found then
    raise exception 'authority level not found' using errcode = 'P0002';
  end if;
  if not v_level.is_committee then
    raise exception 'chair_committee_only: only the committee has a chair' using errcode = 'P0001';
  end if;
  if p_user_id is not null and not exists (
       select 1 from tci.authority_level_members m
        where m.level_id = p_level_id and m.user_id = p_user_id
          and m.valid_from <= current_date and (m.valid_to is null or m.valid_to >= current_date)) then
    raise exception 'chair_not_member: the chair must be a member of the committee' using errcode = 'P0001';
  end if;
  update tci.authority_levels set chair_id = p_user_id where id = p_level_id returning * into v_level;
  return v_level;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. The queue's «can I decide alone» counts the level too
-- ---------------------------------------------------------------------------

create or replace view tci.v_limit_request_queue with (security_invoker = true) as
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
    (r.requested_amount * tci.latest_uzs_rate(r.currency_code)) AS amount_uzs,
    (tci.latest_uzs_rate(r.currency_code) IS NULL) AS rate_missing,
    COALESCE(auth_.authority_uzs, (0)::numeric) AS my_authority_uzs,
    ((tci.latest_uzs_rate(r.currency_code) IS NOT NULL) AND ((r.requested_amount * tci.latest_uzs_rate(r.currency_code)) <= COALESCE(auth_.authority_uzs, (0)::numeric))) AS decide_alone,
    (r.requested_by = ( SELECT auth.uid() AS uid)) AS own_request,
        CASE
            WHEN (r.status = 'information_gathering'::tci.limit_request_status) THEN tci.buyer_information_gaps(r.entity_id)
            ELSE NULL::text[]
        END AS information_gaps
   FROM (((tci.credit_limit_requests r
     JOIN tci.legal_entities b ON ((b.id = r.entity_id)))
     LEFT JOIN LATERAL ( SELECT ca.id,
            ca.rating_grade
           FROM tci.credit_assessments ca
          WHERE (ca.entity_id = r.entity_id)
          ORDER BY ca.created_at DESC
         LIMIT 1) a ON (true))
     LEFT JOIN LATERAL ( SELECT GREATEST(max((g.max_amount * tci.latest_uzs_rate(g.currency_code))),
                tci.level_authority_of(( SELECT auth.uid() AS uid), 'credit'::tci.authority_scope, tci.grade_band_for_assessment(a.id))) AS authority_uzs
           FROM tci.authority_grants g
          WHERE ((g.user_id = ( SELECT auth.uid() AS uid)) AND (g.applies_to = 'credit'::tci.authority_scope) AND (g.grade_band = tci.grade_band_for_assessment(a.id)) AND (g.valid_from <= CURRENT_DATE) AND ((g.valid_to IS NULL) OR (g.valid_to >= CURRENT_DATE)))) auth_ ON (true))
  WHERE (r.status = ANY (ARRAY['submitted'::tci.limit_request_status, 'information_gathering'::tci.limit_request_status, 'under_review'::tci.limit_request_status, 'escalated'::tci.limit_request_status]));

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------

revoke all on function tci.guard_immutable_row() from public, anon, authenticated;
revoke all on function tci.level_authority_of(uuid, tci.authority_scope, tci.grade_band) from public, anon;
grant execute on function tci.level_authority_of(uuid, tci.authority_scope, tci.grade_band) to authenticated, service_role;
revoke all on function tci.user_rank(uuid, tci.authority_scope) from public, anon;
grant execute on function tci.user_rank(uuid, tci.authority_scope) to authenticated, service_role;
revoke all on function tci.level_authority_uzs(uuid, tci.grade_band) from public, anon;
grant execute on function tci.level_authority_uzs(uuid, tci.grade_band) to authenticated, service_role;
revoke all on function tci.my_stream_authority_uzs(tci.authority_scope, tci.grade_band) from public, anon;
grant execute on function tci.my_stream_authority_uzs(tci.authority_scope, tci.grade_band) to authenticated, service_role;
revoke all on function tci.committee_resolving() from public, anon;
grant execute on function tci.committee_resolving() to authenticated, service_role;
revoke all on function tci.level_eligible_members(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function tci.route_validation_level(tci.authority_scope, tci.grade_band, numeric, boolean, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function tci.level_answerers(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function tci.skipped_rank_members(tci.authority_scope, integer, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function tci.emit_level_validation_requested(tci.limit_validations, uuid[]) from public, anon, authenticated;
revoke all on function tci.committee_step(uuid) from public, anon, authenticated;
revoke all on function tci.committee_electorate(tci.limit_validations) from public, anon, authenticated;
revoke all on function tci.validation_route_preview(uuid, tci.authority_scope, tci.grade_band, numeric, character) from public, anon;
grant execute on function tci.validation_route_preview(uuid, tci.authority_scope, tci.grade_band, numeric, character) to authenticated, service_role;
revoke all on function tci.cast_committee_vote(uuid, text, text) from public, anon;
grant execute on function tci.cast_committee_vote(uuid, text, text) to authenticated, service_role;
revoke all on function tci.declare_committee_conflict(uuid, text) from public, anon;
grant execute on function tci.declare_committee_conflict(uuid, text) to authenticated, service_role;
revoke all on function tci.close_committee_vote(uuid, text) from public, anon;
grant execute on function tci.close_committee_vote(uuid, text) to authenticated, service_role;
revoke all on function tci.validation_step_state(uuid) from public, anon;
grant execute on function tci.validation_step_state(uuid) to authenticated, service_role;
revoke all on function tci.limit_validation_levels(uuid) from public, anon;
grant execute on function tci.limit_validation_levels(uuid) to authenticated, service_role;
revoke all on function tci.limit_request_validation_levels(uuid[]) from public, anon;
grant execute on function tci.limit_request_validation_levels(uuid[]) to authenticated, service_role;
revoke all on function tci.set_authority_routing(text) from public, anon;
grant execute on function tci.set_authority_routing(text) to authenticated, service_role;
revoke all on function tci.authority_routing() from public, anon;
grant execute on function tci.authority_routing() to authenticated, service_role;
revoke all on function tci.save_authority_level_grant(uuid, tci.grade_band, numeric, character) from public, anon;
grant execute on function tci.save_authority_level_grant(uuid, tci.grade_band, numeric, character) to authenticated, service_role;
revoke all on function tci.end_authority_level_grant(uuid) from public, anon;
grant execute on function tci.end_authority_level_grant(uuid) to authenticated, service_role;
revoke all on function tci.add_authority_level_member(uuid, uuid) from public, anon;
grant execute on function tci.add_authority_level_member(uuid, uuid) to authenticated, service_role;
revoke all on function tci.end_authority_level_member(uuid) from public, anon;
grant execute on function tci.end_authority_level_member(uuid) to authenticated, service_role;
revoke all on function tci.set_committee_chair(uuid, uuid) from public, anon;
grant execute on function tci.set_committee_chair(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_src text;
begin
  if (select count(*) from tci.authority_levels) <> 10 then
    raise exception '0071: the ten authority levels are not all there';
  end if;
  if (select count(*) from tci.authority_levels where is_committee) <> 2
     or exists (select 1 from tci.authority_levels where is_committee and rank <> 5) then
    raise exception '0071: rank 5 is the committee of each stream';
  end if;
  -- naming a validator is retired in both streams
  for v_src in select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'tci' and p.proname in ('submit_limit_for_validation', 'submit_adjustment_for_validation') loop
    if v_src not like '%named_validator_retired%' or v_src like '%check_validator%' then
      raise exception '0071: a submit function still takes a named validator';
    end if;
  end loop;
  -- the committee closes by quorum and majority, the chair breaking a tie
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci' and p.proname = 'close_committee_vote';
  if v_src not like '%v_cast * 2 < cardinality(v_elect)%'
     or v_src not like '%when v_approve > v_reject then ''approve''%'
     or v_src not like '%when v_chair_vote = ''approve'' then ''approve''%' then
    raise exception '0071: the committee rule is not quorum, majority and the chair''s casting vote';
  end if;
  -- votes and conflicts: read through RLS only, written by functions only
  if has_table_privilege('authenticated', 'tci.committee_votes', 'insert')
     or has_table_privilege('authenticated', 'tci.committee_votes', 'update')
     or has_table_privilege('authenticated', 'tci.committee_conflicts', 'insert')
     or has_table_privilege('authenticated', 'tci.authority_level_members', 'insert')
     or has_table_privilege('authenticated', 'tci.authority_level_grants', 'insert') then
    raise exception '0071: the API may write a level or a vote directly';
  end if;
  if (select c.reloptions from pg_class c where c.oid = 'tci.v_limit_request_queue'::regclass) is distinct from array['security_invoker=true'] then
    raise exception '0071: v_limit_request_queue lost security_invoker';
  end if;
  -- admin sets the levels up and decides nothing
  for v_src in select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'tci' and p.proname in ('cast_committee_vote', 'close_committee_vote',
                  'declare_committee_conflict', 'resolve_limit_validation', 'validation_route_preview') loop
    if v_src like '%require_role(''admin''%' then
      raise exception '0071: admin takes part in a decision';
    end if;
  end loop;
end;
$$;
