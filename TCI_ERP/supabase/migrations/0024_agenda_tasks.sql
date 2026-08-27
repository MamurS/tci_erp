-- 0024_agenda_tasks.sql
-- What: the Agenda - tci.tasks plus the mapping that turns tci.workflow_events
--       into tasks and closes them again when their object moves on. Also adds
--       the three events the mapping needs and 3c-1 never emitted.
-- Why:  every department queue so far is a domain view (/limits, /requests).
--       The Agenda is the personal, cross-cutting one: what *I* owe, whatever
--       object it hangs off. It is generated, never hand-maintained, so a task
--       cannot outlive the condition that raised it.
--
-- No cron anywhere. Event-driven tasks come from an AFTER INSERT trigger on
-- workflow_events; the two time-based kinds (limit review, stale rating) are
-- generated and retired lazily by tci.refresh_agenda(), which the Agenda
-- screen calls on read.
--
-- Task catalogue and how each one closes:
--
--   task_type                     target                  closes
--   ---------------------------   ---------------------   --------------------
--   buyer_needs_entity            information_manager     AUTO request.buyer_resolved
--   buyer_needs_rating            credit_underwriter      AUTO rating.created
--   limit_needs_decision          credit_underwriter *    AUTO limit.credit_decided
--   limit_escalated               credit_underwriter *    AUTO limit.credit_decided
--   submission_commercial_review  commercial_underwriter  AUTO status leaves commercial_review
--   submission_sales_confirmation sales                   AUTO status leaves sales_confirmation
--   limit_held                    the decider (user)      AUTO limit.released / commercial_adjusted
--   submission_accepted           sales                   AUTO request.bound
--   submission_declined           sales                   MANUAL - the only one
--   limit_review_due              credit_underwriter      AUTO lazily, when no longer near expiry
--   rating_stale                  credit_underwriter      AUTO rating.created / lazily
--
--   * band-aware: targeted at the individual underwriters whose credit
--     authority covers the amount when that is resolvable, else at the role.
--
--   submission_declined is manual because nothing downstream happens: the
--   client said no, and a human decides the file is closed. Every other type
--   has an objective signal, so none of them can linger.

-- ---------------------------------------------------------------------------
-- The events the mapping needs (3c-1 emitted none of these)
-- ---------------------------------------------------------------------------

create or replace function tci.submit_limit_request(p_request_id uuid)
returns tci.credit_limit_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request tci.credit_limit_requests%rowtype;
  v_policy_status tci.policy_status;
  v_request_status tci.insurance_request_status;
begin
  select * into v_request from tci.credit_limit_requests where id = p_request_id for update;
  if not found then
    raise exception 'limit request % not found or not accessible', p_request_id
      using errcode = 'P0002';
  end if;
  if v_request.status <> 'draft' then
    raise exception 'only draft requests can be submitted (current: %)', v_request.status
      using errcode = 'P0001';
  end if;

  if v_request.policy_id is not null then
    select status into v_policy_status from tci.policies where id = v_request.policy_id;
    if v_policy_status is distinct from 'active' then
      raise exception 'policy is not active (current: %) - limit requests bind to active policies',
        v_policy_status using errcode = 'P0001';
    end if;
  else
    select status into v_request_status
      from tci.insurance_requests where id = v_request.insurance_request_id;
    if v_request_status is null then
      raise exception 'limit request % belongs to no policy and no submission', p_request_id
        using errcode = 'P0001';
    end if;
    if v_request_status in ('declined', 'withdrawn', 'bound') then
      raise exception 'submission is % - it can no longer take limit requests', v_request_status
        using errcode = 'P0001';
    end if;
  end if;

  update tci.credit_limit_requests
     set status = 'submitted', submitted_at = now()
   where id = p_request_id
   returning * into v_request;

  -- NEW in 0024: the Agenda's signal that a decision is owed.
  perform tci.emit_workflow_event(
    'limit.request_submitted', 'credit_limit_request', p_request_id,
    jsonb_build_object(
      'entity_id', v_request.entity_id,
      'amount', v_request.requested_amount,
      'currency', v_request.currency_code),
    'credit_underwriter'::tci.user_role);

  return v_request;
