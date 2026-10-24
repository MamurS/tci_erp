-- 0073_rating_proposals.sql
--
-- What: the credit analyst's own tools (owner, 2026-10-24):
--       * A MANUAL rating. A grade proposed by a person without (or beside)
--         the engine — statements optional, a reason required. It never
--         comes into force on its proposer's word alone: a second person
--         confirms it, and only then is it written as an assessment
--         (`source = 'manual'`, no score, no recommended limit), already
--         confirmed, with the proposer as its author.
--       * Sending a suggested grade FOR VALIDATION. Any rating proposal —
--         a manual grade, or a grade for the buyer's current, unconfirmed
--         engine assessment (the recommended one or another) — goes to a
--         COLLEAGUE who confirms ratings (credit analysts; credit
--         underwriting too in `combined` mode), or is ESCALATED up the credit
--         authority levels of 0071: rank by rank from the proposer's own,
--         ranks nobody eligible can answer skipped, the committee (rank 5)
--         deciding by vote under the same rules as limits (quorum ≥ half,
--         simple majority, the chair's casting vote, conflicts declared and
--         barred, no majority ⇒ back to the proposer). The answerer approves
--         (the proposed grade), approves another grade (with a reason),
--         returns, rejects, or forwards it up a rank.
--       * ADT for credit analysts: set / disable / block a buyer's auto
--         decision threshold, capped — as for underwriters — by the setter's
--         own authority for the buyer's band (tci.my_authority_uzs), so an
--         analyst needs authority grants of their own (Admin › Полномочия);
--         analysts read the ADT tables too.
--       * Null-safe manual assessments: try_auto_decision gains the reason
--         `no_recommended_limit` (a manual rating carries none, so no auto
--         decision rests on it).
--       * Agenda (0072's types):
--
--   rating_proposal         every eligible answerer (persons)  high; AUTO —
--                           closes when the proposal is answered, forwarded,
--                           withdrawn, or the answerer voted / declared a
--                           conflict
--   rating_proposal_result  the proposer (a person)            normal; MANUAL
--                           — nothing downstream happens once they know
--
-- Why:  the engine cannot rate every buyer (no statements, a group company,
--       a sovereign), and an analyst who disagrees with it, or is unsure,
--       needs a way to put a grade in front of a second pair of eyes — or of
--       the people who carry the authority — before every limit on that
--       buyer is based on it. Rating is four-eyes work at Allianz Trade /
--       Coface / Atradius; a self-confirmed manual grade would not be.
--
-- Who answers an escalated rating: the members of the credit authority level
-- (credit underwriting, as 0071 seats them). In `separate` mode the one who
-- confirms becomes the rating's confirmer, so the four-eyes rule of 0069 then
-- keeps them off the limit decisions on that rating — stated, not hidden.
-- complete_task: rating_proposal_result is the seventh manual type.

-- ---------------------------------------------------------------------------
-- 1. Manual assessments
-- ---------------------------------------------------------------------------

alter table tci.credit_assessments
  add column if not exists source text not null default 'engine'
    check (source in ('engine', 'manual')),
  add column if not exists manual_reason text;

alter table tci.credit_assessments alter column statement_id drop not null;
alter table tci.credit_assessments alter column rating_score drop not null;
alter table tci.credit_assessments alter column suggested_limit drop not null;
alter table tci.credit_assessments alter column limit_currency drop not null;

alter table tci.credit_assessments
  add constraint credit_assessments_source_shape check (
    (source = 'engine' and statement_id is not null and rating_score is not null
       and suggested_limit is not null and limit_currency is not null)
    or (source = 'manual' and nullif(btrim(coalesce(manual_reason, '')), '') is not null
       and confirmed_at is not null and confirmed_by is not null));

comment on column tci.credit_assessments.source is
  'engine: calculated by the rating engine; manual: a grade a person proposed and a second person confirmed through a rating proposal (0073).';
comment on column tci.credit_assessments.manual_reason is
  'Why the grade was set by hand (manual ratings only, 0073).';

-- SECURITY DEFINER since 0073: it asks tci.internal_call_ok(), which no API
-- role may execute. A trigger function; no role holds EXECUTE on it.
create or replace function tci.guard_credit_assessment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- 0073: a manual rating is written only by an approved rating proposal
    -- (trusted code), already confirmed, with its proposer as author.
    if new.source = 'manual' then
      if not tci.internal_call_ok() then
        raise exception 'rating_manual_direct: a manual rating comes into force only through a confirmed rating proposal'
          using errcode = '42501';
      end if;
      new.engine_grade := null;
      return new;
    end if;
    -- The engine's grade is what was calculated; a confirmation is never
    -- inserted, only stamped later by tci.confirm_rating.
    new.engine_grade := new.rating_grade;
    new.confirmed_by := null;
    new.confirmed_at := null;
    new.confirmation_comment := null;
    new.manual_reason := null;
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

-- ---------------------------------------------------------------------------
-- 2. Proposals, their steps, the committee's votes
-- ---------------------------------------------------------------------------

-- The proposal: what was suggested, by whom, why. Never changed.
create table if not exists tci.rating_proposals (
  id             uuid primary key default gen_random_uuid(),
  entity_id      uuid not null references tci.legal_entities (id),
  assessment_id  uuid references tci.credit_assessments (id),
  statement_id   uuid references tci.financial_statements (id),
  proposed_grade text not null check (proposed_grade ~ '^[A-D][0-9]{0,2}$'),
  reason         text not null check (btrim(reason) <> ''),
  proposed_by    uuid not null references auth.users (id),
  created_at     timestamptz not null default now()
);
comment on table tci.rating_proposals is
  'A grade suggested by a person: manual (assessment_id null) or for an engine assessment; it comes into force only when a second person confirms it (0073).';
create index if not exists rating_proposals_entity_idx on tci.rating_proposals (entity_id, created_at desc);

-- One row per hop: with a colleague, or with an authority level. A step is
-- resolved once (guard below); a forward closes it and opens the next.
create table if not exists tci.rating_proposal_steps (
  id                   uuid primary key default gen_random_uuid(),
  seq                  bigint generated always as identity,
  proposal_id          uuid not null references tci.rating_proposals (id),
  entity_id            uuid not null references tci.legal_entities (id),
  route                text not null check (route in ('colleague', 'level')),
  level_id             uuid references tci.authority_levels (id),
  opened_by            uuid not null references auth.users (id),
  opened_at            timestamptz not null default now(),
  status               text not null default 'pending'
    check (status in ('pending', 'approved', 'modified', 'returned', 'rejected', 'forwarded', 'withdrawn')),
  resolved_by          uuid references auth.users (id),
  resolved_at          timestamptz,
  resolved_grade       text check (resolved_grade is null or resolved_grade ~ '^[A-D][0-9]{0,2}$'),
  resolution_comment   text,
  result_assessment_id uuid references tci.credit_assessments (id),
  check ((route = 'level') = (level_id is not null)),
  check ((status = 'pending') = (resolved_at is null))
);
create unique index if not exists rating_proposal_steps_one_pending
  on tci.rating_proposal_steps (entity_id) where status = 'pending';
create index if not exists rating_proposal_steps_entity_idx on tci.rating_proposal_steps (entity_id, seq desc);

create table if not exists tci.rating_votes (
  id       uuid primary key default gen_random_uuid(),
  step_id  uuid not null references tci.rating_proposal_steps (id),
  voter    uuid not null references auth.users (id),
  vote     text not null check (vote in ('approve', 'reject', 'abstain')),
  comment  text,
  voted_at timestamptz not null default now(),
  unique (step_id, voter)
);

create table if not exists tci.rating_conflicts (
  id          uuid primary key default gen_random_uuid(),
  step_id     uuid not null references tci.rating_proposal_steps (id),
  member      uuid not null references auth.users (id),
  reason      text not null check (btrim(reason) <> ''),
  declared_at timestamptz not null default now(),
  unique (step_id, member)
);

create or replace function tci.guard_rating_proposal_step()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'pending'
     or (to_jsonb(new) - array['status', 'resolved_by', 'resolved_at', 'resolved_grade',
                               'resolution_comment', 'result_assessment_id'])
        is distinct from
        (to_jsonb(old) - array['status', 'resolved_by', 'resolved_at', 'resolved_grade',
                               'resolution_comment', 'result_assessment_id']) then
    raise exception 'rating_proposal_steps is a record: a step is resolved once and never changed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger rating_proposals_immutable before update on tci.rating_proposals
  for each row execute function tci.guard_immutable_row();
create trigger rating_proposal_steps_guard before update on tci.rating_proposal_steps
  for each row execute function tci.guard_rating_proposal_step();
create trigger rating_votes_immutable before update on tci.rating_votes
  for each row execute function tci.guard_immutable_row();
create trigger rating_conflicts_immutable before update on tci.rating_conflicts
  for each row execute function tci.guard_immutable_row();

alter table tci.rating_proposals enable row level security;
alter table tci.rating_proposal_steps enable row level security;
alter table tci.rating_votes enable row level security;
alter table tci.rating_conflicts enable row level security;

-- The credit desk (and admin's read oversight) sees proposals; nobody writes
-- them but the functions below.
create policy "rating_proposals: credit desk read" on tci.rating_proposals for select
  using (tci.has_role('admin', 'credit_underwriter', 'credit_analyst'));
create policy "rating_proposal_steps: credit desk read" on tci.rating_proposal_steps for select
  using (tci.has_role('admin', 'credit_underwriter', 'credit_analyst'));
create policy "rating_votes: credit desk read" on tci.rating_votes for select
  using (tci.has_role('admin', 'credit_underwriter', 'credit_analyst'));
create policy "rating_conflicts: credit desk read" on tci.rating_conflicts for select
  using (tci.has_role('admin', 'credit_underwriter', 'credit_analyst'));

revoke all on tci.rating_proposals, tci.rating_proposal_steps, tci.rating_votes, tci.rating_conflicts
  from public, anon, authenticated;
grant select on tci.rating_proposals, tci.rating_proposal_steps, tci.rating_votes, tci.rating_conflicts
  to authenticated;
grant select, insert on tci.rating_proposals, tci.rating_proposal_steps, tci.rating_votes, tci.rating_conflicts
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Who may answer
-- ---------------------------------------------------------------------------

-- Everyone who has taken part in a proposal: the proposer, the author of the
-- assessment it is about, whoever opened or answered a step of it.
create or replace function tci.rating_proposal_chain(p_proposal_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x) filter (where x is not null), '{}'::uuid[]) from (
    select p.proposed_by as x from tci.rating_proposals p where p.id = p_proposal_id
    union all
    select a.created_by from tci.rating_proposals p
      join tci.credit_assessments a on a.id = p.assessment_id where p.id = p_proposal_id
    union all
    select s.opened_by from tci.rating_proposal_steps s where s.proposal_id = p_proposal_id
    union all
    select s.resolved_by from tci.rating_proposal_steps s where s.proposal_id = p_proposal_id) c
$$;

-- A colleague who confirms ratings under the mode, active, outside the chain.
create or replace function tci.rating_colleagues(p_proposal_id uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_chain uuid[];
begin
  perform tci.require_staff_or_internal();
  v_chain := tci.rating_proposal_chain(p_proposal_id);
  return query
    select distinct r.user_id
      from tci.user_roles r
      join auth.users u on u.id = r.user_id
     where (r.role = 'credit_analyst'
            or (r.role = 'credit_underwriter' and tci.credit_analysis_mode() = 'combined'))
       and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
       and not (r.user_id = any (v_chain));
end;
$$;

-- A member of the credit level who may answer this step now: active, holding
-- credit underwriting, outside the chain, not conflicted on the step.
create or replace function tci.rating_level_members(p_level_id uuid, p_proposal_id uuid, p_step_id uuid default null)
returns setof uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_chain uuid[];
begin
  perform tci.require_staff_or_internal();
  v_chain := tci.rating_proposal_chain(p_proposal_id);
  return query
    select distinct m.user_id
      from tci.authority_level_members m
      join tci.authority_levels l on l.id = m.level_id and l.stream = 'credit'
      join auth.users u on u.id = m.user_id
     where m.level_id = p_level_id
       and m.valid_from <= current_date and (m.valid_to is null or m.valid_to >= current_date)
       and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
       and exists (select 1 from tci.user_roles r where r.user_id = m.user_id and r.role = 'credit_underwriter')
       and not (m.user_id = any (v_chain))
       and not exists (select 1 from tci.rating_conflicts c
                        where p_step_id is not null and c.step_id = p_step_id and c.member = m.user_id);
end;
$$;

-- The next credit level above p_from_rank that somebody eligible can answer
-- (the caller excluded). A rating has no amount, so the route is always rank
-- by rank; NULL when nothing above can take it.
create or replace function tci.route_rating_level(p_proposal_id uuid, p_from_rank integer)
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
     where l.stream = 'credit' and l.rank > coalesce(p_from_rank, 0)
     order by l.rank
  loop
    if exists (select 1 from tci.rating_level_members(v_level.id, p_proposal_id, null) m
                where m is distinct from (select auth.uid())) then
      return v_level.id;
    end if;
  end loop;
  return null;
end;
$$;

-- Who may answer a pending step now (the committee: who may vote).
create or replace function tci.rating_step_answerers(p_step tci.rating_proposal_steps)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m order by m), '{}'::uuid[])
    from (select m from tci.rating_colleagues(p_step.proposal_id) m where p_step.route = 'colleague'
          union
          select m from tci.rating_level_members(p_step.level_id, p_step.proposal_id, p_step.id) m
           where p_step.route = 'level') x(m)
