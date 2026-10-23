-- 0069_credit_analysis.sql
--
-- What: credit ANALYSIS as a function of its own (Prompt 29 §2a).
--       * workflow_settings.credit_analysis_mode — 'combined' (default: the
--         credit underwriter rates AND decides, as before; a credit analyst,
--         if anyone holds the role, rates too) or 'separate' (only credit
--         analysts rate and confirm ratings; credit underwriters decide).
--       * tci.has_capability(cap) answers 'rate', 'confirm_rating' and
--         'decide' for the caller's ACTING role under the current mode, and
--         is what the rating policy, confirm_rating and the UI ask.
--       * A rating is calculated by the engine and then CONFIRMED by a person:
--         credit_assessments keeps the engine's grade in `engine_grade`
--         (frozen on insert) and `rating_grade` becomes the grade IN FORCE —
--         the engine's until someone confirms, then the confirmed one. Every
--         view and function that reads `rating_grade` (the band of a
--         decision, the queue, ADT, the report) therefore follows the
--         confirmation without being rewritten. A confirmation is a one-time
--         stamp (who, when, why), an override of the engine grade needs a
--         comment, and nothing else of an assessment may ever change.
--       * Four eyes on the rating: whoever calculated a rating does not
--         confirm it; in 'separate' mode whoever calculated or confirmed the
--         buyer's current rating does not decide (or validate) its limit.
--       * Agenda: in 'separate' mode the rating tasks (buyer_needs_rating,
--         rating_stale, rating_new_statements) go to credit analysts;
--         switching the mode moves the open ones.
--       * The rating worklist gains the reason 'unconfirmed' (separate mode
--         only, tested last).
--       * Statements may be entered by credit analysts too.
-- Why:  segregation of duties between who assesses a buyer and who commits
--       the insurer's money on that assessment — standard at Allianz Trade /
--       Coface / Atradius once a credit desk has more than one person, and
--       optional here because a small desk cannot staff both sides.

-- ---------------------------------------------------------------------------
-- 1. The mode and the capabilities
-- ---------------------------------------------------------------------------

alter table tci.workflow_settings
  add column if not exists credit_analysis_mode text not null default 'combined'
    check (credit_analysis_mode in ('combined', 'separate'));

comment on column tci.workflow_settings.credit_analysis_mode is
  'combined: credit underwriting rates and decides (credit analysts may rate too); separate: only credit analysts rate and confirm ratings, credit underwriting decides (0069).';

create or replace function tci.credit_analysis_mode()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  -- SECURITY DEFINER: workflow_settings is not readable by every role, and
  -- the mode is a non-sensitive switch the UI mirrors.
  select coalesce((select s.credit_analysis_mode from tci.workflow_settings s where s.id), 'combined')
$$;

create or replace function tci.has_capability(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- SECURITY DEFINER for the same reason as has_role: it is called from RLS
  -- policies and reads the mode. It answers only for the caller's acting role.
  select case p_capability
    when 'rate' then
      case tci.credit_analysis_mode()
        when 'separate' then tci.has_role('credit_analyst')
        else tci.has_role('credit_analyst', 'credit_underwriter') end
    when 'confirm_rating' then
      case tci.credit_analysis_mode()
        when 'separate' then tci.has_role('credit_analyst')
        else tci.has_role('credit_analyst', 'credit_underwriter') end
    when 'decide' then tci.has_role('credit_underwriter')
    else false
  end
$$;

create or replace function tci.my_capabilities()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'mode', tci.credit_analysis_mode(),
    'capabilities', to_jsonb(array(
      select c from unnest(array['rate', 'confirm_rating', 'decide']) c
       where tci.has_capability(c))))
$$;

-- The rating tasks and who they go to under a mode.
create or replace function tci.rating_task_role(p_mode text default null)
returns tci.user_role
language sql
stable
set search_path = ''
as $$
  select case coalesce(p_mode, tci.credit_analysis_mode())
           when 'separate' then 'credit_analyst'::tci.user_role
           else 'credit_underwriter'::tci.user_role end
$$;

