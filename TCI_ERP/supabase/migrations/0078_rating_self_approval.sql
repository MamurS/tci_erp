-- 0078_rating_self_approval.sql
--
-- What: whoever rates decides how a grade comes into force (owner,
--       2026-10-26). A new entry point, tci.submit_rating(entity, grade,
--       reason, route, colleague?, assessment?, statement?), offers three
--       routes:
--         * 'self' — the rater approves their own grade at once: a manual
--           grade becomes a confirmed manual assessment, a grade for the
--           buyer's current engine rating stamps its one confirmation. The
--           proposal is kept as a record (rating_proposals.self_approved),
--           the reason is still required, the group cap still applies, and
--           the history says so («утверждён самостоятельно»).
--         * 'colleague' — to a NAMED colleague who confirms ratings
--           (rating_proposal_steps.target_user; only they get the task and
--           only they may answer), or, with no colleague named, to all of
--           them — any one may answer, as before.
--         * 'level' — escalated up the credit authority levels, as before.
--       tci.rating_send_options(entity, assessment?) tells the screen whom
--       each route reaches before anything is sent: the colleagues who may
--       confirm it, and the next authority level that can take it with its
--       members (or the committee).
--       propose_rating keeps its signature and behaviour (the colleague /
--       level routes of submit_rating go through it); apply_rating_proposal
--       skips the four-eyes refusal for a self-approved proposal only.
-- Why:  sending every grade to a second person made the analyst's routine
--       work wait on a colleague. Four eyes on a rating becomes the rater's
--       choice; the decision on a LIMIT keeps its own four eyes (0063, and in
--       `separate` mode 0069's rule that whoever confirmed the rating does
--       not decide on it — a self-approver is that confirmer).
-- Nothing is removed: the steps table gains a column instead of a new route value, and
-- every replaced function keeps its signature.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

alter table tci.rating_proposals
  add column if not exists self_approved boolean not null default false;
comment on column tci.rating_proposals.self_approved is
  'The proposer approved their own grade (submit_rating route ''self'', 0078); no step was opened.';

alter table tci.rating_proposal_steps
  add column if not exists target_user uuid references auth.users (id);
comment on column tci.rating_proposal_steps.target_user is
  'A colleague step sent to one named colleague (0078); NULL = any colleague who confirms ratings.';

-- ---------------------------------------------------------------------------
-- 2. Who may answer, given who has taken part
-- ---------------------------------------------------------------------------

-- The 0073 rules with the chain passed in, so the screen can ask before a
-- proposal exists.
create function tci.rating_colleagues_excluding(p_chain uuid[])
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff_or_internal();
  return query
    select distinct r.user_id
      from tci.user_roles r
      join auth.users u on u.id = r.user_id
     where (r.role = 'credit_analyst'
            or (r.role = 'credit_underwriter' and tci.credit_analysis_mode() = 'combined'))
       and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
       and not (r.user_id = any (coalesce(p_chain, '{}'::uuid[])));
end;
$$;

create function tci.rating_level_members_excluding(p_level_id uuid, p_chain uuid[], p_step_id uuid default null)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff_or_internal();
  return query
    select distinct m.user_id
      from tci.authority_level_members m
      join tci.authority_levels l on l.id = m.level_id and l.stream = 'credit'
      join auth.users u on u.id = m.user_id
     where m.level_id = p_level_id
       and m.valid_from <= current_date and (m.valid_to is null or m.valid_to >= current_date)
       and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
       and exists (select 1 from tci.user_roles r where r.user_id = m.user_id and r.role = 'credit_underwriter')
       and not (m.user_id = any (coalesce(p_chain, '{}'::uuid[])))
       and not exists (select 1 from tci.rating_conflicts c
                        where p_step_id is not null and c.step_id = p_step_id and c.member = m.user_id);
end;
$$;