$$;

-- ---------------------------------------------------------------------------
-- 4. Opening a step, closing a step
-- ---------------------------------------------------------------------------

create or replace function tci.open_rating_step(
  p_proposal tci.rating_proposals, p_route text, p_level_id uuid)
returns tci.rating_proposal_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step  tci.rating_proposal_steps;
  v_user  uuid;
  v_level tci.authority_levels;
  v_name  text;
  v_event uuid;
begin
  perform tci.require_internal_call();
  insert into tci.rating_proposal_steps (proposal_id, entity_id, route, level_id, opened_by)
  values (p_proposal.id, p_proposal.entity_id, p_route, p_level_id, (select auth.uid()))
  returning * into v_step;

  select * into v_level from tci.authority_levels where id = p_level_id;
  select e.name into v_name from tci.legal_entities e where e.id = p_proposal.entity_id;
  insert into tci.workflow_events (event_type, object_type, object_id, actor, target_role, payload)
  values ('rating.proposal_opened', 'rating_proposal_step', v_step.id, (select auth.uid()), null,
          jsonb_build_object('proposal_id', p_proposal.id, 'entity_id', p_proposal.entity_id,
                             'route', p_route, 'level_rank', v_level.rank,
                             'is_committee', coalesce(v_level.is_committee, false)))
  returning id into v_event;

  for v_user in select unnest(tci.rating_step_answerers(v_step)) loop
    continue when v_user = (select auth.uid());
    perform tci.open_task(
      'rating_proposal', 'rating_proposal_step', v_step.id,
      case when coalesce(v_level.is_committee, false) then 'agenda.tasks.rating_proposal_committee'
           else 'agenda.tasks.rating_proposal' end,
      jsonb_build_object('entity_id', p_proposal.entity_id, 'entity_name', v_name,
                         'proposal_id', p_proposal.id, 'grade', p_proposal.proposed_grade,
                         'manual', p_proposal.assessment_id is null, 'route', p_route,
                         'level_rank', v_level.rank, 'reason', p_proposal.reason,
                         'proposed_by_name', tci.staff_name(p_proposal.proposed_by)),
      null, v_user, null, 'high', v_event);
  end loop;
  return v_step;
