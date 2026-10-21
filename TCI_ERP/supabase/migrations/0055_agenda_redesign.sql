-- What: the Agenda becomes a place to work a queue, not only to read it.
--         * tci.tasks.snoozed_until / snoozed_by, and tci.snooze_task /
--           tci.unsnooze_task: put a task out of sight until a moment, after
--           which it comes back by itself (no cron — the time just passes)
--         * tci.task_comments + tci.add_task_comment: an append-only thread
--           on a task, readable by whoever can see the task; a comment emits
--           task.commented so its owner sees it
--         * a new lazily generated task type, rating_new_statements: a buyer
--           with live credit business whose latest statements cover a LATER
--           period than the ones its rating was calculated on
--         * tci.handle_agenda_extras, a FIFTH trigger on tci.workflow_events:
--           it records on an escalation task WHO escalated and their band
--           authority at that moment (the payload never carried it), opens
--           limit_escalated for a group-limit breach (that escalation opened
--           no task at all, so the request waited in `escalated` unseen), and
--           retires rating_new_statements as soon as the new period is rated
-- Why:  Prompt 22 (Agenda redesign): snooze, comments and the system note of
--       an automatic task need data the database did not keep. And the audit
--       of this phase found that tci.tasks was writable around its functions:
--       the column grant of 0024 (status, completed_by, completed_at) let a
--       direct REST PATCH close ANY automatic task, reopen a closed one, or
--       record someone else as having completed it — complete_task's guard
--       never ran. 0047's assertion read role_table_grants, which does not
--       list column grants, so it missed it. The grant is revoked here and
--       every write on a task goes through a gated function.
--
-- SNOOZE IS PER TASK, not per person. A task addressed to a department is
-- one piece of work; whoever snoozes it puts it aside for the department,
-- and snoozed_by says who. Snoozed tasks stay `open`: they are excluded from
-- the lists, the counts and the sidebar badge by the reader until
-- snoozed_until passes, and every generator and closer treats them exactly
-- as before.
--
-- COMMENTS NEVER CHANGE. No UPDATE or DELETE grant, and a trigger refuses
-- either from anyone; a correction is a new comment. A comment does not copy
-- the text that already lives on the task's object (a request's
-- justification, a hold comment, a dispute note): the screen shows those
-- from where they are.
--
-- RENDERED TEXT NEVER REACHES THE DATABASE. The system note of an automatic
-- task is rendered by the UI from task_type + params (+ the source event);
-- this migration only adds params.

-- ---------------------------------------------------------------------------
-- 1. The new task type
-- ---------------------------------------------------------------------------
--   rating_new_statements  credit_underwriter  normal (high with limits in
--                          force)  due: 7 days after the Agenda first sees
--                          it (never before the statements were added)
--                          AUTO: lazily, and at once on rating.created once
--                          the latest period is rated

alter type tci.task_type add value 'rating_new_statements';

-- ---------------------------------------------------------------------------
-- 2. Snooze
-- ---------------------------------------------------------------------------

alter table tci.tasks
  add column snoozed_until timestamptz,
  add column snoozed_by    uuid references auth.users (id) on delete set null;

comment on column tci.tasks.snoozed_until is
  'Out of sight until this moment (0055). The task stays open; readers exclude it from lists, counts and badges while snoozed_until > now(). Per task, not per person.';
comment on column tci.tasks.snoozed_by is
  'Who snoozed it last (0055).';

-- Whose task is it: the same predicate as the tasks read policies of 0024
-- ("read mine" + "admin reads all"). SECURITY INVOKER: it reads nothing.
create function tci.task_is_mine(p_target_role tci.user_role, p_target_user uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_target_user = (select auth.uid())
      or (p_target_role is not null and p_target_role in (select tci.current_user_roles()))
      or tci.has_role('admin')
$$;

comment on function tci.task_is_mine(tci.user_role, uuid) is
  'True when the caller may see a task with this target: it is addressed to them, to a role they hold, or they are admin. Mirrors the tasks read policies (0024).';

-- ---------------------------------------------------------------------------
-- 3. Direct writes on tci.tasks closed
-- ---------------------------------------------------------------------------
-- 0024 granted UPDATE (status, completed_by, completed_at) so that
-- complete_task could run as the caller. That grant is what a direct PATCH
-- used. complete_task becomes SECURITY DEFINER with a staff gate and an
-- explicit "is it mine" check, and the grant and its policy go.

revoke update (status, completed_by, completed_at) on tci.tasks from authenticated;
revoke insert, update, delete on tci.tasks from authenticated, anon;
drop policy "tasks: complete mine" on tci.tasks;

-- SECURITY DEFINER: the caller holds no write grant on tci.tasks any more.
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
      'entity_request_resolved') then
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