create or replace function tci.set_credit_analysis_mode(p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moved integer;
begin
  -- A technical setting, like the ADT switch: admin's.
  perform tci.require_role('admin');
  if p_mode is null or p_mode not in ('combined', 'separate') then
    raise exception 'credit_analysis_mode_invalid: the mode must be combined or separate' using errcode = 'P0001';
  end if;
  update tci.workflow_settings
     set credit_analysis_mode = p_mode,
         updated_by = (select auth.uid()), updated_at = now()
   where id;
  -- Open rating tasks addressed to the department follow the mode.
  update tci.tasks t
     set target_role = tci.rating_task_role(p_mode)
   where t.status = 'open'
     and t.target_user is null
     and t.task_type in ('buyer_needs_rating', 'rating_stale', 'rating_new_statements')
     and t.target_role in ('credit_underwriter', 'credit_analyst')
     and t.target_role <> tci.rating_task_role(p_mode);
  get diagnostics v_moved = row_count;
  return tci.my_capabilities() || jsonb_build_object('tasks_moved', v_moved);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Engine grade and confirmation on the assessment
-- ---------------------------------------------------------------------------

alter table tci.credit_assessments
  add column if not exists engine_grade text,
  add column if not exists confirmed_by uuid references auth.users (id),
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmation_comment text;

comment on column tci.credit_assessments.rating_grade is
  'The grade IN FORCE: the engine''s (engine_grade) until a person confirms, then the confirmed grade (0069).';
comment on column tci.credit_assessments.engine_grade is
  'The grade the engine calculated, frozen on insert (0069).';

update tci.credit_assessments a
   set engine_grade = a.rating_grade
 where a.engine_grade is null;

create or replace function tci.guard_credit_assessment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- The engine's grade is what was calculated; a confirmation is never
    -- inserted, only stamped later by tci.confirm_rating.
    new.engine_grade := new.rating_grade;
    new.confirmed_by := null;
    new.confirmed_at := null;
    new.confirmation_comment := null;
    -- Who calculated is who is signed in (four eyes depend on it).
    new.created_by := coalesce((select auth.uid()), new.created_by);
    return new;
  end if;
  -- UPDATE: only the one-time confirmation stamp.
  if old.confirmed_at is not null
     or new.confirmed_at is null
     or new.confirmed_by is null
     or (to_jsonb(new) - array['rating_grade', 'confirmed_by', 'confirmed_at', 'confirmation_comment'])
        is distinct from
        (to_jsonb(old) - array['rating_grade', 'confirmed_by', 'confirmed_at', 'confirmation_comment']) then
    raise exception 'rating_immutable: an assessment is history; only its one confirmation may be recorded'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger credit_assessments_guard
  before insert or update on tci.credit_assessments
  for each row execute function tci.guard_credit_assessment();

-- Rating is a capability now: credit analysts, and credit underwriting in
-- combined mode. Inserting is the only write left to the API.
alter policy "credit_assessments: credit write" on tci.credit_assessments
  using (tci.has_capability('rate'))
  with check (tci.has_capability('rate'));
revoke update, delete on tci.credit_assessments from authenticated;

create or replace function tci.confirm_rating(
  p_assessment_id uuid,
  p_grade text default null,
  p_comment text default null
)
returns tci.credit_assessments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a       tci.credit_assessments;
  v_grade   text;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_row     tci.credit_assessments;
begin
  perform tci.require_staff();
  if not tci.has_capability('confirm_rating') then
    raise exception 'rating_confirm_not_allowed: your role does not confirm ratings under the current credit analysis mode'
      using errcode = '42501';
  end if;

  select * into v_a from tci.credit_assessments a where a.id = p_assessment_id for update;
  if not found then
    raise exception 'assessment not found' using errcode = 'P0002';
  end if;
  if v_a.confirmed_at is not null then
    raise exception 'rating_already_confirmed: this rating has already been confirmed' using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.credit_assessments b
              where b.entity_id = v_a.entity_id and b.created_at > v_a.created_at) then
    raise exception 'rating_not_latest: only the buyer''s current rating may be confirmed' using errcode = 'P0001';
  end if;
  if v_a.created_by = (select auth.uid()) then
    raise exception 'four_eyes_own_rating: you calculated this rating and cannot confirm it' using errcode = '42501';
  end if;

  v_grade := upper(btrim(coalesce(nullif(btrim(coalesce(p_grade, '')), ''), v_a.engine_grade, v_a.rating_grade)));
  if v_grade is null or v_grade !~ '^[A-D][0-9]{0,2}$' then
    raise exception 'rating_grade_invalid: % is not a grade of the scale', coalesce(p_grade, '') using errcode = 'P0001';
  end if;
  if v_grade is distinct from v_a.engine_grade and v_comment is null then
    raise exception 'rating_override_comment_required: a grade other than the engine''s needs a reason' using errcode = 'P0001';
  end if;

  update tci.credit_assessments a
     set rating_grade = v_grade,
         confirmed_by = (select auth.uid()),
         confirmed_at = now(),
         confirmation_comment = v_comment
   where a.id = v_a.id
  returning * into v_row;

  perform tci.begin_trusted_call();
  perform tci.emit_workflow_event(
    'rating.confirmed', 'credit_assessment', v_row.id,
    jsonb_build_object('entity_id', v_row.entity_id, 'engine_grade', v_row.engine_grade,
                       'grade', v_row.rating_grade,
                       'overridden', v_row.rating_grade is distinct from v_row.engine_grade),
    tci.rating_task_role());
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Four eyes: the rating and the decision on it (separate mode)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION tci.limit_four_eyes_refusal(p_request_id uuid, p_user uuid, p_stream tci.authority_scope)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when p_user is null then null
    when r.requested_by = p_user then
      'four_eyes_own_request: you raised this limit request and cannot decide or change it'
    -- 0069: in separate mode the analyst's rating and the underwriter's
    -- decision are two people's work.
    when p_stream = 'credit' and tci.credit_analysis_mode() = 'separate' and exists (
           select 1 from (
             select a.created_by, a.confirmed_by from tci.credit_assessments a
              where a.entity_id = r.entity_id
              order by a.created_at desc limit 1) cur
            where p_user in (cur.created_by, cur.confirmed_by)) then
      'four_eyes_own_rating: you rated this buyer and cannot decide its limit'
    when p_stream = 'commercial' and exists (
           select 1 from tci.credit_limit_decisions d
            where d.request_id = p_request_id and d.stage = 'credit' and d.decided_by = p_user) then
      'four_eyes_own_credit_decision: you made the credit decision on this request and cannot adjust it commercially'
  end
  from tci.credit_limit_requests r
  where r.id = p_request_id