end;
$$;

-- Stamps a step's outcome, closes its tasks and — on an end, not a forward —
-- tells the proposer.
create or replace function tci.close_rating_step(
  p_step tci.rating_proposal_steps, p_status text, p_grade text, p_comment text, p_result uuid)
returns tci.rating_proposal_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row  tci.rating_proposal_steps;
  v_prop tci.rating_proposals;
  v_name text;
  v_event uuid;
begin
  perform tci.require_internal_call();
  update tci.rating_proposal_steps s
     set status = p_status, resolved_by = (select auth.uid()), resolved_at = now(),
         resolved_grade = p_grade, resolution_comment = nullif(btrim(coalesce(p_comment, '')), ''),
         result_assessment_id = p_result
   where s.id = p_step.id
  returning * into v_row;
  perform tci.close_tasks(array['rating_proposal']::tci.task_type[], v_row.id,
    case when p_status = 'withdrawn' then 'cancelled' else 'done' end::tci.task_status);

  select * into v_prop from tci.rating_proposals where id = v_row.proposal_id;
  select e.name into v_name from tci.legal_entities e where e.id = v_prop.entity_id;
  insert into tci.workflow_events (event_type, object_type, object_id, actor, target_role, target_user, payload)
  values ('rating.proposal_resolved', 'rating_proposal_step', v_row.id, (select auth.uid()), null,
          v_prop.proposed_by,
          jsonb_build_object('proposal_id', v_prop.id, 'entity_id', v_prop.entity_id, 'status', p_status,
                             'grade', coalesce(p_grade, v_prop.proposed_grade),
                             'assessment_id', p_result))
  returning id into v_event;

  if p_status not in ('forwarded', 'withdrawn') then
    perform tci.open_task(
      'rating_proposal_result', 'rating_proposal_step', v_row.id,
      'agenda.tasks.rating_proposal_result_' || p_status,
      jsonb_build_object('entity_id', v_prop.entity_id, 'entity_name', v_name,
                         'proposal_id', v_prop.id, 'status', p_status,
                         'grade', coalesce(p_grade, v_prop.proposed_grade),
                         'proposed_grade', v_prop.proposed_grade,
                         'comment', v_row.resolution_comment,
                         'resolver_name', tci.staff_name((select auth.uid()))),
      null, v_prop.proposed_by, null,
      case when p_status = 'returned' then 'high' else 'normal' end::tci.task_priority,
      v_event);
  end if;
  return v_row;
end;
$$;