-- SECURITY DEFINER for the same reason as complete_task.
create function tci.snooze_task(p_task_id uuid, p_until timestamptz)
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
  if p_until is null or p_until <= now() then
    raise exception 'snooze_in_past' using errcode = 'P0001';
  end if;
  if p_until > now() + interval '1 year' then
    raise exception 'snooze_too_far' using errcode = 'P0001';
  end if;

  update tci.tasks
     set snoozed_until = p_until, snoozed_by = (select auth.uid())
   where id = p_task_id
   returning * into v_task;

  perform tci.begin_trusted_call();
  perform tci.emit_workflow_event(
    'task.snoozed', 'task', p_task_id,
    jsonb_build_object('task_type', v_task.task_type, 'until', p_until),
    v_task.target_role, v_task.target_user);
  return v_task;
end;
$$;

create function tci.unsnooze_task(p_task_id uuid)
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
  if v_task.snoozed_until is null then
    return v_task;
  end if;

  update tci.tasks
     set snoozed_until = null, snoozed_by = null
   where id = p_task_id
   returning * into v_task;

  perform tci.begin_trusted_call();
  perform tci.emit_workflow_event(
    'task.unsnoozed', 'task', p_task_id,
    jsonb_build_object('task_type', v_task.task_type),
    v_task.target_role, v_task.target_user);
  return v_task;
end;
$$;

comment on function tci.snooze_task(uuid, timestamptz) is
  'Puts an open task of the caller''s out of sight until p_until (future, at most a year ahead). Staff only; emits task.snoozed.';
comment on function tci.unsnooze_task(uuid) is
  'Brings a snoozed task back now. Staff only; emits task.unsnoozed.';

-- ---------------------------------------------------------------------------
-- 4. Task comments
-- ---------------------------------------------------------------------------

create table tci.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tci.tasks (id) on delete cascade,
  author_id  uuid not null references auth.users (id) default auth.uid(),
  body       text not null,
  created_at timestamptz not null default now(),

  constraint task_comments_body_length check (char_length(btrim(body)) between 1 and 2000)
);

comment on table tci.task_comments is
  'Comments on an Agenda task (0055). Append-only: written by tci.add_task_comment, never updated or deleted. Readable by staff who can see the task.';

create index task_comments_task_idx on tci.task_comments (task_id, created_at);

alter table tci.task_comments enable row level security;

-- Whoever can see the task: the subquery runs under tci.tasks' own RLS.
create policy "task_comments: staff who see the task"
  on tci.task_comments for select to authenticated
  using (tci.is_staff() and exists (select 1 from tci.tasks t where t.id = task_id));

grant select on tci.task_comments to authenticated;
grant all on tci.task_comments to service_role;

-- History is immutable: no correction in place, by anyone.
create function tci.task_comments_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'task comments are append-only' using errcode = '42501';
end;
$$;

create trigger task_comments_immutable
  before update or delete on tci.task_comments
  for each row execute function tci.task_comments_immutable();

-- SECURITY DEFINER: authenticated holds no INSERT on the table, so a comment
-- always comes with its event.
create function tci.add_task_comment(p_task_id uuid, p_body text)
returns tci.task_comments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task    tci.tasks%rowtype;
  v_comment tci.task_comments%rowtype;
begin
  perform tci.require_staff();

  select * into v_task from tci.tasks t
   where t.id = p_task_id and tci.task_is_mine(t.target_role, t.target_user);
  if not found then
    raise exception 'task % not found or not yours', p_task_id using errcode = 'P0002';
  end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then
    raise exception 'comment_empty' using errcode = 'P0001';
  end if;
  if char_length(btrim(p_body)) > 2000 then
    raise exception 'comment_too_long' using errcode = 'P0001';
  end if;

  insert into tci.task_comments (task_id, author_id, body)
  values (p_task_id, (select auth.uid()), btrim(p_body))
  returning * into v_comment;

  perform tci.begin_trusted_call();
  perform tci.emit_workflow_event(
    'task.commented', 'task', p_task_id,
    jsonb_build_object(
      'comment_id', v_comment.id,
      'task_type', v_task.task_type,
      'object_type', v_task.object_type,
      'object_id', v_task.object_id),
    v_task.target_role, v_task.target_user);
  return v_comment;