$function$;

-- ---------------------------------------------------------------------------
-- 4. Agenda: rating tasks follow the mode; a confirmation rechecks the ADT
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION tci.open_task(p_task_type tci.task_type, p_object_type text, p_object_id uuid, p_title_key text, p_params jsonb DEFAULT '{}'::jsonb, p_target_role tci.user_role DEFAULT NULL::tci.user_role, p_target_user uuid DEFAULT NULL::uuid, p_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_priority tci.task_priority DEFAULT 'normal'::tci.task_priority, p_event_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform tci.require_internal_call();
  insert into tci.tasks (
    task_type, object_type, object_id, title_key, params,
    target_role, target_user, due_at, priority, source_event_id
  ) values (
    p_task_type, p_object_type, p_object_id, p_title_key, coalesce(p_params, '{}'::jsonb),
    -- 0069: the rating tasks go to whoever rates under the current mode.
    case when p_task_type in ('buyer_needs_rating', 'rating_stale', 'rating_new_statements')
              and p_target_role = 'credit_underwriter'
         then tci.rating_task_role() else p_target_role end,
    p_target_user, p_due_at, p_priority, p_event_id
  )
  on conflict do nothing;
end;
$function$;

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('tci.handle_adt_event()'::regprocedure);
  if v_def not like '%''limit.request_submitted'', ''rating.created'', ''noa.filed''%'
     or v_def not like '%elsif new.event_type in (''rating.created'', ''noa.filed'', ''claim.created'') then%'
     or v_def not like '%when ''rating.created'' then (new.payload ->> ''entity_id'')::uuid%' then
    raise exception '0069: handle_adt_event is not the body this migration expects';
  end if;
  v_def := replace(v_def,
    '''limit.request_submitted'', ''rating.created'', ''noa.filed''',
    '''limit.request_submitted'', ''rating.created'', ''rating.confirmed'', ''noa.filed''');
  v_def := replace(v_def,
    'elsif new.event_type in (''rating.created'', ''noa.filed'', ''claim.created'') then',
    'elsif new.event_type in (''rating.created'', ''rating.confirmed'', ''noa.filed'', ''claim.created'') then');
  v_def := replace(v_def,
    'when ''rating.created'' then (new.payload ->> ''entity_id'')::uuid',
    'when ''rating.created'' then (new.payload ->> ''entity_id'')::uuid
                  when ''rating.confirmed'' then (new.payload ->> ''entity_id'')::uuid');
  execute v_def;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Statements: credit analysts enter them too
-- ---------------------------------------------------------------------------

alter policy "financial_statements: data write" on tci.financial_statements
  using (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role, 'credit_analyst'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role, 'credit_analyst'::tci.user_role]));