create or replace function tci.rating_colleagues(p_proposal_id uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff_or_internal();
  return query select * from tci.rating_colleagues_excluding(tci.rating_proposal_chain(p_proposal_id));
end;
$$;

create or replace function tci.rating_level_members(p_level_id uuid, p_proposal_id uuid, p_step_id uuid default null)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform tci.require_staff_or_internal();
  return query
    select * from tci.rating_level_members_excluding(p_level_id, tci.rating_proposal_chain(p_proposal_id), p_step_id);
end;
$$;

-- A step sent to one colleague is answered by that colleague alone.
create or replace function tci.rating_step_answerers(p_step tci.rating_proposal_steps)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m order by m), '{}'::uuid[])
    from (select m from tci.rating_colleagues(p_step.proposal_id) m
           where p_step.route = 'colleague' and (p_step.target_user is null or m = p_step.target_user)
          union
          select m from tci.rating_level_members(p_step.level_id, p_step.proposal_id, p_step.id) m
           where p_step.route = 'level') x(m)
$$;

-- ---------------------------------------------------------------------------
-- 3. open_rating_step takes the named colleague; apply skips four eyes for
--    a self-approved proposal (both rebuilt from their own bodies)
-- ---------------------------------------------------------------------------

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('tci.open_rating_step(tci.rating_proposals, text, uuid)'::regprocedure);
  if v_def not like '%  insert into tci.rating_proposal_steps (proposal_id, entity_id, route, level_id, opened_by)
  values (p_proposal.id, p_proposal.entity_id, p_route, p_level_id, (select auth.uid()))
  returning * into v_step;%' then
    raise exception '0078: open_rating_step is not the body this migration expects';
  end if;
  v_def := replace(v_def,
    '  insert into tci.rating_proposal_steps (proposal_id, entity_id, route, level_id, opened_by)
  values (p_proposal.id, p_proposal.entity_id, p_route, p_level_id, (select auth.uid()))
  returning * into v_step;',
    '  -- 0078: a colleague step may be sent to one named colleague
  -- (tci.rating_target, set by submit_rating for this call only).
  insert into tci.rating_proposal_steps (proposal_id, entity_id, route, level_id, opened_by, target_user)
  values (p_proposal.id, p_proposal.entity_id, p_route, p_level_id, (select auth.uid()),
          case when p_route = ''colleague''
               then nullif(current_setting(''tci.rating_target'', true), '''')::uuid end)
  returning * into v_step;
  perform set_config(''tci.rating_target'', '''', true);
  if v_step.target_user is not null and not (v_step.target_user = any (tci.rating_step_answerers(v_step))) then
    raise exception ''rating_colleague_not_eligible: that colleague cannot confirm this rating''
      using errcode = ''P0001'';
  end if;');
  execute v_def;

  v_def := pg_get_functiondef('tci.apply_rating_proposal(tci.rating_proposals, text, text)'::regprocedure);
  if v_def not like '%  if v_a.created_by = (select auth.uid()) then
    raise exception ''four_eyes_own_rating%' then
    raise exception '0078: apply_rating_proposal is not the body this migration expects';
  end if;
  v_def := replace(v_def,
    '  if v_a.created_by = (select auth.uid()) then
    raise exception ''four_eyes_own_rating',
    '  -- 0078: the rater may approve their own grade (submit_rating ''self'').
  if v_a.created_by = (select auth.uid()) and not p_proposal.self_approved then
    raise exception ''four_eyes_own_rating');
  execute v_def;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The entry point
-- ---------------------------------------------------------------------------

create function tci.submit_rating(
  p_entity_id uuid,
  p_grade text,
  p_reason text,
  p_route text,
  p_colleague uuid default null,
  p_assessment_id uuid default null,
  p_statement_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := (select auth.uid());
  v_route  text := lower(btrim(coalesce(p_route, '')));
  v_grade  text := tci.rating_grade_normalised(p_grade);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_a      tci.credit_assessments;
  v_prop   tci.rating_proposals;
  v_result uuid;
begin
  perform tci.require_staff();
  if v_route not in ('self', 'colleague', 'level') then
    raise exception 'rating_route_invalid: % is not a way to submit a rating', coalesce(p_route, '') using errcode = 'P0001';
  end if;

  -- To a colleague (named or any) or up the levels: the 0073 path, unchanged.
  if v_route in ('colleague', 'level') then
    perform set_config('tci.rating_target',
                       case when v_route = 'colleague' then coalesce(p_colleague::text, '') else '' end, true);
    return tci.propose_rating(p_entity_id, p_grade, p_reason, p_assessment_id, p_statement_id, v_route = 'level');
  end if;

  -- Approved by the rater.
  if not (tci.has_capability('rate') and tci.has_capability('confirm_rating')) then
    raise exception 'rating_propose_not_allowed: your role does not rate buyers under the current credit analysis mode'
      using errcode = '42501';
  end if;
  perform tci.begin_trusted_call();
  if not exists (select 1 from tci.legal_entities e where e.id = p_entity_id) then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  if v_grade is null then
    raise exception 'rating_grade_invalid: % is not a grade of the scale', coalesce(p_grade, '') using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'rating_proposal_reason_required: say why you propose this grade' using errcode = 'P0001';
  end if;
  perform 1 from tci.legal_entities e where e.id = p_entity_id for update;
  if tci.grade_worse(v_grade, (tci.group_rating_cap(p_entity_id)).grade) <> v_grade then
    raise exception 'rating_above_group_cap: the grade is better than the group rating % that caps this buyer',
      (tci.group_rating_cap(p_entity_id)).grade using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.rating_proposal_steps s where s.entity_id = p_entity_id and s.status = 'pending') then
    raise exception 'rating_proposal_pending: a rating proposal for this buyer is already waiting for an answer'
      using errcode = 'P0001';
  end if;
  if p_assessment_id is not null then
    select * into v_a from tci.credit_assessments a where a.id = p_assessment_id;
    if not found or v_a.entity_id <> p_entity_id then
      raise exception 'rating_assessment_mismatch: that rating is not this buyer''s' using errcode = 'P0001';
    end if;
  end if;
  if p_statement_id is not null and not exists (
       select 1 from tci.financial_statements fs where fs.id = p_statement_id and fs.entity_id = p_entity_id) then
    raise exception 'rating_statement_mismatch: that statement is not this buyer''s' using errcode = 'P0001';
  end if;

  insert into tci.rating_proposals (entity_id, assessment_id, statement_id, proposed_grade, reason, proposed_by, self_approved)
  values (p_entity_id, p_assessment_id, coalesce(p_statement_id, v_a.statement_id), v_grade, v_reason, v_me, true)
  returning * into v_prop;
  -- Already confirmed, not the current rating, above the cap: refused there.
  v_result := tci.apply_rating_proposal(v_prop, v_grade, null);
  perform tci.emit_workflow_event(
    'rating.self_approved', 'rating_proposal', v_prop.id,
    jsonb_build_object('entity_id', p_entity_id, 'grade', v_grade, 'assessment_id', v_result,
                       'manual', p_assessment_id is null),
    null);
  return tci.rating_proposal_state(p_entity_id);
end;
$$;

-- Whom each route reaches, before anything is sent.
create function tci.rating_send_options(p_entity_id uuid, p_assessment_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me     uuid := (select auth.uid());
  v_chain  uuid[];
  v_level  tci.authority_levels;
  v_found  jsonb;
  v_people uuid[];
begin
  perform tci.require_role('credit_underwriter', 'credit_analyst');
  perform tci.begin_trusted_call();
  v_chain := array_remove(array[v_me,
               (select a.created_by from tci.credit_assessments a
                 where a.id = p_assessment_id and a.entity_id = p_entity_id)], null);

  for v_level in
    select * from tci.authority_levels l
     where l.stream = 'credit' and l.rank > coalesce(tci.user_rank(v_me, 'credit'), 0)
     order by l.rank
  loop
    v_people := array(select m from tci.rating_level_members_excluding(v_level.id, v_chain, null) m);
    if cardinality(v_people) > 0 then
      v_found := jsonb_build_object(
        'level_id', v_level.id, 'rank', v_level.rank, 'is_committee', v_level.is_committee,
        'chair_name', tci.staff_name(v_level.chair_id),
        'members', (select jsonb_agg(jsonb_build_object('user_id', m, 'name', tci.staff_name(m))
                                     order by tci.staff_name(m)) from unnest(v_people) m));
      exit;
    end if;
  end loop;

  return jsonb_build_object(
    'can_self', tci.has_capability('rate') and tci.has_capability('confirm_rating'),
    'colleagues', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m, 'name', tci.staff_name(m))
                                             order by tci.staff_name(m)), '[]'::jsonb)
                     from tci.rating_colleagues_excluding(v_chain) m),
    'level', v_found);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The history shows self-approved grades (rebuilt from its own body)
-- ---------------------------------------------------------------------------

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('tci.rating_proposal_state(uuid)'::regprocedure);
  if v_def not like '%  return jsonb_build_object(''pending'', v_pending, ''history'', v_history,%' then
    raise exception '0078: rating_proposal_state is not the body this migration expects';
  end if;
  v_def := replace(v_def,
    '  return jsonb_build_object(''pending'', v_pending, ''history'', v_history,',
    '  -- 0078: grades their rater approved alone are part of the history.
  select coalesce(jsonb_agg(h order by coalesce(h ->> ''resolved_at'', h ->> ''opened_at'') desc), ''[]''::jsonb)
    into v_history
    from (select h from jsonb_array_elements(v_history) h
          union all
          (select jsonb_build_object(
             ''step_id'', null, ''proposal_id'', p.id, ''route'', ''self'', ''rank'', null,
             ''is_committee'', false, ''status'', ''self_approved'',
             ''grade'', p.proposed_grade, ''resolved_grade'', p.proposed_grade, ''reason'', p.reason,
             ''manual'', p.assessment_id is null,
             ''proposed_by_name'', tci.staff_name(p.proposed_by), ''opened_by_name'', tci.staff_name(p.proposed_by),
             ''opened_at'', p.created_at, ''resolved_by_name'', tci.staff_name(p.proposed_by),
             ''resolved_at'', p.created_at, ''comment'', null, ''result_assessment_id'', null)
             from tci.rating_proposals p
            where p.entity_id = p_entity_id and p.self_approved
            order by p.created_at desc
            limit 50)) x(h);

  return jsonb_build_object(''pending'', v_pending, ''history'', v_history,');
  execute v_def;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants and assertions
-- ---------------------------------------------------------------------------

revoke all on function tci.rating_colleagues_excluding(uuid[]) from public, anon;
revoke all on function tci.rating_level_members_excluding(uuid, uuid[], uuid) from public, anon;
revoke all on function tci.submit_rating(uuid, text, text, text, uuid, uuid, uuid) from public, anon;
revoke all on function tci.rating_send_options(uuid, uuid) from public, anon;
grant execute on function tci.rating_colleagues_excluding(uuid[]) to authenticated, service_role;
grant execute on function tci.rating_level_members_excluding(uuid, uuid[], uuid) to authenticated, service_role;
grant execute on function tci.submit_rating(uuid, text, text, text, uuid, uuid, uuid) to authenticated, service_role;
grant execute on function tci.rating_send_options(uuid, uuid) to authenticated, service_role;

do $$
declare
  v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace and p.prosecdef
     and p.proname in ('rating_colleagues_excluding', 'rating_level_members_excluding',
                       'submit_rating', 'rating_send_options')
     and p.prosrc !~ 'perform tci\.require_(staff|role|staff_or_internal)\(';
  if v_bad is not null then
    raise exception '0078: ungated: %', v_bad;
  end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace
     and p.proname in ('rating_colleagues_excluding', 'rating_level_members_excluding',
                       'submit_rating', 'rating_send_options')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then
    raise exception '0078: anon can execute %', v_bad;
  end if;
  if position('not p_proposal.self_approved' in
       pg_get_functiondef('tci.apply_rating_proposal(tci.rating_proposals, text, text)'::regprocedure)) = 0
     or position('rating_colleague_not_eligible' in
       pg_get_functiondef('tci.open_rating_step(tci.rating_proposals, text, uuid)'::regprocedure)) = 0
     or position('self_approved' in pg_get_functiondef('tci.rating_proposal_state(uuid)'::regprocedure)) = 0 then
    raise exception '0078: a rebuilt function is not the 0078 text';
  end if;
end;
$$;
