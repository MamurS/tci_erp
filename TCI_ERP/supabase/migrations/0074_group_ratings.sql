-- 0074_group_ratings.sql
--
-- What: the GROUP rating (owner, 2026-10-24): a grade for a whole corporate
--       group, set by a SENIOR credit analyst, that CAPS its members — no
--       member's grade in force may be better than the group's.
--       * Seniority is an admin flag on a credit analyst
--         (`user_profiles.senior_credit_analyst`, set only through
--         tci.set_senior_credit_analyst) — no new role, no new workspace.
--       * tci.group_ratings — one live row per group, keyed by the ULTIMATE
--         PARENT (the group's identity since 0038); replaced, never edited;
--         ended with a reason.
--       * Setting or lowering it caps the members AT ONCE: a member whose
--         current grade is better gets a new assessment row at the group's
--         grade (same source, statement, score and recommended limit as the
--         row it caps, `group_rating_id` set, confirmed by the setter) — the
--         history stays as it was, and every reader of `rating_grade` (the
--         band of a decision, the queue, ADT) follows.
--       * Afterwards every new rating is capped as it is written: the guard
--         trigger lowers an engine or manual grade to the cap (the engine's own
--         grade stays in `engine_grade`, so the uncapped recommendation is
--         still visible), and refuses a confirmation, a proposal or an
--         approval above it (`rating_above_group_cap`).
--       * Raising or ending a group rating never raises a member by itself:
--         the capped rows are history; a member goes up by being rated again.
-- Why:  a subsidiary is rarely a better credit than the group that can move
--       cash out of it — Allianz Trade / Coface / Atradius cap a member at the
--       group's grade, and the group view is a senior analyst's call.
--
-- Grade order: the scale is a letter A–D and up to two digits, better first,
-- so the WORSE of two grades is the larger in byte order (A1 < A2 < B1 < … < D);
-- tci.grade_worse says so in one place.

-- ---------------------------------------------------------------------------
-- 1. Seniority
-- ---------------------------------------------------------------------------

alter table tci.user_profiles
  add column if not exists senior_credit_analyst boolean not null default false;
comment on column tci.user_profiles.senior_credit_analyst is
  'A credit analyst marked senior by admin: sets group ratings (0074). Written only by tci.set_senior_credit_analyst.';

-- user_profiles is read through column grants since 0048.
grant select (senior_credit_analyst) on tci.user_profiles to authenticated;

-- The caller acts as a credit analyst and is marked senior.
create or replace function tci.is_senior_credit_analyst()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select tci.has_role('credit_analyst')
     and coalesce((select p.senior_credit_analyst from tci.user_profiles p
                    where p.user_id = (select auth.uid())), false)
$$;

create or replace function tci.set_senior_credit_analyst(p_user uuid, p_senior boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform tci.require_role('admin');
  if coalesce(p_senior, false)
     and not exists (select 1 from tci.user_roles r where r.user_id = p_user and r.role = 'credit_analyst') then
    raise exception 'senior_requires_analyst: only a credit analyst can be marked senior' using errcode = 'P0001';
  end if;
  -- A missing profile is created without forcing a password change (the
  -- column defaults to true for provisioned users, not for this).
  insert into tci.user_profiles (user_id, senior_credit_analyst, must_change_password)
  values (p_user, coalesce(p_senior, false), false)
  on conflict (user_id) do update set senior_credit_analyst = excluded.senior_credit_analyst;
end;
$$;

-- Who is senior (staff read it: the group tab names who may set the grade).
create or replace function tci.senior_credit_analysts()
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff();
  return query
    select p.user_id from tci.user_profiles p
     where p.senior_credit_analyst
       and exists (select 1 from tci.user_roles r where r.user_id = p.user_id and r.role = 'credit_analyst');
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Group ratings
-- ---------------------------------------------------------------------------

create table if not exists tci.group_ratings (
  id               uuid primary key default gen_random_uuid(),
  parent_entity_id uuid not null references tci.legal_entities (id),
  grade            text not null check (grade ~ '^[A-D][0-9]{0,2}$'),
  reason           text not null check (btrim(reason) <> ''),
  status           text not null default 'active' check (status in ('active', 'replaced', 'ended')),
  set_by           uuid not null references auth.users (id),
  set_at           timestamptz not null default now(),
  ended_by         uuid references auth.users (id),
  ended_at         timestamptz,
  end_reason       text,
  check ((status = 'active') = (ended_at is null))
);
comment on table tci.group_ratings is
  'The grade of a corporate group, keyed by its ultimate parent, set by a senior credit analyst; caps every member''s grade in force (0074).';
create unique index if not exists group_ratings_one_active on tci.group_ratings (parent_entity_id) where status = 'active';
create index if not exists group_ratings_parent_idx on tci.group_ratings (parent_entity_id, set_at desc);

create or replace function tci.guard_group_rating()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'active'
     or new.status not in ('replaced', 'ended')
     or (to_jsonb(new) - array['status', 'ended_by', 'ended_at', 'end_reason'])
        is distinct from (to_jsonb(old) - array['status', 'ended_by', 'ended_at', 'end_reason']) then
    raise exception 'group_ratings is a record: a group rating is replaced or ended once, never edited'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger group_ratings_guard before update on tci.group_ratings
  for each row execute function tci.guard_group_rating();

alter table tci.group_ratings enable row level security;
create policy "group_ratings: credit desk read" on tci.group_ratings for select
  using (tci.has_role('admin', 'credit_underwriter', 'credit_analyst'));
revoke all on tci.group_ratings from public, anon, authenticated;
grant select on tci.group_ratings to authenticated;
grant select, insert on tci.group_ratings to service_role;

alter table tci.credit_assessments
  add column if not exists group_rating_id uuid references tci.group_ratings (id);
comment on column tci.credit_assessments.group_rating_id is
  'Set when the grade in force was capped by this group rating (0074): a row written by the cap, or a rating lowered to it as it was written.';

-- The worse of two grades (the scale sorts better first). NULL-tolerant.
create or replace function tci.grade_worse(p_a text, p_b text)
returns text
language sql
immutable
set search_path = ''
as $$
  select greatest(p_a collate "C", p_b collate "C")
$$;

-- The live group rating over a company: its ultimate parent's.
create or replace function tci.group_rating_cap(p_entity_id uuid)
returns tci.group_ratings
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row tci.group_ratings;
begin
  perform tci.require_staff_or_internal();
  select * into v_row from tci.group_ratings g
   where g.status = 'active' and g.parent_entity_id = tci.ultimate_parent(p_entity_id);
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Every rating is capped as it is written; nothing confirms above the cap
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER (0073): it asks tci.internal_call_ok() and the cap, which
-- no API role may execute. A trigger function; no role holds EXECUTE on it.
create or replace function tci.guard_credit_assessment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap tci.group_ratings;
begin
  if tg_op = 'INSERT' then
    -- 0074: a row written by the group cap carries what it was given.
    if new.group_rating_id is not null then
      if not tci.internal_call_ok() then
        raise exception 'rating_group_cap_direct: a capped rating is written only by the group rating'
          using errcode = '42501';
      end if;
      return new;
    end if;
    -- 0073: a manual rating is written only by an approved rating proposal
    -- (trusted code), already confirmed, with its proposer as author.
    if new.source = 'manual' then
      if not tci.internal_call_ok() then
        raise exception 'rating_manual_direct: a manual rating comes into force only through a confirmed rating proposal'
          using errcode = '42501';
      end if;
      new.engine_grade := null;
    else
      -- The engine's grade is what was calculated; a confirmation is never
      -- inserted, only stamped later by tci.confirm_rating.
      new.engine_grade := new.rating_grade;
      new.confirmed_by := null;
      new.confirmed_at := null;
      new.confirmation_comment := null;
      new.manual_reason := null;
      -- Who calculated is who is signed in (four eyes depend on it).
      new.created_by := coalesce((select auth.uid()), new.created_by);
    end if;
    -- 0074: never better than the group.
    v_cap := tci.group_rating_cap(new.entity_id);
    if v_cap.id is not null and tci.grade_worse(new.rating_grade, v_cap.grade) <> new.rating_grade then
      new.rating_grade := v_cap.grade;
      new.group_rating_id := v_cap.id;
    end if;
    return new;
  end if;
  -- UPDATE: only the one-time confirmation stamp, and never above the cap.
  if old.confirmed_at is not null
     or new.confirmed_at is null
     or new.confirmed_by is null
     or (to_jsonb(new) - array['rating_grade', 'confirmed_by', 'confirmed_at', 'confirmation_comment'])
        is distinct from
        (to_jsonb(old) - array['rating_grade', 'confirmed_by', 'confirmed_at', 'confirmation_comment']) then
    raise exception 'rating_immutable: an assessment is history; only its one confirmation may be recorded'
      using errcode = 'P0001';
  end if;
  v_cap := tci.group_rating_cap(new.entity_id);
  if v_cap.id is not null and tci.grade_worse(new.rating_grade, v_cap.grade) <> new.rating_grade then
    raise exception 'rating_above_group_cap: the grade is better than the group rating % that caps this buyer', v_cap.grade
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

do $$
declare
  v_def text;
begin
  -- confirm_rating: the default is the grade in force (which may be the
  -- capped one), and confirming that needs no reason.
  v_def := pg_get_functiondef('tci.confirm_rating(uuid, text, text)'::regprocedure);
  if v_def not like '%coalesce(nullif(btrim(coalesce(p_grade, '''')), ''''), v_a.engine_grade, v_a.rating_grade)%'
     or v_def not like '%  if v_grade is distinct from v_a.engine_grade and v_comment is null then%' then
    raise exception '0074: confirm_rating is not the body this migration expects';
  end if;
  v_def := replace(v_def,
    'coalesce(nullif(btrim(coalesce(p_grade, '''')), ''''), v_a.engine_grade, v_a.rating_grade)',
    'coalesce(nullif(btrim(coalesce(p_grade, '''')), ''''), v_a.rating_grade, v_a.engine_grade)');
  v_def := replace(v_def,
    '  if v_grade is distinct from v_a.engine_grade and v_comment is null then',
    '  -- 0074: the grade in force may be the group''s cap; confirming it needs no reason.
  if v_grade is distinct from v_a.engine_grade and v_grade is distinct from v_a.rating_grade
     and v_comment is null then');
  execute v_def;

  -- propose_rating: a grade better than the group is refused at once.
  v_def := pg_get_functiondef('tci.propose_rating(uuid, text, text, uuid, uuid, boolean)'::regprocedure);
  if v_def not like '%  perform 1 from tci.legal_entities e where e.id = p_entity_id for update;%' then
    raise exception '0074: propose_rating is not the body this migration expects';
  end if;
  v_def := replace(v_def,
    '  perform 1 from tci.legal_entities e where e.id = p_entity_id for update;',
    '  perform 1 from tci.legal_entities e where e.id = p_entity_id for update;
  -- 0074: never better than the group.
  if tci.grade_worse(v_grade, (tci.group_rating_cap(p_entity_id)).grade) <> v_grade then
    raise exception ''rating_above_group_cap: the grade is better than the group rating % that caps this buyer'',
      (tci.group_rating_cap(p_entity_id)).grade using errcode = ''P0001'';
  end if;');
  execute v_def;

  -- apply_rating_proposal: the group may have been rated since the proposal.
  v_def := pg_get_functiondef('tci.apply_rating_proposal(tci.rating_proposals, text, text)'::regprocedure);
  if v_def not like '%  perform tci.require_internal_call();
  if p_proposal.assessment_id is null then%' then
    raise exception '0074: apply_rating_proposal is not the body this migration expects';
  end if;
  v_def := replace(v_def,
    '  perform tci.require_internal_call();
  if p_proposal.assessment_id is null then',
    '  perform tci.require_internal_call();
  -- 0074: never better than the group.
  if tci.grade_worse(p_grade, (tci.group_rating_cap(p_proposal.entity_id)).grade) <> p_grade then
    raise exception ''rating_above_group_cap: the grade is better than the group rating % that caps this buyer'',
      (tci.group_rating_cap(p_proposal.entity_id)).grade using errcode = ''P0001'';
  end if;
  if p_proposal.assessment_id is null then');
  execute v_def;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Setting and ending a group rating
-- ---------------------------------------------------------------------------

-- Caps every member of the group whose current grade is better than the
-- rating: a new row at the group's grade, otherwise a copy of the row it caps.
create or replace function tci.apply_group_cap(p_rating tci.group_ratings)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
  v_a      tci.credit_assessments;
  v_n      integer := 0;
begin
  perform tci.require_internal_call();
  for v_member in select g.entity_id from tci.entity_group(p_rating.parent_entity_id) g loop
    select * into v_a from tci.credit_assessments a
     where a.entity_id = v_member order by a.created_at desc limit 1;
    continue when not found;
    continue when tci.grade_worse(v_a.rating_grade, p_rating.grade) = v_a.rating_grade;
    insert into tci.credit_assessments (
      entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
      inputs_snapshot, calculation_trace, engine_version, created_by, created_at,
      engine_grade, source, manual_reason, confirmed_by, confirmed_at, confirmation_comment, group_rating_id)
    values (
      v_a.entity_id, v_a.statement_id, v_a.rating_score, p_rating.grade, v_a.suggested_limit, v_a.limit_currency,
      coalesce(v_a.inputs_snapshot, '{}'::jsonb) || jsonb_build_object('group_cap', jsonb_build_object(
        'group_rating_id', p_rating.id, 'previous_assessment_id', v_a.id, 'previous_grade', v_a.rating_grade)),
      v_a.calculation_trace, v_a.engine_version, (select auth.uid()), greatest(clock_timestamp(), v_a.created_at + interval '1 millisecond'),
      v_a.engine_grade, v_a.source, v_a.manual_reason, (select auth.uid()), now(), p_rating.reason, p_rating.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

create or replace function tci.set_group_rating(p_entity_id uuid, p_grade text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent uuid;
  v_grade  text := tci.rating_grade_normalised(p_grade);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_row    tci.group_ratings;
  v_capped integer;
begin
  perform tci.require_role('credit_analyst');
  if not tci.is_senior_credit_analyst() then
    raise exception 'group_rating_senior_only: only a senior credit analyst sets a group rating' using errcode = '42501';
  end if;
  perform tci.begin_trusted_call();
  if not exists (select 1 from tci.legal_entities e where e.id = p_entity_id) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if v_grade is null then
    raise exception 'rating_grade_invalid: % is not a grade of the scale', coalesce(p_grade, '') using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'group_rating_reason_required: say why the group is rated so' using errcode = 'P0001';
  end if;
  v_parent := tci.ultimate_parent(p_entity_id);
  perform 1 from tci.legal_entities e where e.id = v_parent for update;

  update tci.group_ratings g
     set status = 'replaced', ended_by = (select auth.uid()), ended_at = now()
   where g.parent_entity_id = v_parent and g.status = 'active';
  insert into tci.group_ratings (parent_entity_id, grade, reason, set_by)
  values (v_parent, v_grade, v_reason, (select auth.uid()))
  returning * into v_row;

  v_capped := tci.apply_group_cap(v_row);
  perform tci.emit_workflow_event(
    'group_rating.set', 'legal_entity', v_parent,
    jsonb_build_object('group_rating_id', v_row.id, 'grade', v_grade, 'capped', v_capped),
    null::tci.user_role);
  return tci.group_rating_state(p_entity_id) || jsonb_build_object('capped_now', v_capped);
end;
$$;

create or replace function tci.end_group_rating(p_entity_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent uuid;
  v_n      integer;
begin
  perform tci.require_role('credit_analyst');
  if not tci.is_senior_credit_analyst() then
    raise exception 'group_rating_senior_only: only a senior credit analyst sets a group rating' using errcode = '42501';
  end if;
  perform tci.begin_trusted_call();
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'group_rating_reason_required: say why the group rating ends' using errcode = 'P0001';
  end if;
  v_parent := tci.ultimate_parent(p_entity_id);
  update tci.group_ratings g
     set status = 'ended', ended_by = (select auth.uid()), ended_at = now(), end_reason = btrim(p_reason)
   where g.parent_entity_id = v_parent and g.status = 'active';
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'group_rating_none: this group has no group rating' using errcode = 'P0002';
  end if;
  perform tci.emit_workflow_event(
    'group_rating.ended', 'legal_entity', v_parent,
    jsonb_build_object('reason', btrim(p_reason)), null::tci.user_role);
  return tci.group_rating_state(p_entity_id);
end;
$$;

-- What the group tab reads: the live rating, its history, the members it
-- caps now, and whether the caller may set it.
create or replace function tci.group_rating_state(p_entity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parent uuid;
begin
  perform tci.require_role('admin', 'credit_underwriter', 'credit_analyst');
  perform tci.begin_trusted_call();
  v_parent := tci.ultimate_parent(p_entity_id);
  return jsonb_build_object(
    'parent_id', v_parent,
    'parent_name', (select e.name from tci.legal_entities e where e.id = v_parent),
    'members', (select count(*) from tci.entity_group(v_parent)),
    'may_set', tci.is_senior_credit_analyst(),
    'seniors', (select coalesce(jsonb_agg(tci.staff_name(s) order by tci.staff_name(s)), '[]'::jsonb)
                  from tci.senior_credit_analysts() s),
    'active', (select jsonb_build_object('id', g.id, 'grade', g.grade, 'reason', g.reason,
                                         'set_by_name', tci.staff_name(g.set_by), 'set_at', g.set_at)
                 from tci.group_ratings g where g.parent_entity_id = v_parent and g.status = 'active'),
    'history', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', g.id, 'grade', g.grade, 'reason', g.reason, 'status', g.status,
                         'set_by_name', tci.staff_name(g.set_by), 'set_at', g.set_at,
                         'ended_by_name', tci.staff_name(g.ended_by), 'ended_at', g.ended_at,
                         'end_reason', g.end_reason) order by g.set_at desc), '[]'::jsonb)
                  from tci.group_ratings g where g.parent_entity_id = v_parent and g.status <> 'active'),
    'capped', (select coalesce(jsonb_agg(jsonb_build_object(
                        'entity_id', a.entity_id, 'name', e.name, 'grade', a.rating_grade,
                        'engine_grade', a.engine_grade) order by e.name), '[]'::jsonb)
                 from tci.entity_group(v_parent) m
                 join lateral (select * from tci.credit_assessments x where x.entity_id = m.entity_id
                                order by x.created_at desc limit 1) a on true
                 join tci.legal_entities e on e.id = a.entity_id
                 join tci.group_ratings g on g.id = a.group_rating_id and g.status = 'active'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------

revoke all on function tci.guard_group_rating() from public, anon, authenticated;
revoke all on function tci.guard_credit_assessment() from public, anon, authenticated;
revoke all on function tci.grade_worse(text, text) from public, anon;
grant execute on function tci.grade_worse(text, text) to authenticated, service_role;
revoke all on function tci.is_senior_credit_analyst() from public, anon;
grant execute on function tci.is_senior_credit_analyst() to authenticated, service_role;
revoke all on function tci.group_rating_cap(uuid) from public, anon, authenticated;
revoke all on function tci.apply_group_cap(tci.group_ratings) from public, anon, authenticated;
grant execute on function tci.group_rating_cap(uuid), tci.apply_group_cap(tci.group_ratings) to service_role;
revoke all on function tci.set_senior_credit_analyst(uuid, boolean) from public, anon;
revoke all on function tci.senior_credit_analysts() from public, anon;
revoke all on function tci.set_group_rating(uuid, text, text) from public, anon;
revoke all on function tci.end_group_rating(uuid, text) from public, anon;
revoke all on function tci.group_rating_state(uuid) from public, anon;
grant execute on function tci.set_senior_credit_analyst(uuid, boolean), tci.senior_credit_analysts(),
  tci.set_group_rating(uuid, text, text), tci.end_group_rating(uuid, text), tci.group_rating_state(uuid)
  to authenticated, service_role;

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
    ('login_interrupted',        'pre-sign-in entry point: labels only the attempt whose ticket the caller holds (see pre_auth_entry_points)'),
    ('my_sign_in_notice',        'reads only the caller''s own sign-in attempts, keyed by auth.uid()'),
    ('require_trusted_write',    'a gate: only raises (the guard on workflow-written tables)'),
    ('may_remove_claim_object',  'a storage-policy predicate: true only for the caller''s own unregistered upload to a claim they may upload to'),
    ('is_validation_participant','an RLS predicate of tci.limit_validations: answers only whether the CALLER is in a validation chain'),
    ('record_sign_in',           'marks only the caller''s own fresh sign-in ticket succeeded, keyed by auth.uid(), same network'),
    ('acknowledge_sign_in_failures','writes only the caller''s own acknowledgement watermark, keyed by auth.uid()'),
    ('my_failed_sign_ins',       'lists only the caller''s own counted sign-in failures, keyed by auth.uid()'),
    ('my_interrupted_sign_ins',  'lists only the caller''s own interrupted sign-in attempts, keyed by auth.uid()'),
    ('acting_role',              'answers only the caller''s own acting role, from roles they hold; part of the gate'),
    ('held_roles',               'returns only the caller''s own roles'),
    ('set_acting_role',          'writes only the caller''s own acting role for their own session, from roles they hold'),
    ('credit_analysis_mode',     'one non-sensitive workflow_settings switch the UI mirrors (0069)'),
    ('has_capability',           'answers only for the caller''s own acting role under the mode; part of the gate (0069)'),
    ('my_capabilities',          'answers only for the caller''s own acting role under the mode (0069)'),
    ('is_senior_credit_analyst', 'answers only for the caller''s own acting role and own profile flag; part of the gate (0074)')
$function$
;

-- ---------------------------------------------------------------------------
-- 6. Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn text;
  v_src text;
begin
  foreach v_fn in array array['set_senior_credit_analyst', 'senior_credit_analysts', 'group_rating_cap',
                              'apply_group_cap', 'set_group_rating', 'end_group_rating', 'group_rating_state'] loop
    select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'tci' and p.proname = v_fn;
    if v_src is null or v_src !~ '^\s*(declare.*?)?begin\s+perform tci\.require_' then
      raise exception '0074: % does not open with a gate', v_fn;
    end if;
  end loop;
  if has_column_privilege('authenticated', 'tci.user_profiles', 'senior_credit_analyst', 'update')
     or has_table_privilege('authenticated', 'tci.group_ratings', 'insert')
     or has_table_privilege('authenticated', 'tci.group_ratings', 'update') then
    raise exception '0074: the API may write seniority or a group rating';
  end if;
  if has_function_privilege('authenticated', 'tci.group_rating_cap(uuid)', 'execute')
     or has_function_privilege('anon', 'tci.set_group_rating(uuid, text, text)', 'execute') then
    raise exception '0074: an internal group rating function is reachable';
  end if;
  if tci.grade_worse('A1', 'B2') <> 'B2' or tci.grade_worse('C2', 'C1') <> 'C2' or tci.grade_worse('D', 'A') <> 'D'
     or tci.grade_worse('B1', null) <> 'B1' then
    raise exception '0074: grade_worse does not put the worse grade first';
  end if;
  -- the group writes name the analyst, never admin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'tci' and p.proname in ('set_group_rating', 'end_group_rating')
                and p.prosrc like '%''admin''%') then
    raise exception '0074: a group rating write names admin';
  end if;
  if (select prosrc from pg_proc where oid = 'tci.confirm_rating(uuid, text, text)'::regprocedure)
     not like '%v_a.rating_grade, v_a.engine_grade)%' then
    raise exception '0074: confirm_rating still defaults to the uncapped grade';
  end if;
end;
$$;