alter policy "balance_sheets: data write" on tci.balance_sheets
  using (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role, 'credit_analyst'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role, 'credit_analyst'::tci.user_role]));

alter policy "income_statements: data write" on tci.income_statements
  using (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role, 'credit_analyst'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role, 'credit_analyst'::tci.user_role]));

alter policy "local_statement_values: data write" on tci.local_statement_values
  using (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role, 'credit_analyst'::tci.user_role]))
  with check (tci.has_role(VARIADIC ARRAY['information_manager'::tci.user_role, 'credit_underwriter'::tci.user_role, 'credit_analyst'::tci.user_role]));

-- ---------------------------------------------------------------------------
-- 6. The rating worklist: 'unconfirmed' (separate mode), tested last
-- ---------------------------------------------------------------------------

create or replace view tci.v_rating_worklist with (security_invoker = true) as
 WITH live AS (
         SELECT r.entity_id
           FROM tci.credit_limit_requests r
          WHERE (r.status = ANY (ARRAY['draft'::tci.limit_request_status, 'submitted'::tci.limit_request_status, 'information_gathering'::tci.limit_request_status, 'under_review'::tci.limit_request_status, 'escalated'::tci.limit_request_status]))
        UNION
         SELECT v.entity_id
           FROM tci.v_effective_limits v
          WHERE (v.outcome = ANY (ARRAY['approved'::tci.decision_outcome, 'partial'::tci.decision_outcome]))
        UNION
         SELECT ib.entity_id
           FROM (tci.insurance_request_buyers ib
             JOIN tci.insurance_requests ir ON ((ir.id = ib.request_id)))
          WHERE ((ib.entity_id IS NOT NULL) AND (ir.status <> ALL (ARRAY['draft'::tci.insurance_request_status, 'declined'::tci.insurance_request_status, 'withdrawn'::tci.insurance_request_status, 'bound'::tci.insurance_request_status])))
        ), facts AS (
         SELECT e.id AS entity_id,
            e.name AS buyer_name,
            e.country_code AS buyer_country,
            a.id AS assessment_id,
            a.rating_grade AS grade,
            a.created_at AS rated_at,
            rs.period_end_date AS rated_period_end,
            st.statements_count,
            st.latest_period_end,
            st.latest_fiscal_year,
            (( SELECT count(*) AS count
                   FROM tci.credit_limit_requests r
                  WHERE ((r.entity_id = e.id) AND (r.status = ANY (ARRAY['submitted'::tci.limit_request_status, 'information_gathering'::tci.limit_request_status, 'under_review'::tci.limit_request_status, 'escalated'::tci.limit_request_status])))))::integer AS open_requests,
            (( SELECT count(*) AS count
                   FROM tci.v_effective_limits v
                  WHERE ((v.entity_id = e.id) AND (v.outcome = ANY (ARRAY['approved'::tci.decision_outcome, 'partial'::tci.decision_outcome])))))::integer AS limits_in_force,
            a.engine_grade,
            a.confirmed_at
           FROM ((((live l
             JOIN tci.legal_entities e ON ((e.id = l.entity_id)))
             LEFT JOIN LATERAL ( SELECT ca.id,
                    ca.rating_grade,
                    ca.created_at,
                    ca.statement_id,
                    ca.engine_grade,
                    ca.confirmed_at
                   FROM tci.credit_assessments ca
                  WHERE (ca.entity_id = e.id)
                  ORDER BY ca.created_at DESC
                 LIMIT 1) a ON (true))
             LEFT JOIN tci.financial_statements rs ON ((rs.id = a.statement_id)))
             LEFT JOIN LATERAL ( SELECT (count(*))::integer AS statements_count,
                    max(fs.period_end_date) AS latest_period_end,
                    max(fs.fiscal_year) AS latest_fiscal_year
                   FROM tci.financial_statements fs
                  WHERE (fs.entity_id = e.id)) st ON (true))
        )
 SELECT entity_id,
    buyer_name,
    buyer_country,
    assessment_id,
    grade,
    rated_at,
    rated_period_end,
    statements_count,
    latest_period_end,
    latest_fiscal_year,
    open_requests,
    limits_in_force,
    tci.grade_band_for_assessment(assessment_id) AS band,
        CASE
            WHEN ((assessment_id IS NULL) AND (statements_count = 0)) THEN 'no_statements'::text
            WHEN (assessment_id IS NULL) THEN 'no_rating'::text
            WHEN (latest_period_end > rated_period_end) THEN 'new_statement'::text
            WHEN (rated_at <= (now() - '1 year'::interval)) THEN 'stale'::text
            WHEN ((confirmed_at IS NULL) AND (tci.credit_analysis_mode() = 'separate'::text)) THEN 'unconfirmed'::text
            ELSE NULL::text
        END AS reason,
    engine_grade,
    confirmed_at
   FROM facts f
  WHERE ((assessment_id IS NULL) OR (latest_period_end > rated_period_end) OR (rated_at <= (now() - '1 year'::interval))
         OR ((confirmed_at IS NULL) AND (tci.credit_analysis_mode() = 'separate'::text)));