end;
$$;

comment on function tci.add_task_comment(uuid, text) is
  'Adds a comment (1-2000 characters) to a task the caller can see. Staff only; emits task.commented addressed to the task''s owner.';

-- ---------------------------------------------------------------------------
-- 5. refresh_agenda: the 0043 text, plus section (9)
-- ---------------------------------------------------------------------------
-- Sections (1)-(8) are unchanged from 0043. (9) opens rating_new_statements
-- from tci.v_rating_worklist (0053), which already decides what "a later
-- period than the rated one" means, and retires it when that stops holding.

create or replace function tci.refresh_agenda()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_opened int := 0;
  v_row record;
  v_client uuid;
begin
  perform tci.begin_trusted_call();
  if not tci.is_staff() then
    raise exception 'only staff have an agenda' using errcode = '42501';
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

  -- (3) NEW: the declaration period that has CLOSED and has not been declared.
  -- Keyed on the policy, not on a declaration row, because the whole point is
  -- that the declaration does not exist yet.
  for v_row in
    select p.id as policy_id,
           p.policy_number,
           p.declaration_frequency,
           tci.declaration_period_start(
             (tci.declaration_period_start(current_date, p.declaration_frequency)
              - interval '1 day')::date,
             p.declaration_frequency) as period_start
    from tci.policies p
    where p.status = 'active'
      -- Only chase a period the policy was actually live for: a policy
      -- incepted this month owes nothing for last month.
      and tci.declaration_period_start(
            (tci.declaration_period_start(current_date, p.declaration_frequency)
             - interval '1 day')::date,
            p.declaration_frequency)
          >= tci.declaration_period_start(p.inception_date, p.declaration_frequency)
  loop
    if not exists (
      select 1 from tci.declarations d
       where d.policy_id = v_row.policy_id
         and d.period_start = v_row.period_start
         and d.status <> 'corrected'
    ) then
      perform tci.open_task(
        case when current_date
                  > tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30
             then 'declaration_overdue' else 'declaration_due' end::tci.task_type,
        'policy', v_row.policy_id,
        case when current_date
                  > tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30
             then 'agenda.tasks.declaration_overdue' else 'agenda.tasks.declaration_due' end,
        jsonb_build_object(
          'policy_id', v_row.policy_id,
          'policy_number', v_row.policy_number,
          'period_start', v_row.period_start,
          'period_end', tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency)),
        'sales'::tci.user_role, null,
        (tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30)::timestamptz,
        case when current_date
                  > tci.declaration_period_end(v_row.period_start, v_row.declaration_frequency) + 30
             then 'high' else 'normal' end::tci.task_priority,
        null);
      v_opened := v_opened + 1;
    end if;
  end loop;

  -- Retire chasing tasks once the period HAS been declared, or the policy
  -- stopped being active.
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type in ('declaration_due', 'declaration_overdue')
     and t.status = 'open'
     and (
       exists (
         select 1 from tci.declarations d
          where d.policy_id = t.object_id
            and d.period_start = (t.params->>'period_start')::date
            and d.status <> 'corrected'
       )
       or not exists (
         select 1 from tci.policies p where p.id = t.object_id and p.status = 'active'
       )
     );

  -- (4) NEW: instalments falling due, and instalments already past due.
  for v_row in
    select pi.id, pi.policy_id, pi.sequence, pi.due_date, pi.amount, p.policy_number,
           p.currency_code
    from tci.premium_instalments pi
    join tci.policies p on p.id = pi.policy_id
    where pi.status in ('pending', 'invoiced')
      and pi.due_date <= current_date + 14
  loop
    perform tci.open_task(
      case when v_row.due_date < current_date
           then 'instalment_overdue' else 'instalment_due' end::tci.task_type,
      'premium_instalment', v_row.id,
      case when v_row.due_date < current_date
           then 'agenda.tasks.instalment_overdue' else 'agenda.tasks.instalment_due' end,
      jsonb_build_object(
        'policy_id', v_row.policy_id,
        'policy_number', v_row.policy_number,
        'sequence', v_row.sequence,
        'due_date', v_row.due_date,
        'amount', v_row.amount,
        'currency', v_row.currency_code),
      'commercial_underwriter'::tci.user_role, null,
      v_row.due_date::timestamptz,
      case when v_row.due_date < current_date then 'high' else 'normal' end::tci.task_priority,
      null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type in ('instalment_due', 'instalment_overdue')
     and t.status = 'open'
     and not exists (
       select 1 from tci.premium_instalments pi
        where pi.id = t.object_id
          and pi.status in ('pending', 'invoiced')
          and pi.due_date <= current_date + 14
     );

  -- (5) NEW: an open overdue notification whose waiting period has run. The
  -- debt is now claimable, so the policyholder is told they may file and
  -- claims is told to expect it. Neither is a claim: only the policyholder
  -- decides that a debt is a loss.
  for v_row in
    select n.id, n.policy_id, n.entity_id, n.first_due_date, n.overdue_amount,
           n.currency_code, p.policy_number, p.waiting_period_days,
           (n.first_due_date + p.waiting_period_days) as claimable_from
    from tci.overdue_notifications n
    join tci.policies p on p.id = n.policy_id
    where n.status = 'open'
      and current_date >= n.first_due_date + p.waiting_period_days
      and not exists (
        select 1 from tci.claims c
         where c.overdue_notification_id = n.id and c.status <> 'withdrawn')
  loop
    perform tci.open_task(
      'noa_matured_to_claim', 'overdue_notification', v_row.id,
      'agenda.tasks.noa_matured_to_claim',
      jsonb_build_object(
        'noa_id', v_row.id,
        'policy_id', v_row.policy_id,
        'policy_number', v_row.policy_number,
        'entity_id', v_row.entity_id,
        'amount', v_row.overdue_amount,
        'currency', v_row.currency_code,
        'claimable_from', v_row.claimable_from),
      'claims'::tci.user_role, null, v_row.claimable_from::timestamptz, 'normal', null);
    v_opened := v_opened + 1;

    -- Addressed to the individual portal users, never to the client role:
    -- every policyholder holds that role, so a role-targeted task would show
    -- them each other's files.
    for v_client in select tci.policyholder_user_ids(v_row.policy_id) loop
      perform tci.open_task(
        'claim_ready_to_file', 'overdue_notification', v_row.id,
        'agenda.tasks.claim_ready_to_file',
        jsonb_build_object(
          'noa_id', v_row.id,
          'policy_id', v_row.policy_id,
          'policy_number', v_row.policy_number,
          'entity_id', v_row.entity_id,
          'amount', v_row.overdue_amount,
          'currency', v_row.currency_code,
          'claimable_from', v_row.claimable_from),
        null, v_client, v_row.claimable_from::timestamptz, 'normal', null);
      v_opened := v_opened + 1;
    end loop;
  end loop;

  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type in ('noa_matured_to_claim', 'claim_ready_to_file')
     and t.status = 'open'
     and not exists (
       select 1 from tci.overdue_notifications n
        where n.id = t.object_id
          and n.status = 'open'
          and not exists (
            select 1 from tci.claims c
             where c.overdue_notification_id = n.id and c.status <> 'withdrawn')
     );

  -- (6) NEW: retire the reinstatement review once the buyer holds a live limit
  -- again, or the claim file is closed. The credit underwriter's decision IS
  -- the completion signal, so this type needs no button either.
  update tci.tasks t
     set status = 'done', completed_at = now()
   where t.task_type = 'claim_limit_reinstatement'
     and t.status = 'open'
     and exists (
       select 1 from tci.claims c
        join tci.v_effective_limits v
          on v.policy_id = c.policy_id and v.entity_id = c.entity_id
       where c.id = t.object_id
         and v.outcome in ('approved', 'partial')
     );
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type = 'claim_limit_reinstatement'
     and t.status = 'open'
     and exists (
       select 1 from tci.claims c
        where c.id = t.object_id and c.status in ('closed', 'withdrawn')
     );

  -- (7) NEW (Phase 6): a group whose exposure has crossed the warning share of
  -- its group limit. Keyed on the ULTIMATE PARENT, which is the group's
  -- identity - there is no group record to key on.
  for v_row in
    select ge.ultimate_parent_id, ge.ultimate_parent_name, ge.exposure_uzs,
           gl.max_amount, gl.currency_code,
           tci.to_uzs(gl.max_amount, gl.currency_code) as limit_uzs
      from tci.v_group_exposure ge
      join tci.group_limits gl
        on gl.ultimate_parent_entity_id = ge.ultimate_parent_id
       and gl.valid_from <= current_date
       and (gl.valid_to is null or gl.valid_to >= current_date)
     where tci.to_uzs(gl.max_amount, gl.currency_code) > 0
       and ge.exposure_uzs
           >= tci.to_uzs(gl.max_amount, gl.currency_code) * tci.group_exposure_warn_pct() / 100
  loop
    perform tci.open_task(
      'group_exposure_near_limit', 'legal_entity', v_row.ultimate_parent_id,
      'agenda.tasks.group_exposure_near_limit',
      jsonb_build_object(
        'entity_id', v_row.ultimate_parent_id,
        'group_name', v_row.ultimate_parent_name,
        'exposure_uzs', v_row.exposure_uzs,
        'limit_uzs', v_row.limit_uzs,
        'utilisation_pct', round(v_row.exposure_uzs * 100 / v_row.limit_uzs, 1)),
      'credit_underwriter'::tci.user_role, null, null, 'high', null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'done', completed_at = now()
   where t.task_type = 'group_exposure_near_limit'
     and t.status = 'open'
     and not exists (
       select 1 from tci.v_group_exposure ge
        join tci.group_limits gl
          on gl.ultimate_parent_entity_id = ge.ultimate_parent_id
         and gl.valid_from <= current_date
         and (gl.valid_to is null or gl.valid_to >= current_date)
       where ge.ultimate_parent_id = t.object_id
         and tci.to_uzs(gl.max_amount, gl.currency_code) > 0
         and ge.exposure_uzs
             >= tci.to_uzs(gl.max_amount, gl.currency_code) * tci.group_exposure_warn_pct() / 100
     );

  -- (8) NEW (Phase 6): a group carrying limits with NO group limit set. Not an
  -- error - most single-company "groups" never need one - so it is only raised
  -- where the group actually has more than one member.
  for v_row in
    select ge.ultimate_parent_id, ge.ultimate_parent_name, ge.exposure_uzs,
           ge.members_with_limits
      from tci.v_group_exposure ge
     where ge.members_with_limits > 1
       and not exists (
         select 1 from tci.group_limits gl
          where gl.ultimate_parent_entity_id = ge.ultimate_parent_id
            and gl.valid_from <= current_date
            and (gl.valid_to is null or gl.valid_to >= current_date))
  loop
    perform tci.open_task(
      'group_limit_missing', 'legal_entity', v_row.ultimate_parent_id,
      'agenda.tasks.group_limit_missing',
      jsonb_build_object(
        'entity_id', v_row.ultimate_parent_id,
        'group_name', v_row.ultimate_parent_name,
        'members_with_limits', v_row.members_with_limits,
        'exposure_uzs', v_row.exposure_uzs),
      'credit_underwriter'::tci.user_role, null, null, 'normal', null);
    v_opened := v_opened + 1;
  end loop;

  update tci.tasks t
     set status = 'done', completed_at = now()
   where t.task_type = 'group_limit_missing'
     and t.status = 'open'
     and (
       exists (
         select 1 from tci.group_limits gl
          where gl.ultimate_parent_entity_id = t.object_id
            and gl.valid_from <= current_date
            and (gl.valid_to is null or gl.valid_to >= current_date))
       or not exists (
         select 1 from tci.v_group_exposure ge
          where ge.ultimate_parent_id = t.object_id and ge.members_with_limits > 1)
     );

  -- (9) 0055: new statements since the rating. A buyer with live credit
  -- business whose latest statements cover a LATER period than the ones its
  -- current rating was calculated on: the rating is a period behind. The
  -- params carry what the system note says — which statements, who added
  -- them and when, and what the current rating rests on.
  for v_row in
    select w.entity_id, w.assessment_id, w.grade, w.rated_at, w.rated_period_end,
           w.limits_in_force, ca.rating_score,
           fs.id as statement_id, fs.statement_kind, fs.fiscal_year, fs.fiscal_quarter,
           fs.period_end_date, fs.report_type, fs.created_by, fs.created_at
      from tci.v_rating_worklist w
      left join tci.credit_assessments ca on ca.id = w.assessment_id
      join lateral (
        select s.* from tci.financial_statements s
         where s.entity_id = w.entity_id
         order by s.period_end_date desc, s.created_at desc
         limit 1
      ) fs on true
     where w.reason = 'new_statement'
  loop
    perform tci.open_task(
      'rating_new_statements', 'legal_entity', v_row.entity_id,
      'agenda.tasks.rating_new_statements',
      jsonb_build_object(
        'entity_id', v_row.entity_id,
        'statement_id', v_row.statement_id,
        'statement_kind', v_row.statement_kind,
        'fiscal_year', v_row.fiscal_year,
        'fiscal_quarter', v_row.fiscal_quarter,
        'period_end', v_row.period_end_date,
        'report_type', v_row.report_type,
        'added_by', v_row.created_by,
        'added_at', v_row.created_at,
        'assessment_id', v_row.assessment_id,
        'grade', v_row.grade,
        'score', v_row.rating_score,
        'rated_at', v_row.rated_at,
        'rated_period_end', v_row.rated_period_end,
        'limits_in_force', v_row.limits_in_force),
      'credit_underwriter'::tci.user_role, null,
      -- The clock starts when the Agenda first sees the work, not when the
      -- statements were typed in: a backlog must not arrive months overdue.
      greatest(v_row.created_at, now()) + interval '7 days',
      case when v_row.limits_in_force > 0 then 'high' else 'normal' end::tci.task_priority,
      null);
    v_opened := v_opened + 1;
  end loop;

  -- Rated since (done), or no longer live business / statements removed
  -- (cancelled).
  update tci.tasks t
     set status = case when exists (
                          select 1 from tci.credit_assessments a
                           where a.entity_id = t.object_id and a.created_at >= t.created_at)
                       then 'done' else 'cancelled' end::tci.task_status,
         completed_at = now()
   where t.task_type = 'rating_new_statements'
     and t.status = 'open'
     and not exists (
       select 1 from tci.v_rating_worklist w
        where w.entity_id = t.object_id and w.reason = 'new_statement');

  return v_opened;
end;
$function$;


-- ---------------------------------------------------------------------------
-- 6. The fifth trigger on tci.workflow_events
-- ---------------------------------------------------------------------------
-- Named so that it sorts AFTER workflow_events_to_tasks (triggers of one
-- event fire in name order): the escalation task it annotates already exists.

create function tci.handle_agenda_extras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_band tci.grade_band;
begin
  if new.event_type not in ('limit.request_escalated', 'limit.group_limit_breached', 'rating.created') then
    return null;
  end if;
  perform tci.begin_trusted_call();

  if new.event_type = 'limit.request_escalated' then
    -- Who escalated, and the band authority they held at that moment. The
    -- event is emitted inside the escalating person's own transaction, so
    -- my_authority_uzs answers for them; anything else records no figure.
    v_band := coalesce((new.payload->>'grade_band')::tci.grade_band, 'unrated');
    update tci.tasks t
       set params = t.params || jsonb_build_object(
             'escalated_by', new.actor,
             'authority_uzs',
             case when new.actor is not null and new.actor = (select auth.uid())
                  then tci.my_authority_uzs(v_band) end)
     where t.task_type = 'limit_escalated'
       and t.object_id = new.object_id
       and t.status = 'open';

  elsif new.event_type = 'limit.group_limit_breached' then
    -- decide_limit_request escalates on a group breach exactly as on a
    -- personal one, but no mapping opened a task for it: the request sat in
    -- `escalated` with nobody told. The department is told now.
    perform tci.open_task(
      'limit_escalated', 'credit_limit_request', new.object_id,
      'agenda.tasks.limit_escalated',
      new.payload || jsonb_build_object('reason', 'group_limit', 'escalated_by', new.actor),
      'credit_underwriter'::tci.user_role, null, null, 'urgent', new.id);

  elsif new.event_type = 'rating.created' then
    -- The new period is rated: the review is done now, not at the next read.
    update tci.tasks t
       set status = 'done', completed_at = now()
     where t.task_type = 'rating_new_statements'
       and t.status = 'open'
       and t.object_id = (new.payload->>'entity_id')::uuid
       and not exists (
         select 1 from tci.v_rating_worklist w
          where w.entity_id = t.object_id and w.reason = 'new_statement');
  end if;
  return null;
end;
$$;

create trigger workflow_events_to_tasks_extras
  after insert on tci.workflow_events
  for each row execute function tci.handle_agenda_extras();

comment on function tci.handle_agenda_extras() is
  'Agenda mapping added in 0055: annotates limit_escalated with who escalated and their band authority, opens limit_escalated on limit.group_limit_breached, and retires rating_new_statements on rating.created.';

-- ---------------------------------------------------------------------------
-- 7. Grants: every new function revokes PUBLIC and anon explicitly
-- ---------------------------------------------------------------------------

revoke all on function tci.task_is_mine(tci.user_role, uuid) from public, anon;
revoke all on function tci.complete_task(uuid) from public, anon;
revoke all on function tci.snooze_task(uuid, timestamptz) from public, anon;
revoke all on function tci.unsnooze_task(uuid) from public, anon;
revoke all on function tci.add_task_comment(uuid, text) from public, anon;
revoke all on function tci.task_comments_immutable() from public, anon, authenticated;
revoke all on function tci.handle_agenda_extras() from public, anon, authenticated;

grant execute on function tci.task_is_mine(tci.user_role, uuid) to authenticated, service_role;
grant execute on function tci.complete_task(uuid) to authenticated, service_role;
grant execute on function tci.snooze_task(uuid, timestamptz) to authenticated, service_role;
grant execute on function tci.unsnooze_task(uuid) to authenticated, service_role;
grant execute on function tci.add_task_comment(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_bad text;
begin
  -- no API role can write a task row directly, on any column
  if has_any_column_privilege('authenticated', 'tci.tasks', 'UPDATE')
     or has_any_column_privilege('authenticated', 'tci.tasks', 'INSERT')
     or has_table_privilege('authenticated', 'tci.tasks', 'DELETE')
     or has_any_column_privilege('anon', 'tci.tasks', 'UPDATE') then
    raise exception '0055: tci.tasks must be written only through its functions';
  end if;

  -- comments: read-only to the API, append-only to everyone
  if has_any_column_privilege('authenticated', 'tci.task_comments', 'INSERT')
     or has_any_column_privilege('authenticated', 'tci.task_comments', 'UPDATE')
     or has_table_privilege('authenticated', 'tci.task_comments', 'DELETE')
     or has_table_privilege('anon', 'tci.task_comments', 'SELECT') then
    raise exception '0055: tci.task_comments must be written only by add_task_comment';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'task_comments_immutable'
                  and tgrelid = 'tci.task_comments'::regclass) then
    raise exception '0055: task_comments lost its immutability trigger';
  end if;

  -- every new definer function executable by authenticated opens with a gate
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace and p.prosecdef
     and p.proname in ('complete_task', 'snooze_task', 'unsnooze_task', 'add_task_comment')
     and p.prosrc !~ 'perform tci\.require_staff\(\)';
  if v_bad is not null then
    raise exception '0055: ungated: %', v_bad;
  end if;

  -- nothing new is executable by anon
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace
     and p.proname in ('task_is_mine', 'complete_task', 'snooze_task', 'unsnooze_task',
                       'add_task_comment', 'task_comments_immutable', 'handle_agenda_extras')
     and has_function_privilege('anon', p.oid, 'execute');
  if v_bad is not null then
    raise exception '0055: anon can execute %', v_bad;
  end if;

  -- complete_task still accepts exactly the four manual types
  if position('''entity_request_resolved''' in pg_get_functiondef('tci.complete_task(uuid)'::regprocedure)) = 0
     or position('''submission_declined''' in pg_get_functiondef('tci.complete_task(uuid)'::regprocedure)) = 0 then
    raise exception '0055: complete_task lost a manual type';
  end if;

  -- refresh_agenda kept the 12-month rating_stale threshold (0053) and gained (9)
  if position('interval ''12 months''' in pg_get_functiondef('tci.refresh_agenda()'::regprocedure)) = 0
     or position('rating_new_statements' in pg_get_functiondef('tci.refresh_agenda()'::regprocedure)) = 0 then
    raise exception '0055: refresh_agenda is not the 0055 text';
  end if;

  -- the extras trigger fires after the 0024 mapping (name order)
  if not exists (select 1 from pg_trigger where tgname = 'workflow_events_to_tasks_extras'
                  and tgrelid = 'tci.workflow_events'::regclass)
     or 'workflow_events_to_tasks_extras' collate "C" <= 'workflow_events_to_tasks' collate "C" then
    raise exception '0055: the extras trigger must sort after workflow_events_to_tasks';
  end if;
end;
$$;