end;
$$;

-- A buyer entering the package is an event 3c-1 described but never emitted:
-- the rows are inserted straight through RLS, so the trigger is where the
-- event has to live. SECURITY DEFINER because emit_workflow_event writes an
-- append-only log the inserting role does not own.
create function tci.emit_request_buyer_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform tci.emit_workflow_event(
    'request.buyer_added', 'insurance_request', new.request_id,
    jsonb_build_object(
      'buyer_row_id', new.id,
      'name', new.proposed_name,
      'entity_id', new.entity_id),
    'sales'::tci.user_role);
  return new;
end;
$$;

create trigger insurance_request_buyers_emit_event
  after insert on tci.insurance_request_buyers
  for each row execute function tci.emit_request_buyer_event();

-- A new assessment is the objective completion signal for the rating tasks.
create function tci.emit_assessment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform tci.emit_workflow_event(
    'rating.created', 'credit_assessment', new.id,
    jsonb_build_object(
      'entity_id', new.entity_id,
      'grade', new.rating_grade),
    'credit_underwriter'::tci.user_role);
  return new;
end;
$$;

create trigger credit_assessments_emit_event
  after insert on tci.credit_assessments
  for each row execute function tci.emit_assessment_event();

-- The escalation branch of decide_limit_request now says so on the stream.
-- Everything else in this function is the deployed body, unchanged; in
-- particular it still does NOT emit limit.credit_decided, which the
-- credit_limit_decisions_emit_event trigger owns.
create or replace function tci.decide_limit_request(
  p_request_id uuid,
  p_outcome tci.decision_outcome,
  p_amount numeric default null,
  p_currency character default null,
  p_valid_from date default current_date,
  p_valid_until date default null,
  p_conditions jsonb default '[]'::jsonb,
  p_comment text default null,
  p_assessment_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request  tci.credit_limit_requests%rowtype;
  v_currency char(3);
  v_decision tci.credit_limit_decisions%rowtype;
  v_band     tci.grade_band;
  v_amount_uzs numeric;
  v_authority_uzs numeric;
  v_condition jsonb;
begin
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
    raise exception 'only credit underwriting may decide' using errcode = 'P0004';
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
        update tci.credit_limit_requests set status = 'escalated' where id = p_request_id;

        -- NEW in 0024: the Agenda raises an urgent task for whoever can decide it.
        perform tci.emit_workflow_event(
          'limit.request_escalated', 'credit_limit_request', p_request_id,
          jsonb_build_object(
            'entity_id', v_request.entity_id,
            'amount', p_amount,
            'currency', v_currency,
            'grade_band', v_band,
            'amount_uzs', v_amount_uzs),
          'credit_underwriter'::tci.user_role);

        return jsonb_build_object(
          'result', 'escalated',
          'grade_band', v_band,
          'amount_uzs', v_amount_uzs,
          'authority_uzs', v_authority_uzs
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
    valid_from, valid_until, based_on_assessment_id, comment
  ) values (
    p_request_id, p_outcome, p_amount, v_currency,
    coalesce(p_valid_from, current_date), p_valid_until, p_assessment_id, p_comment
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
$$;

-- ---------------------------------------------------------------------------
-- tci.tasks
-- ---------------------------------------------------------------------------

create type tci.task_priority as enum ('normal', 'high', 'urgent');
create type tci.task_status   as enum ('open', 'done', 'cancelled');

-- An enum, not free text: the catalogue is contractual and the frontend
-- renders a title per type. A typo should fail at the database, and adding a
-- type should be a migration someone reviews.
create type tci.task_type as enum (
  'buyer_needs_entity',
  'buyer_needs_rating',
  'limit_needs_decision',
  'limit_escalated',
  'submission_commercial_review',
  'submission_sales_confirmation',
  'limit_held',
  'submission_accepted',
  'submission_declined',
  'limit_review_due',
  'rating_stale'
);

create table tci.tasks (
  id              uuid primary key default gen_random_uuid(),
  task_type       tci.task_type not null,
  object_type     text not null,
  object_id       uuid not null,
  -- i18n: the key and its parameters, never rendered text. The UI owns the
  -- wording in three languages; the database owns the fact.
  title_key       text not null,
  params          jsonb not null default '{}'::jsonb,
  target_role     tci.user_role,
  target_user     uuid references auth.users (id) on delete cascade,
  due_at          timestamptz,
  priority        tci.task_priority not null default 'normal',
  status          tci.task_status not null default 'open',
  completed_by    uuid references auth.users (id),
  completed_at    timestamptz,
  source_event_id uuid references tci.workflow_events (id),
  created_at      timestamptz not null default now(),

  constraint tasks_targeted check (target_role is not null or target_user is not null),
  constraint tasks_completion_recorded check (
    (status = 'open' and completed_at is null)
    or (status <> 'open' and completed_at is not null)
  )
);

comment on table tci.tasks is
  'The Agenda. Generated from tci.workflow_events and by tci.refresh_agenda(); never hand-maintained. title_key + params keep it translatable.';

create index tasks_open_for_role_idx on tci.tasks (target_role, status, due_at)
  where status = 'open';
create index tasks_open_for_user_idx on tci.tasks (target_user, status, due_at)
  where status = 'open';
create index tasks_object_idx on tci.tasks (object_type, object_id);

-- One OPEN task per (type, object, target). Generation is idempotent against
-- this: replaying an event cannot pile up duplicates.
create unique index tasks_open_uq
  on tci.tasks (task_type, object_id,
                coalesce(target_user, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'open';

-- ---------------------------------------------------------------------------
-- RLS: my roles, or me by name; admin sees everything
-- ---------------------------------------------------------------------------

alter table tci.tasks enable row level security;

create policy "tasks: read mine"
  on tci.tasks for select to authenticated
  using (
    target_user = (select auth.uid())
    or (target_role is not null and target_role in (select tci.current_user_roles()))
  );

create policy "tasks: admin reads all"
  on tci.tasks for select to authenticated
  using (tci.has_role('admin'));

-- Completing is the only write a person makes by hand, and only on a task
-- that is theirs. Generation happens in SECURITY DEFINER functions.
create policy "tasks: complete mine"
  on tci.tasks for update to authenticated
  using (
    target_user = (select auth.uid())
    or (target_role is not null and target_role in (select tci.current_user_roles()))
    or tci.has_role('admin')
  )
  with check (
    target_user = (select auth.uid())
    or (target_role is not null and target_role in (select tci.current_user_roles()))
    or tci.has_role('admin')
  );

grant select on tci.tasks to authenticated;
grant update (status, completed_by, completed_at) on tci.tasks to authenticated;
grant all on tci.tasks to service_role;

-- ---------------------------------------------------------------------------
-- Band-aware targeting
-- ---------------------------------------------------------------------------

-- The credit underwriters whose CURRENT authority for this band covers the
-- amount. SECURITY DEFINER because it reads every user's grants, which no
-- individual caller may do (authority_grants is "read own" + admin).
-- Returns no rows when the amount cannot be converted, and the caller then
-- falls back to targeting the role - a task nobody can act on is worse than
-- a task addressed to the department.
create function tci.underwriters_covering(
  p_band tci.grade_band, p_amount numeric, p_currency char(3)
)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.user_id
  from tci.authority_grants g
  join tci.user_roles ur on ur.user_id = g.user_id and ur.role = 'credit_underwriter'
  where g.applies_to = 'credit'
    and g.grade_band = p_band
    and g.valid_from <= current_date
    and (g.valid_to is null or g.valid_to >= current_date)
    and tci.latest_uzs_rate(p_currency) is not null
    and tci.latest_uzs_rate(g.currency_code) is not null
  group by g.user_id
  having max(g.max_amount * tci.latest_uzs_rate(g.currency_code))
         >= p_amount * tci.latest_uzs_rate(p_currency)
$$;

revoke execute on function tci.underwriters_covering(tci.grade_band, numeric, char)
  from public, anon;
grant execute on function tci.underwriters_covering(tci.grade_band, numeric, char)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Generating and closing
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER: a task is raised FOR another department, so generation
-- necessarily writes rows the actor could not write themselves.
create function tci.open_task(
  p_task_type   tci.task_type,
  p_object_type text,
  p_object_id   uuid,
  p_title_key   text,
  p_params      jsonb default '{}'::jsonb,
  p_target_role tci.user_role default null,
  p_target_user uuid default null,
  p_due_at      timestamptz default null,
  p_priority    tci.task_priority default 'normal',
  p_event_id    uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into tci.tasks (
    task_type, object_type, object_id, title_key, params,
    target_role, target_user, due_at, priority, source_event_id
  ) values (
    p_task_type, p_object_type, p_object_id, p_title_key, coalesce(p_params, '{}'::jsonb),
    p_target_role, p_target_user, p_due_at, p_priority, p_event_id
  )
  on conflict do nothing
$$;

-- Auto-completion. 'done' is for a condition that resolved itself;
-- 'cancelled' for one that stopped being relevant (the object moved on).
create function tci.close_tasks(
  p_task_types tci.task_type[],
  p_object_id  uuid,
  p_status     tci.task_status default 'done'
)
returns integer
language sql
security definer
set search_path = ''
as $$
  with closed as (
    update tci.tasks
       set status = p_status, completed_at = now()
     where object_id = p_object_id
       and task_type = any(p_task_types)
       and status = 'open'
     returning 1
  )
  select count(*)::int from closed
$$;

revoke execute on function tci.open_task(tci.task_type, text, uuid, text, jsonb,
  tci.user_role, uuid, timestamptz, tci.task_priority, uuid) from public, anon;
revoke execute on function tci.close_tasks(tci.task_type[], uuid, tci.task_status)
  from public, anon;
grant execute on function tci.open_task(tci.task_type, text, uuid, text, jsonb,
  tci.user_role, uuid, timestamptz, tci.task_priority, uuid) to authenticated, service_role;
grant execute on function tci.close_tasks(tci.task_type[], uuid, tci.task_status)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The mapping: one event in, zero or more tasks opened and closed
-- ---------------------------------------------------------------------------

create function tci.handle_workflow_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer     tci.insurance_request_buyers%rowtype;
  v_request   tci.insurance_requests%rowtype;
  v_decision  tci.credit_limit_decisions%rowtype;
  v_limit_req tci.credit_limit_requests%rowtype;
  v_entity_id uuid;
  v_targeted  boolean := false;
  v_user      uuid;
  v_band      tci.grade_band;
  v_due       timestamptz;
  v_from      text;
  v_to        text;
begin
  case new.event_type

  -- A buyer entered the package by name: somebody must identify the company.
  when 'request.buyer_added' then
    select * into v_buyer from tci.insurance_request_buyers
     where id = (new.payload->>'buyer_row_id')::uuid;
    if found and v_buyer.entity_id is null then
      select * into v_request from tci.insurance_requests where id = new.object_id;
      perform tci.open_task(
        'buyer_needs_entity', 'insurance_request', new.object_id,
        'agenda.tasks.buyer_needs_entity',
        -- request_number so the Agenda row reads as a whole sentence without
        -- a second lookup: information_manager may not see the submission.
        jsonb_build_object('buyer_row_id', v_buyer.id, 'name', v_buyer.proposed_name,
                           'request_number', v_request.request_number),
        'information_manager'::tci.user_role, null, null, 'high', new.id);
    end if;

  -- Identified: that task is done, and the buyer may now need a rating.
  when 'request.buyer_resolved' then
    perform tci.close_tasks(array['buyer_needs_entity']::tci.task_type[], new.object_id);
    v_entity_id := (new.payload->>'entity_id')::uuid;
    if v_entity_id is not null and not exists (
      select 1 from tci.credit_assessments a
       where a.entity_id = v_entity_id
         and a.created_at > now() - interval '12 months'
    ) then
      perform tci.open_task(
        'buyer_needs_rating', 'legal_entity', v_entity_id,
        'agenda.tasks.buyer_needs_rating',
        jsonb_build_object('entity_id', v_entity_id, 'request_id', new.object_id),
        'credit_underwriter'::tci.user_role, null, null, 'normal', new.id);
    end if;

  -- A rating arrived: both rating tasks for that company are answered.
  when 'rating.created' then
    v_entity_id := (new.payload->>'entity_id')::uuid;
    perform tci.close_tasks(
      array['buyer_needs_rating', 'rating_stale']::tci.task_type[], v_entity_id);

  -- A decision is owed. Band-aware: address the underwriters who can actually
  -- take it, and fall back to the department when that cannot be resolved.
  when 'limit.request_submitted', 'limit.request_escalated' then
    select * into v_limit_req from tci.credit_limit_requests where id = new.object_id;
    v_band := coalesce((new.payload->>'grade_band')::tci.grade_band, 'unrated');
    for v_user in
      select * from tci.underwriters_covering(
        v_band, v_limit_req.requested_amount, v_limit_req.currency_code)
    loop
      v_targeted := true;
      perform tci.open_task(
        case when new.event_type = 'limit.request_escalated'
             then 'limit_escalated' else 'limit_needs_decision' end::tci.task_type,
        'credit_limit_request', new.object_id,
        case when new.event_type = 'limit.request_escalated'
             then 'agenda.tasks.limit_escalated' else 'agenda.tasks.limit_needs_decision' end,
        new.payload, null, v_user, null,
        case when new.event_type = 'limit.request_escalated'
             then 'urgent' else 'normal' end::tci.task_priority, new.id);
    end loop;
    if not v_targeted then
      perform tci.open_task(
        case when new.event_type = 'limit.request_escalated'
             then 'limit_escalated' else 'limit_needs_decision' end::tci.task_type,
        'credit_limit_request', new.object_id,
        case when new.event_type = 'limit.request_escalated'
             then 'agenda.tasks.limit_escalated' else 'agenda.tasks.limit_needs_decision' end,
        new.payload, 'credit_underwriter'::tci.user_role, null, null,
        case when new.event_type = 'limit.request_escalated'
             then 'urgent' else 'normal' end::tci.task_priority, new.id);
    end if;

  -- Decided: every task on that request is answered, however it was targeted.
  when 'limit.credit_decided' then
    select * into v_decision from tci.credit_limit_decisions where id = new.object_id;
    if found then
      perform tci.close_tasks(
        array['limit_needs_decision', 'limit_escalated']::tci.task_type[],
        v_decision.request_id);
      -- A fresh decision also retires any review task on the superseded one.
      select * into v_limit_req from tci.credit_limit_requests where id = v_decision.request_id;
      perform tci.close_tasks(
        array['limit_review_due']::tci.task_type[], v_limit_req.entity_id, 'cancelled');
    end if;

  -- Sales put a decision on hold: the decider has to answer it.
  when 'limit.held' then
    select * into v_decision from tci.credit_limit_decisions where id = new.object_id;
    if found then
      perform tci.open_task(
        'limit_held', 'credit_limit_decision', new.object_id,
        'agenda.tasks.limit_held',
        -- request_id so the Agenda row can deep-link: a decision has no page
        -- of its own, its limit request does.
        jsonb_build_object('comment', new.payload->>'comment',
                           'request_id', v_decision.request_id),
        null, v_decision.decided_by, null, 'high', new.id);
    end if;

  -- Released or re-shaped: the hold is resolved either way.
  when 'limit.released', 'limit.commercial_adjusted' then
    perform tci.close_tasks(array['limit_held']::tci.task_type[], new.object_id);
    if new.event_type = 'limit.commercial_adjusted' then
      perform tci.close_tasks(
        array['limit_held']::tci.task_type[],
        (new.payload->>'credit_decision_id')::uuid);
    end if;

  -- The submission pipeline. Each stage closes the previous stage's task, so
  -- a task cannot survive the status that raised it.
  when 'request.status_changed' then
    v_from := new.payload->>'from';
    v_to   := new.payload->>'to';
    select * into v_request from tci.insurance_requests where id = new.object_id;

    if v_from = 'commercial_review' then
      perform tci.close_tasks(
        array['submission_commercial_review']::tci.task_type[], new.object_id);
    end if;
    if v_from = 'sales_confirmation' then
      perform tci.close_tasks(
        array['submission_sales_confirmation']::tci.task_type[], new.object_id);
    end if;

    if v_to = 'commercial_review' then
      perform tci.open_task(
        'submission_commercial_review', 'insurance_request', new.object_id,
        'agenda.tasks.submission_commercial_review',
        jsonb_build_object('request_number', v_request.request_number),
        'commercial_underwriter'::tci.user_role, null, null, 'normal', new.id);

    elsif v_to = 'sales_confirmation' then
      -- due_at is the silent-consent clock made visible: the EARLIEST moment
      -- one of the package's decisions reaches the client on its own.
      select min(d.decided_at) + make_interval(hours => tci.sales_window_hours())
        into v_due
        from tci.credit_limit_decisions d
        join tci.credit_limit_requests r on r.id = d.request_id
       where r.insurance_request_id = new.object_id
         and d.lifecycle = 'effective'
         and d.released_at is null
         and not d.held;
      perform tci.open_task(
        'submission_sales_confirmation', 'insurance_request', new.object_id,
        'agenda.tasks.submission_sales_confirmation',
        jsonb_build_object('request_number', v_request.request_number),
        'sales'::tci.user_role, null,
        coalesce(v_due, now() + make_interval(hours => tci.sales_window_hours())),
        'high', new.id);

    elsif v_to = 'accepted' then
      perform tci.open_task(
        'submission_accepted', 'insurance_request', new.object_id,
        'agenda.tasks.submission_accepted',
        jsonb_build_object('request_number', v_request.request_number),
        'sales'::tci.user_role, null, null, 'high', new.id);

    elsif v_to = 'declined' then
      -- The only manual one: nothing downstream happens, a human closes it.
      perform tci.open_task(
        'submission_declined', 'insurance_request', new.object_id,
        'agenda.tasks.submission_declined',
        jsonb_build_object('request_number', v_request.request_number,
                           'reason', new.payload->>'comment'),
        'sales'::tci.user_role, null, null, 'normal', new.id);

    elsif v_to = 'withdrawn' then
      -- Abandoned: nothing on it was achieved, so everything is cancelled.
      perform tci.close_tasks(
        array['submission_commercial_review', 'submission_sales_confirmation',
              'submission_accepted', 'buyer_needs_entity']::tci.task_type[],
        new.object_id, 'cancelled');

    elsif v_to = 'bound' then
      -- Off the board too, but not abandoned. Only the stage tasks are moot;
      -- submission_accepted was genuinely ANSWERED by the policy, and the
      -- request.bound arm below is what records it as done. Cancelling it here
      -- would beat that arm to the row and mislabel a completed task.
      perform tci.close_tasks(
        array['submission_commercial_review', 'submission_sales_confirmation',
              'buyer_needs_entity']::tci.task_type[],
        new.object_id, 'cancelled');
    end if;

  -- Bound: the accepted-submission task is answered by the policy existing.
  when 'request.bound' then
    perform tci.close_tasks(
      array['submission_accepted']::tci.task_type[], new.object_id);

  else
    null;  -- events with no Agenda meaning (request.created, request.assigned)
  end case;

  return new;
end;
$$;

create trigger workflow_events_to_tasks
  after insert on tci.workflow_events
  for each row execute function tci.handle_workflow_event();

comment on function tci.handle_workflow_event() is
  'The Agenda mapping: opens tasks for the department the ball moved to and closes the ones whose condition has resolved. SECURITY DEFINER because a task is raised FOR another department.';

-- ---------------------------------------------------------------------------
-- The two time-based kinds: generated and retired lazily, never by a cron
-- ---------------------------------------------------------------------------

-- Called by the Agenda screen on read. Idempotent: the partial unique index
-- absorbs repeats, and conditions that no longer hold are cancelled, so
-- calling it twice in a row is a no-op the second time.
--
-- SECURITY DEFINER for the same reason as the mapping - it raises tasks for
-- credit underwriting regardless of who opened the screen - and it is
-- restricted to staff below.
create function tci.refresh_agenda()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opened int := 0;
  v_row record;
begin
  if not tci.is_staff() then
    raise exception 'only staff have an agenda' using errcode = 'P0004';
  end if;

  -- (1) Effective limits expiring within 30 days need a review decision.
  for v_row in
    select v.entity_id, v.policy_id, v.valid_until, v.approved_amount, v.currency_code
    from tci.v_effective_limits v
    where v.valid_until is not null
      and v.valid_until <= current_date + 30
      and v.outcome in ('approved', 'partial')
  loop
    perform tci.open_task(
      'limit_review_due', 'legal_entity', v_row.entity_id,
      'agenda.tasks.limit_review_due',
      jsonb_build_object(
        'entity_id', v_row.entity_id,
        'policy_id', v_row.policy_id,
        'valid_until', v_row.valid_until,
        'amount', v_row.approved_amount,
        'currency', v_row.currency_code),
      'credit_underwriter'::tci.user_role, null,
      v_row.valid_until::timestamptz,
      case when v_row.valid_until <= current_date + 7 then 'high' else 'normal' end::tci.task_priority,
      null);
    v_opened := v_opened + 1;
  end loop;

  -- Retire review tasks whose limit is no longer near expiry (renewed, or the
  -- decision was superseded). This is what makes lazy generation safe to
  -- repeat: the set is recomputed, not accumulated.
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'limit_review_due'
     and t.status = 'open'
     and not exists (
       select 1 from tci.v_effective_limits v
        where v.entity_id = t.object_id
          and v.valid_until is not null
          and v.valid_until <= current_date + 30
          and v.outcome in ('approved', 'partial')
     );

  -- (2) A company carrying an effective limit on a rating older than a year.
  for v_row in
    select distinct v.entity_id
    from tci.v_effective_limits v
    where v.outcome in ('approved', 'partial')
      and not exists (
        select 1 from tci.credit_assessments a
         where a.entity_id = v.entity_id
           and a.created_at > now() - interval '12 months'
      )
  loop
    perform tci.open_task(
      'rating_stale', 'legal_entity', v_row.entity_id,
      'agenda.tasks.rating_stale',
      jsonb_build_object('entity_id', v_row.entity_id),
      'credit_underwriter'::tci.user_role, null, null, 'normal', null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'rating_stale'
     and t.status = 'open'
     and exists (
       select 1 from tci.credit_assessments a
        where a.entity_id = t.object_id
          and a.created_at > now() - interval '12 months'
     );

  return v_opened;
end;
$$;

revoke execute on function tci.refresh_agenda() from public, anon;
grant execute on function tci.refresh_agenda() to authenticated, service_role;

comment on function tci.refresh_agenda() is
  'Lazily generates and retires the two time-based task kinds (limit review due, stale rating). Called on read by the Agenda screen - there is no cron.';

-- ---------------------------------------------------------------------------
-- Completing by hand
-- ---------------------------------------------------------------------------

-- Only submission_declined has no objective completion signal, so only it may
-- be closed this way. Refusing the rest keeps the Agenda honest: if a task can
-- be ticked off while its object still needs work, the board stops meaning
-- anything.
create function tci.complete_task(p_task_id uuid)
returns tci.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare v_task tci.tasks%rowtype;
begin
  select * into v_task from tci.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task % not found or not yours', p_task_id using errcode = 'P0002';
  end if;
  if v_task.status <> 'open' then
    raise exception 'task is already %', v_task.status using errcode = 'P0001';
  end if;
  if v_task.task_type <> 'submission_declined' then
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

revoke execute on function tci.complete_task(uuid) from public, anon;
grant execute on function tci.complete_task(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_types int; v_open int;
begin
  select count(*) into v_types from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'tci' and t.typname = 'task_type';
  if v_types <> 11 then
    raise exception '0024: expected 11 task types, found %', v_types;
  end if;

  -- The table starts empty; nothing is backfilled from historical events on
  -- purpose - replaying months of stream would open tasks for work already done.
  select count(*) into v_open from tci.tasks;
  if v_open <> 0 then
    raise exception '0024: tasks table should start empty, found % row(s)', v_open;
  end if;

  raise notice '0024 assertions passed';
end $$;