-- ---------------------------------------------------------------------------
-- 7. Grants and the definer allow-list
-- ---------------------------------------------------------------------------

revoke all on function tci.credit_analysis_mode() from public, anon;
grant execute on function tci.credit_analysis_mode() to authenticated, service_role;
revoke all on function tci.has_capability(text) from public, anon;
grant execute on function tci.has_capability(text) to authenticated, service_role;
revoke all on function tci.my_capabilities() from public, anon;
grant execute on function tci.my_capabilities() to authenticated, service_role;
revoke all on function tci.rating_task_role(text) from public, anon;
grant execute on function tci.rating_task_role(text) to authenticated, service_role;
revoke all on function tci.set_credit_analysis_mode(text) from public, anon;
grant execute on function tci.set_credit_analysis_mode(text) to authenticated, service_role;
revoke all on function tci.confirm_rating(uuid, text, text) from public, anon;
grant execute on function tci.confirm_rating(uuid, text, text) to authenticated, service_role;
revoke all on function tci.guard_credit_assessment() from public, anon, authenticated;

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
    ('my_capabilities',          'answers only for the caller''s own acting role under the mode (0069)')
$function$
;

-- ---------------------------------------------------------------------------
-- 8. Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_src text;
begin
  if exists (select 1 from tci.credit_assessments where engine_grade is null and rating_grade is not null) then
    raise exception '0069: an assessment was left without its engine grade';
  end if;
  if has_table_privilege('authenticated', 'tci.credit_assessments', 'update')
     or has_table_privilege('authenticated', 'tci.credit_assessments', 'delete') then
    raise exception '0069: the API may still change or remove an assessment';
  end if;
  if (select pg_get_expr(p.polwithcheck, p.polrelid) from pg_policy p
       where p.polrelid = 'tci.credit_assessments'::regclass and p.polname = 'credit_assessments: credit write')
     not like '%has_capability(''rate''%' then
    raise exception '0069: the rating policy does not ask has_capability(''rate'')';
  end if;
  if (select c.reloptions from pg_class c where c.oid = 'tci.v_rating_worklist'::regclass) is distinct from array['security_invoker=true'] then
    raise exception '0069: v_rating_worklist lost security_invoker';
  end if;
  -- decide is credit underwriting only, in every mode
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'tci' and p.proname = 'has_capability';
  if v_src not like '%when ''decide'' then tci.has_role(''credit_underwriter'')%' or v_src like '%''admin''%' then
    raise exception '0069: has_capability lets someone other than credit underwriting decide';
  end if;
  if has_function_privilege('anon', 'tci.confirm_rating(uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'tci.set_credit_analysis_mode(text)', 'execute') then
    raise exception '0069: anon reaches a credit analysis function';
  end if;
end;
$$;