-- Puts an approved grade into force: a manual proposal becomes a confirmed
-- manual assessment authored by its proposer; a proposal on an engine
-- assessment stamps that assessment's one confirmation.
create or replace function tci.apply_rating_proposal(p_proposal tci.rating_proposals, p_grade text, p_comment text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a     tci.credit_assessments;
  v_id    uuid;
  v_note  text := coalesce(nullif(btrim(coalesce(p_comment, '')), ''), p_proposal.reason);
begin
  perform tci.require_internal_call();
  if p_proposal.assessment_id is null then
    insert into tci.credit_assessments (
      entity_id, statement_id, rating_score, rating_grade, suggested_limit, limit_currency,
      inputs_snapshot, calculation_trace, engine_version, created_by,
      source, manual_reason, confirmed_by, confirmed_at, confirmation_comment)
    values (
      p_proposal.entity_id, p_proposal.statement_id, null, p_grade, null, null,
      jsonb_build_object('source', 'manual', 'proposal_id', p_proposal.id, 'proposed_grade', p_proposal.proposed_grade),
      '{}'::jsonb, 'manual', p_proposal.proposed_by,
      'manual', p_proposal.reason, (select auth.uid()), now(), v_note)
    returning id into v_id;
    return v_id;
  end if;

  select * into v_a from tci.credit_assessments a where a.id = p_proposal.assessment_id for update;
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
  update tci.credit_assessments a
     set rating_grade = p_grade,
         confirmed_by = (select auth.uid()),
         confirmed_at = now(),
         confirmation_comment = case when p_grade is distinct from v_a.engine_grade or p_comment is not null
                                     then v_note end
   where a.id = v_a.id;
  perform tci.emit_workflow_event(
    'rating.confirmed', 'credit_assessment', v_a.id,
    jsonb_build_object('entity_id', v_a.entity_id, 'engine_grade', v_a.engine_grade, 'grade', p_grade,
                       'overridden', p_grade is distinct from v_a.engine_grade,
                       'proposal_id', p_proposal.id),
    tci.rating_task_role());
  return v_a.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Proposing, answering, withdrawing
-- ---------------------------------------------------------------------------

create or replace function tci.rating_grade_normalised(p_grade text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when upper(btrim(coalesce(p_grade, ''))) ~ '^[A-D][0-9]{0,2}$'
              then upper(btrim(p_grade)) end
$$;

create or replace function tci.propose_rating(
  p_entity_id uuid,
  p_grade text,
  p_reason text,
  p_assessment_id uuid default null,
  p_statement_id uuid default null,
  p_escalate boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := (select auth.uid());
  v_grade  text := tci.rating_grade_normalised(p_grade);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_a      tci.credit_assessments;
  v_prop   tci.rating_proposals;
  v_level  uuid;
begin
  perform tci.require_staff();
  if not tci.has_capability('rate') then
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
  if exists (select 1 from tci.rating_proposal_steps s where s.entity_id = p_entity_id and s.status = 'pending') then
    raise exception 'rating_proposal_pending: a rating proposal for this buyer is already waiting for an answer'
      using errcode = 'P0001';
  end if;
  if p_assessment_id is not null then
    select * into v_a from tci.credit_assessments a where a.id = p_assessment_id;
    if not found or v_a.entity_id <> p_entity_id then
      raise exception 'rating_assessment_mismatch: that rating is not this buyer''s' using errcode = 'P0001';
    end if;
    if v_a.confirmed_at is not null then
      raise exception 'rating_already_confirmed: this rating has already been confirmed' using errcode = 'P0001';
    end if;
    if exists (select 1 from tci.credit_assessments b
                where b.entity_id = v_a.entity_id and b.created_at > v_a.created_at) then
      raise exception 'rating_not_latest: only the buyer''s current rating may be confirmed' using errcode = 'P0001';
    end if;
  end if;
  if p_statement_id is not null and not exists (
       select 1 from tci.financial_statements fs where fs.id = p_statement_id and fs.entity_id = p_entity_id) then
    raise exception 'rating_statement_mismatch: that statement is not this buyer''s' using errcode = 'P0001';
  end if;

  insert into tci.rating_proposals (entity_id, assessment_id, statement_id, proposed_grade, reason, proposed_by)
  values (p_entity_id, p_assessment_id,
          coalesce(p_statement_id, v_a.statement_id), v_grade, v_reason, v_me)
  returning * into v_prop;

  if coalesce(p_escalate, false) then
    v_level := tci.route_rating_level(v_prop.id, tci.user_rank(v_me, 'credit'));
    if v_level is null then
      raise exception 'rating_level_missing: no credit authority level can take this rating; ask the administrator to set up the levels'
        using errcode = 'P0001';
    end if;
    perform tci.open_rating_step(v_prop, 'level', v_level);
  else
    if not exists (select 1 from tci.rating_colleagues(v_prop.id) m where m <> v_me) then
      raise exception 'rating_no_colleague: nobody else confirms ratings now; escalate it to an authority level instead'
        using errcode = 'P0001';
    end if;
    perform tci.open_rating_step(v_prop, 'colleague', null);
  end if;
  return tci.rating_proposal_state(p_entity_id);
end;
$$;

create or replace function tci.resolve_rating_proposal(
  p_step_id uuid,
  p_action text,
  p_grade text default null,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := (select auth.uid());
  v_step    tci.rating_proposal_steps;
  v_prop    tci.rating_proposals;
  v_level   tci.authority_levels;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_grade   text;
  v_next    uuid;
  v_result  uuid;
  v_committee boolean;
begin
  perform tci.require_staff();
  perform tci.begin_trusted_call();
  select * into v_step from tci.rating_proposal_steps where id = p_step_id for update;
  if not found then
    raise exception 'rating proposal not found' using errcode = 'P0002';
  end if;
  if v_step.status <> 'pending' then
    raise exception 'rating_proposal_closed: this proposal is already %', v_step.status using errcode = 'P0001';
  end if;
  if p_action is null or p_action not in ('approve', 'approve_modified', 'return', 'reject', 'forward') then
    raise exception 'unknown rating proposal action %', coalesce(p_action, '') using errcode = 'P0001';
  end if;
  select * into v_prop from tci.rating_proposals where id = v_step.proposal_id;
  select * into v_level from tci.authority_levels where id = v_step.level_id;
  v_committee := coalesce(v_level.is_committee, false)
                 and coalesce(current_setting('tci.rating_committee_resolution', true), '') = v_step.id::text;

  if coalesce(v_level.is_committee, false) and not v_committee then
    raise exception 'rating_committee_votes: the committee decides this rating by vote' using errcode = 'P0001';
  end if;
  if not v_committee then
    if v_step.route = 'colleague' and not tci.has_capability('confirm_rating') then
      raise exception 'rating_confirm_not_allowed: your role does not confirm ratings under the current credit analysis mode'
        using errcode = '42501';
    end if;
    if v_step.route = 'level' and not tci.has_role('credit_underwriter') then
      raise exception 'rating_not_eligible: only a member of the authority level this rating sits with may answer it'
        using errcode = '42501';
    end if;
    if not (v_me = any (tci.rating_step_answerers(v_step))) then
      raise exception 'rating_not_eligible: you cannot answer this rating proposal (your own, an earlier part in it, or not your level)'
        using errcode = '42501';
    end if;
  end if;

  if p_action in ('approve_modified', 'return', 'reject') and v_comment is null then
    raise exception 'validation_comment_required: say why' using errcode = 'P0001';
  end if;

  if p_action = 'forward' then
    if v_step.route = 'level' and coalesce(v_level.is_committee, false) then
      raise exception 'rating_top_of_chain: the committee is the top of the chain' using errcode = 'P0001';
    end if;
    perform tci.close_rating_step(v_step, 'forwarded', null, v_comment, null);
    v_next := tci.route_rating_level(v_prop.id,
                case when v_step.route = 'level' then v_level.rank else tci.user_rank(v_me, 'credit') end);
    if v_next is null then
      raise exception 'rating_level_missing: no credit authority level above can take this rating; ask the administrator to set up the levels'
        using errcode = 'P0001';
    end if;
    perform tci.open_rating_step(v_prop, 'level', v_next);
    return tci.rating_proposal_state(v_prop.entity_id);
  end if;

  if p_action in ('return', 'reject') then
    perform tci.close_rating_step(v_step, case p_action when 'return' then 'returned' else 'rejected' end,
                                  null, v_comment, null);
    return tci.rating_proposal_state(v_prop.entity_id);
  end if;

  if p_action = 'approve_modified' then
    v_grade := tci.rating_grade_normalised(p_grade);
    if v_grade is null then
      raise exception 'rating_grade_invalid: % is not a grade of the scale', coalesce(p_grade, '') using errcode = 'P0001';
    end if;
    if v_grade = v_prop.proposed_grade then
      raise exception 'rating_modified_same: the grade you approve is the one proposed — approve it as is' using errcode = 'P0001';
    end if;
  else
    v_grade := v_prop.proposed_grade;
  end if;

  v_result := tci.apply_rating_proposal(v_prop, v_grade, v_comment);
  perform tci.close_rating_step(v_step, case p_action when 'approve' then 'approved' else 'modified' end,
                                v_grade, v_comment, v_result);
  return tci.rating_proposal_state(v_prop.entity_id);
end;
$$;

create or replace function tci.withdraw_rating_proposal(p_step_id uuid, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step tci.rating_proposal_steps;
  v_prop tci.rating_proposals;
begin
  perform tci.require_staff();
  perform tci.begin_trusted_call();
  select * into v_step from tci.rating_proposal_steps where id = p_step_id for update;
  if not found then
    raise exception 'rating proposal not found' using errcode = 'P0002';
  end if;
  select * into v_prop from tci.rating_proposals where id = v_step.proposal_id;
  if v_prop.proposed_by is distinct from (select auth.uid()) then
    raise exception 'rating_withdraw_not_yours: only whoever proposed a rating withdraws it' using errcode = '42501';
  end if;
  if v_step.status <> 'pending' then
    raise exception 'rating_proposal_closed: this proposal is already %', v_step.status using errcode = 'P0001';
  end if;
  perform tci.close_rating_step(v_step, 'withdrawn', null, p_comment, null);
  return tci.rating_proposal_state(v_prop.entity_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The committee's vote on a rating (the rules of 0071)
-- ---------------------------------------------------------------------------

create or replace function tci.rating_committee_step(p_step_id uuid)
returns tci.rating_proposal_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row tci.rating_proposal_steps;
begin
  perform tci.require_internal_call();
  select * into v_row from tci.rating_proposal_steps where id = p_step_id for update;
  if not found then
    raise exception 'rating proposal not found' using errcode = 'P0002';
  end if;
  if v_row.level_id is null or not (select l.is_committee from tci.authority_levels l where l.id = v_row.level_id) then
    raise exception 'rating_not_committee: this rating is not before the committee' using errcode = 'P0001';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'rating_proposal_closed: this proposal is already %', v_row.status using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

-- Who may vote now, plus whoever already voted.
create or replace function tci.rating_committee_electorate(p_step tci.rating_proposal_steps)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x), '{}'::uuid[]) from (
    select m as x from tci.rating_level_members(p_step.level_id, p_step.proposal_id, p_step.id) m
    union
    select v.voter from tci.rating_votes v where v.step_id = p_step.id) e
$$;

create or replace function tci.cast_rating_vote(p_step_id uuid, p_vote text, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row tci.rating_proposal_steps;
begin
  perform tci.require_role('credit_underwriter');
  perform tci.begin_trusted_call();
  v_row := tci.rating_committee_step(p_step_id);
  if p_vote is null or p_vote not in ('approve', 'reject', 'abstain') then
    raise exception 'committee_vote_invalid: vote approve, reject or abstain' using errcode = 'P0001';
  end if;
  if p_vote = 'reject' and coalesce(btrim(p_comment), '') = '' then
    raise exception 'validation_comment_required: say why' using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.rating_votes v where v.step_id = v_row.id and v.voter = (select auth.uid())) then
    raise exception 'committee_already_voted: your vote on this proposal is recorded' using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.rating_level_members(v_row.level_id, v_row.proposal_id, v_row.id) m
                  where m = (select auth.uid())) then
    raise exception 'rating_not_eligible: you are not a voting member of the committee on this rating'
      using errcode = '42501';
  end if;
  insert into tci.rating_votes (step_id, voter, vote, comment)
  values (v_row.id, (select auth.uid()), p_vote, nullif(btrim(p_comment), ''));
  update tci.tasks t
     set status = 'done', completed_by = (select auth.uid()), completed_at = now()
   where t.task_type = 'rating_proposal' and t.object_id = v_row.id
     and t.target_user = (select auth.uid()) and t.status = 'open';
  return tci.rating_proposal_state(v_row.entity_id);
end;
$$;

create or replace function tci.declare_rating_conflict(p_step_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row tci.rating_proposal_steps;
begin
  perform tci.require_role('credit_underwriter');
  perform tci.begin_trusted_call();
  v_row := tci.rating_committee_step(p_step_id);
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'committee_conflict_reason_required: say what the conflict is' using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.rating_votes v where v.step_id = v_row.id and v.voter = (select auth.uid())) then
    raise exception 'committee_already_voted: your vote on this proposal is recorded' using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.rating_level_members(v_row.level_id, v_row.proposal_id, v_row.id) m
                  where m = (select auth.uid())) then
    raise exception 'rating_not_eligible: you are not a voting member of the committee on this rating'
      using errcode = '42501';
  end if;
  insert into tci.rating_conflicts (step_id, member, reason)
  values (v_row.id, (select auth.uid()), btrim(p_reason));
  update tci.tasks t
     set status = 'cancelled', completed_by = (select auth.uid()), completed_at = now()
   where t.task_type = 'rating_proposal' and t.object_id = v_row.id
     and t.target_user = (select auth.uid()) and t.status = 'open';
  return tci.rating_proposal_state(v_row.entity_id);
end;
$$;

create or replace function tci.close_rating_vote(p_step_id uuid, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row        tci.rating_proposal_steps;
  v_chair      uuid;
  v_elect      uuid[];
  v_eligible   uuid[];
  v_approve    integer;
  v_reject     integer;
  v_cast       integer;
  v_chair_vote text;
  v_action     text;
  v_result     jsonb;
begin
  perform tci.require_role('credit_underwriter');
  perform tci.begin_trusted_call();
  v_row := tci.rating_committee_step(p_step_id);
  select l.chair_id into v_chair from tci.authority_levels l where l.id = v_row.level_id;
  v_eligible := array(select m from tci.rating_level_members(v_row.level_id, v_row.proposal_id, v_row.id) m);
  v_elect := tci.rating_committee_electorate(v_row);

  if not ((select auth.uid()) = v_chair and v_chair = any (v_elect))
     and not (((v_chair is null) or not (v_chair = any (v_elect))) and (select auth.uid()) = any (v_eligible)) then
    raise exception 'committee_chair_closes: only the chair closes the vote' using errcode = '42501';
  end if;

  select count(*) filter (where v.vote = 'approve'), count(*) filter (where v.vote = 'reject'), count(*)
    into v_approve, v_reject, v_cast
    from tci.rating_votes v where v.step_id = v_row.id;
  if cardinality(v_elect) = 0 or v_cast * 2 < cardinality(v_elect) then
    raise exception 'committee_no_quorum: at least half of the committee must vote (% of % so far)', v_cast, cardinality(v_elect)
      using errcode = 'P0001';
  end if;

  select v.vote into v_chair_vote from tci.rating_votes v where v.step_id = v_row.id and v.voter = v_chair;
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

  perform set_config('tci.rating_committee_resolution', v_row.id::text, true);
  v_result := tci.resolve_rating_proposal(v_row.id, v_action, null, p_comment);
  perform set_config('tci.rating_committee_resolution', '', true);
  return v_result || jsonb_build_object('committee', jsonb_build_object(
    'approve', v_approve, 'reject', v_reject, 'cast', v_cast, 'electorate', cardinality(v_elect),
    'action', v_action, 'chair_vote', v_chair_vote));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. What the screen reads
-- ---------------------------------------------------------------------------

-- The buyer's pending proposal (with whom it sits, whether the caller may
-- answer or vote, the tally) and the history of earlier ones.
create or replace function tci.rating_proposal_state(p_entity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me      uuid := (select auth.uid());
  v_step    tci.rating_proposal_steps;
  v_prop    tci.rating_proposals;
  v_level   tci.authority_levels;
  v_answer  uuid[] := '{}';
  v_elect   uuid[] := '{}';
  v_pending jsonb;
  v_history jsonb;
  v_votes   jsonb := '[]';
  v_conf    jsonb := '[]';
  v_cast    integer := 0;
begin
  perform tci.require_role('admin', 'credit_underwriter', 'credit_analyst');
  perform tci.begin_trusted_call();

  select * into v_step from tci.rating_proposal_steps s
   where s.entity_id = p_entity_id and s.status = 'pending';
  if found then
    select * into v_prop from tci.rating_proposals where id = v_step.proposal_id;
    select * into v_level from tci.authority_levels where id = v_step.level_id;
    v_answer := tci.rating_step_answerers(v_step);
    v_pending := jsonb_build_object(
      'step_id', v_step.id, 'proposal_id', v_prop.id, 'route', v_step.route,
      'level_id', v_step.level_id, 'rank', v_level.rank,
      'is_committee', coalesce(v_level.is_committee, false),
      'grade', v_prop.proposed_grade, 'reason', v_prop.reason,
      'manual', v_prop.assessment_id is null, 'assessment_id', v_prop.assessment_id,
      'statement_id', v_prop.statement_id,
      'proposed_by', v_prop.proposed_by, 'proposed_by_name', tci.staff_name(v_prop.proposed_by),
      'proposed_at', v_prop.created_at, 'opened_at', v_step.opened_at,
      'mine', v_prop.proposed_by = v_me,
      'can_answer', not coalesce(v_level.is_committee, false) and v_me = any (v_answer)
                    and case when v_step.route = 'colleague' then tci.has_capability('confirm_rating')
                             else tci.has_role('credit_underwriter') end,
      'answerers', (select coalesce(jsonb_agg(jsonb_build_object('user_id', m, 'name', tci.staff_name(m))
                                              order by tci.staff_name(m)), '[]'::jsonb)
                      from unnest(v_answer) m));
    if coalesce(v_level.is_committee, false) then
      v_elect := tci.rating_committee_electorate(v_step);
      select coalesce(jsonb_agg(jsonb_build_object('voter', v.voter, 'name', tci.staff_name(v.voter), 'vote', v.vote,
                                                   'comment', v.comment, 'voted_at', v.voted_at) order by v.voted_at), '[]'::jsonb),
             count(*)
        into v_votes, v_cast
        from tci.rating_votes v where v.step_id = v_step.id;
      select coalesce(jsonb_agg(jsonb_build_object('member', c.member, 'name', tci.staff_name(c.member),
                                                   'reason', c.reason, 'declared_at', c.declared_at) order by c.declared_at), '[]'::jsonb)
        into v_conf
        from tci.rating_conflicts c where c.step_id = v_step.id;
      v_pending := v_pending || jsonb_build_object('committee', jsonb_build_object(
        'chair_id', v_level.chair_id, 'chair_name', tci.staff_name(v_level.chair_id),
        'electorate', cardinality(v_elect),
        'votes', v_votes, 'conflicts', v_conf, 'cast', v_cast,
        'approve', (select count(*) from jsonb_array_elements(v_votes) x where x ->> 'vote' = 'approve'),
        'reject', (select count(*) from jsonb_array_elements(v_votes) x where x ->> 'vote' = 'reject'),
        'abstain', (select count(*) from jsonb_array_elements(v_votes) x where x ->> 'vote' = 'abstain'),
        'quorum_met', cardinality(v_elect) > 0 and v_cast * 2 >= cardinality(v_elect),
        'my_vote', (select v.vote from tci.rating_votes v where v.step_id = v_step.id and v.voter = v_me),
        'i_may_vote', tci.has_role('credit_underwriter') and v_me = any (v_answer)
                      and not exists (select 1 from tci.rating_votes v where v.step_id = v_step.id and v.voter = v_me),
        'i_am_conflicted', exists (select 1 from tci.rating_conflicts c where c.step_id = v_step.id and c.member = v_me),
        'i_may_close', tci.has_role('credit_underwriter') and (
            (v_me = v_level.chair_id and v_level.chair_id = any (v_elect))
            or ((v_level.chair_id is null or not (v_level.chair_id = any (v_elect))) and v_me = any (v_answer)))));
    end if;
  end if;

  select coalesce(jsonb_agg(h order by seq desc), '[]'::jsonb) into v_history from (
    select jsonb_build_object(
      'step_id', s.id, 'proposal_id', p.id, 'route', s.route, 'rank', l.rank,
      'is_committee', coalesce(l.is_committee, false), 'status', s.status,
      'grade', p.proposed_grade, 'resolved_grade', s.resolved_grade, 'reason', p.reason,
      'manual', p.assessment_id is null,
      'proposed_by_name', tci.staff_name(p.proposed_by), 'opened_by_name', tci.staff_name(s.opened_by),
      'opened_at', s.opened_at, 'resolved_by_name', tci.staff_name(s.resolved_by),
      'resolved_at', s.resolved_at, 'comment', s.resolution_comment,
      'result_assessment_id', s.result_assessment_id) as h, s.seq
      from tci.rating_proposal_steps s
      join tci.rating_proposals p on p.id = s.proposal_id
      left join tci.authority_levels l on l.id = s.level_id
     where s.entity_id = p_entity_id and s.status <> 'pending'
     order by s.seq desc
     limit 50) x;

  return jsonb_build_object('pending', v_pending, 'history', v_history,
                            'can_propose', tci.has_capability('rate') and v_pending is null);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. A pending proposal holds the plain confirmation; Agenda; auto decisions
-- ---------------------------------------------------------------------------

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('tci.confirm_rating(uuid, text, text)'::regprocedure);
  if v_def not like '%  if v_a.confirmed_at is not null then
    raise exception ''rating_already_confirmed%' then
    raise exception '0073: confirm_rating is not the body this migration expects';
  end if;
  v_def := replace(v_def,
    '  if v_a.confirmed_at is not null then
    raise exception ''rating_already_confirmed',
    '  -- 0073: a proposal waiting for an answer is answered there, not here.
  if exists (select 1 from tci.rating_proposal_steps s
              where s.entity_id = v_a.entity_id and s.status = ''pending'') then
    raise exception ''rating_proposal_pending: a rating proposal for this buyer is waiting for an answer''
      using errcode = ''P0001'';
  end if;
  if v_a.confirmed_at is not null then
    raise exception ''rating_already_confirmed');
  execute v_def;

  v_def := pg_get_functiondef('tci.try_auto_decision(uuid)'::regprocedure);
  if v_def not like '%    v_rec_uzs := tci.uzs_or_null(v_assessment.suggested_limit, v_assessment.limit_currency);
    if v_rec_uzs is null or v_req_uzs is null then%' then
    raise exception '0073: try_auto_decision is not the body this migration expects';
  end if;
  v_def := replace(v_def,
    '    v_rec_uzs := tci.uzs_or_null(v_assessment.suggested_limit, v_assessment.limit_currency);
    if v_rec_uzs is null or v_req_uzs is null then',
    '    v_rec_uzs := tci.uzs_or_null(v_assessment.suggested_limit, v_assessment.limit_currency);
    -- 0073: a manual rating carries no recommended limit to stay under.
    if v_assessment.suggested_limit is null then
      v_reasons := v_reasons || ''no_recommended_limit''::text;
    elsif v_rec_uzs is null or v_req_uzs is null then');
  execute v_def;
end;
$$;

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
  -- 0073: the proposer has read how their rating proposal ended.
  if v_task.task_type not in
     ('submission_declined', 'uncovered_excess_review', 'claim_declined_review',
      'entity_request_resolved', 'limit_validation_result', 'limit_validation_fyi',
      'rating_proposal_result') then
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
-- 9. ADT for credit analysts, within their own authority grants
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn  text;
  v_def text;
begin
  foreach v_fn in array array['tci.set_buyer_adt(uuid,numeric,character,integer,uuid,text)',
                              'tci.disable_buyer_adt(uuid,text)',
                              'tci.set_buyer_adt_block(uuid,boolean,text)'] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    if v_def not like '%perform tci.require_role(''credit_underwriter'');%' then
      raise exception '0073: % is not the body this migration expects', v_fn;
    end if;
    execute replace(v_def, 'perform tci.require_role(''credit_underwriter'');',
                           'perform tci.require_role(''credit_underwriter'', ''credit_analyst'');');
  end loop;
  foreach v_fn in array array['tci.auto_decision_settings()', 'tci.buyer_adt_state(uuid)'] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    if v_def not like '%perform tci.require_role(''admin'', ''credit_underwriter'');%' then
      raise exception '0073: % is not the body this migration expects', v_fn;
    end if;
    execute replace(v_def, 'perform tci.require_role(''admin'', ''credit_underwriter'');',
                           'perform tci.require_role(''admin'', ''credit_underwriter'', ''credit_analyst'');');
  end loop;
end;
$$;

alter policy "buyer_adt: credit desk" on tci.buyer_adt
  using (tci.has_role('admin', 'credit_underwriter', 'credit_analyst'));
alter policy "buyer_adt_blocks: credit desk" on tci.buyer_adt_blocks
  using (tci.has_role('admin', 'credit_underwriter', 'credit_analyst'));
alter policy "auto_decision_attempts: credit desk" on tci.auto_decision_attempts
  using (tci.has_role('admin', 'credit_underwriter', 'credit_analyst'));

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------

revoke all on function tci.guard_rating_proposal_step() from public, anon, authenticated;
revoke all on function tci.guard_credit_assessment() from public, anon, authenticated;
revoke all on function tci.rating_grade_normalised(text) from public, anon;
grant execute on function tci.rating_grade_normalised(text) to authenticated, service_role;

-- Internal: reached only from the functions below, as the owner.
revoke all on function tci.rating_proposal_chain(uuid) from public, anon, authenticated;
revoke all on function tci.rating_step_answerers(tci.rating_proposal_steps) from public, anon, authenticated;
revoke all on function tci.rating_committee_electorate(tci.rating_proposal_steps) from public, anon, authenticated;
revoke all on function tci.rating_colleagues(uuid) from public, anon, authenticated;
revoke all on function tci.rating_level_members(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function tci.route_rating_level(uuid, integer) from public, anon, authenticated;
revoke all on function tci.open_rating_step(tci.rating_proposals, text, uuid) from public, anon, authenticated;
revoke all on function tci.close_rating_step(tci.rating_proposal_steps, text, text, text, uuid) from public, anon, authenticated;
revoke all on function tci.apply_rating_proposal(tci.rating_proposals, text, text) from public, anon, authenticated;
revoke all on function tci.rating_committee_step(uuid) from public, anon, authenticated;
grant execute on function tci.rating_proposal_chain(uuid), tci.rating_step_answerers(tci.rating_proposal_steps),
  tci.rating_committee_electorate(tci.rating_proposal_steps), tci.rating_colleagues(uuid),
  tci.rating_level_members(uuid, uuid, uuid), tci.route_rating_level(uuid, integer),
  tci.open_rating_step(tci.rating_proposals, text, uuid),
  tci.close_rating_step(tci.rating_proposal_steps, text, text, text, uuid),
  tci.apply_rating_proposal(tci.rating_proposals, text, text), tci.rating_committee_step(uuid)
  to service_role;

-- The API.
revoke all on function tci.propose_rating(uuid, text, text, uuid, uuid, boolean) from public, anon;
revoke all on function tci.resolve_rating_proposal(uuid, text, text, text) from public, anon;
revoke all on function tci.withdraw_rating_proposal(uuid, text) from public, anon;
revoke all on function tci.cast_rating_vote(uuid, text, text) from public, anon;
revoke all on function tci.declare_rating_conflict(uuid, text) from public, anon;
revoke all on function tci.close_rating_vote(uuid, text) from public, anon;
revoke all on function tci.rating_proposal_state(uuid) from public, anon;
grant execute on function tci.propose_rating(uuid, text, text, uuid, uuid, boolean),
  tci.resolve_rating_proposal(uuid, text, text, text), tci.withdraw_rating_proposal(uuid, text),
  tci.cast_rating_vote(uuid, text, text), tci.declare_rating_conflict(uuid, text),
  tci.close_rating_vote(uuid, text), tci.rating_proposal_state(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_fn text;
  v_src text;
begin
  -- Every new definer function opens with a gate (the Phase A rule).
  foreach v_fn in array array['rating_colleagues', 'rating_level_members', 'route_rating_level',
                              'open_rating_step', 'close_rating_step', 'apply_rating_proposal',
                              'propose_rating', 'resolve_rating_proposal', 'withdraw_rating_proposal',
                              'rating_committee_step', 'cast_rating_vote', 'declare_rating_conflict',
                              'close_rating_vote', 'rating_proposal_state'] loop
    select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'tci' and p.proname = v_fn;
    if v_src is null or v_src !~ '^\s*(declare.*?)?begin\s+perform tci\.require_' then
      raise exception '0073: % does not open with a gate', v_fn;
    end if;
  end loop;
  -- The SQL helpers are closed to the API (they read auth.users / the chain).
  foreach v_fn in array array['tci.rating_proposal_chain(uuid)',
                              'tci.rating_step_answerers(tci.rating_proposal_steps)',
                              'tci.rating_committee_electorate(tci.rating_proposal_steps)'] loop
    if has_function_privilege('authenticated', v_fn, 'execute') or has_function_privilege('anon', v_fn, 'execute') then
      raise exception '0073: % is reachable from the API', v_fn;
    end if;
  end loop;
  if has_function_privilege('anon', 'tci.propose_rating(uuid, text, text, uuid, uuid, boolean)', 'execute') then
    raise exception '0073: anon reaches propose_rating';
  end if;
  foreach v_fn in array array['rating_proposals', 'rating_proposal_steps', 'rating_votes', 'rating_conflicts'] loop
    if has_table_privilege('authenticated', 'tci.' || v_fn, 'insert')
       or has_table_privilege('authenticated', 'tci.' || v_fn, 'update')
       or has_table_privilege('authenticated', 'tci.' || v_fn, 'delete') then
      raise exception '0073: the API may write tci.%', v_fn;
    end if;
  end loop;
  -- No new function names admin as a decider (0065).
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'tci'
                and p.proname in ('propose_rating', 'resolve_rating_proposal', 'withdraw_rating_proposal',
                                  'cast_rating_vote', 'declare_rating_conflict', 'close_rating_vote',
                                  'set_buyer_adt', 'disable_buyer_adt', 'set_buyer_adt_block')
                and p.prosrc like '%''admin''%') then
    raise exception '0073: a rating or ADT write names admin';
  end if;
  if (select prosrc from pg_proc where oid = 'tci.try_auto_decision(uuid)'::regprocedure)
     not like '%no_recommended_limit%' then
    raise exception '0073: try_auto_decision does not refuse a rating without a recommended limit';
  end if;
  if (select prosrc from pg_proc where oid = 'tci.confirm_rating(uuid, text, text)'::regprocedure)
     not like '%rating_proposal_pending%' then
    raise exception '0073: confirm_rating does not wait for a pending proposal';
  end if;
  -- Existing assessments are all engine ratings and keep their shape.
  if exists (select 1 from tci.credit_assessments where source <> 'engine') then
    raise exception '0073: an existing assessment is not an engine rating';
  end if;
end;
$$;
