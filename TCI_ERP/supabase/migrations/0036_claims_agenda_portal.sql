-- What: the Phase 5 Agenda and the claims side of the client portal - seven new
--       task types, a THIRD workflow-event mapping, the lazy "this NOA is ripe
--       for a claim" generation, the shared invoice entry points, and the
--       tci.v_client_claim* surface with its client_* write functions.
-- Why:  Phase 5. Four decisions worth stating outright:
--
--   * A CLIENT TASK IS ADDRESSED TO A PERSON, NEVER TO THE ROLE. The tasks RLS
--     lets anyone holding a role read every task targeted at that role - which
--     is right for a department and catastrophic for `client`, where it would
--     show every policyholder every other policyholder's file. The two
--     client-facing types therefore target the individual users mapped to the
--     policyholder in tci.policyholder_users. No mapped users, no task.
--   * THE WAITING PERIOD RIPENS LAZILY. Nothing polls. tci.refresh_agenda
--     opens "this overdue account can now be claimed" when the policy's waiting
--     period has run on an open NOA, and retires it when a claim exists or the
--     NOA closes. As everywhere else the set is recomputed, so calling it
--     twice changes nothing.
--   * A THIRD TRIGGER, NOT A REWRITE. tci.handle_workflow_event (0024) and
--     tci.handle_phase4_event (0029) stay untouched; claims get their own
--     AFTER INSERT mapping on the same append-only stream. Rewriting a
--     200-line mapping to add seven types is how drift starts.
--   * CLIENT VIEWS READ BASE TABLES OR SECURITY DEFINER FUNCTIONS, NEVER AN
--     INVOKER VIEW. That is the 0029 -> 0030 lesson: security_invoker
--     propagates, and a definer view selecting from an invoker view runs the
--     inner permission checks as the session user, silently returning nothing.

-- The seven new task types:
--
--   noa_matured_to_claim             claims                  normal  AUTO lazily, once a claim exists or the NOA closes
--   claim_ready_to_file              the policyholder's users normal AUTO same signal, addressed by name
--   claim_submitted                  claims                  high    AUTO claim.status_changed away from submitted
--   claim_info_requested             the policyholder's users high   AUTO claim.status_changed away from info_requested
--   claim_awaiting_payment           claims                  high    AUTO claim.status_changed to paid
--   claim_limit_reinstatement        credit_underwriter      normal  AUTO lazily, once the buyer holds a live limit again
--   claim_declined_review            sales                   normal  MANUAL - the third one a human closes
--
-- claim_declined_review is MANUAL for the same reason as submission_declined:
-- once the insurer refuses, nothing downstream happens on its own. Someone has
-- to talk to the policyholder and then decide the file is closed.

-- ---------------------------------------------------------------------------
-- 1. New task types
-- ---------------------------------------------------------------------------

alter type tci.task_type add value 'noa_matured_to_claim';
alter type tci.task_type add value 'claim_ready_to_file';
alter type tci.task_type add value 'claim_submitted';
alter type tci.task_type add value 'claim_info_requested';
alter type tci.task_type add value 'claim_awaiting_payment';
alter type tci.task_type add value 'claim_limit_reinstatement';
alter type tci.task_type add value 'claim_declined_review';

-- ---------------------------------------------------------------------------
-- 2. Who to tell on the client side
-- ---------------------------------------------------------------------------

create function tci.policyholder_user_ids(p_policy_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pu.user_id
    from tci.policyholder_users pu
    join tci.policies p on p.entity_id = pu.entity_id
   where p.id = p_policy_id
$$;

comment on function tci.policyholder_user_ids(uuid) is
  'The portal users of the policyholder behind a policy. Client-facing tasks are addressed to these people individually - never to the client ROLE, which every policyholder shares.';

-- ---------------------------------------------------------------------------
-- 3. The Phase 5 event mapping
-- ---------------------------------------------------------------------------

create function tci.handle_phase5_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim  tci.claims%rowtype;
  v_user   uuid;
begin
  if new.object_type <> 'claim' then
    return null;
  end if;
  select * into v_claim from tci.claims where id = new.object_id;
  if not found then
    return null;
  end if;

  if new.event_type = 'claim.status_changed' then
    -- Whatever the target, the tasks that were waiting on this claim to move
    -- have stopped being relevant.
    if (new.payload ->> 'to') <> 'submitted' then
      perform tci.close_tasks(array['claim_submitted']::tci.task_type[], new.object_id, 'done');
    end if;
    if (new.payload ->> 'to') <> 'info_requested' then
      perform tci.close_tasks(array['claim_info_requested']::tci.task_type[], new.object_id, 'done');
    end if;

    if (new.payload ->> 'to') = 'submitted' then
      -- Filed: claims picks it up, and the "you can claim this" nudge on the
      -- NOA behind it has served its purpose.
      perform tci.open_task(
        'claim_submitted', 'claim', new.object_id,
        'agenda.tasks.claim_submitted',
        jsonb_build_object(
          'claim_id', new.object_id,
          'claim_number', v_claim.claim_number,
          'amount', v_claim.claimed_amount,
          'currency', v_claim.currency_code),
        'claims'::tci.user_role, null, null, 'high', new.id);
      if v_claim.overdue_notification_id is not null then
        perform tci.close_tasks(
          array['noa_matured_to_claim', 'claim_ready_to_file']::tci.task_type[],
          v_claim.overdue_notification_id, 'done');
      end if;

    elsif (new.payload ->> 'to') = 'info_requested' then
      for v_user in select tci.policyholder_user_ids(v_claim.policy_id) loop
        perform tci.open_task(
          'claim_info_requested', 'claim', new.object_id,
          'agenda.tasks.claim_info_requested',
          jsonb_build_object(
            'claim_id', new.object_id,
            'claim_number', v_claim.claim_number,
            'comment', new.payload ->> 'comment'),
          null, v_user, null, 'high', new.id);
      end loop;

    elsif (new.payload ->> 'to') in ('approved', 'partially_approved') then
      perform tci.open_task(
        'claim_awaiting_payment', 'claim', new.object_id,
        'agenda.tasks.claim_awaiting_payment',
        jsonb_build_object(
          'claim_id', new.object_id,
          'claim_number', v_claim.claim_number,
          'amount', v_claim.approved_indemnity,
          'currency', v_claim.currency_code),
        'claims'::tci.user_role, null, null, 'high', new.id);

    elsif (new.payload ->> 'to') = 'declined' then
      -- Nothing downstream happens on its own once a claim is refused: sales
      -- has to tell the policyholder. Closed by hand, like submission_declined.
      perform tci.open_task(
        'claim_declined_review', 'claim', new.object_id,
        'agenda.tasks.claim_declined_review',
        jsonb_build_object(
          'claim_id', new.object_id,
          'claim_number', v_claim.claim_number,
          'reason', new.payload ->> 'comment'),
        'sales'::tci.user_role, null, null, 'normal', new.id);

    elsif (new.payload ->> 'to') = 'paid' then
      perform tci.close_tasks(
        array['claim_awaiting_payment']::tci.task_type[], new.object_id, 'done');

    elsif (new.payload ->> 'to') in ('closed', 'withdrawn') then
      perform tci.close_tasks(
        array['claim_submitted', 'claim_info_requested', 'claim_awaiting_payment',
              'claim_declined_review', 'claim_limit_reinstatement']::tci.task_type[],
        new.object_id, 'cancelled');
    end if;

  elsif new.event_type = 'claim.approved' then
    -- The buyer's limit went down with the approval. Putting it back is a
    -- credit decision, not an administrative consequence.
    perform tci.open_task(
      'claim_limit_reinstatement', 'claim', new.object_id,
      'agenda.tasks.claim_limit_reinstatement',
      jsonb_build_object(
        'claim_id', new.object_id,
        'claim_number', v_claim.claim_number,
        'policy_id', v_claim.policy_id,
        'entity_id', v_claim.entity_id),
      'credit_underwriter'::tci.user_role, null, null, 'normal', new.id);
  end if;

  return null;
end;
$$;

create trigger workflow_events_phase5
  after insert on tci.workflow_events
  for each row execute function tci.handle_phase5_event();

comment on function tci.handle_phase5_event() is
  'The claims reader of the workflow event stream. A third AFTER INSERT mapping beside 0024 and 0029, deliberately not a rewrite of either.';

-- ---------------------------------------------------------------------------
-- 4. Lazy generation, now including the ripening of an overdue account
-- ---------------------------------------------------------------------------
-- Sections (1) to (4) are carried over VERBATIM from 0029; (5) and (6) are
-- new. The set is recomputed rather than accumulated, so calling this on every
-- read is a no-op once it has settled - and there is still no cron anywhere.

create or replace function tci.refresh_agenda()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opened int := 0;
  v_row record;
  v_client uuid;
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

  return v_opened;
end;
$$;

comment on function tci.refresh_agenda() is
  'Lazily generates and retires every time-based task kind: limit review due, stale rating, declaration due/overdue, instalment due/overdue, NOA matured to claim, and the reinstatement review. Called on read - there is no cron.';

-- ---------------------------------------------------------------------------
-- 5. Completing by hand
-- ---------------------------------------------------------------------------
-- claim_declined_review joins submission_declined and uncovered_excess_review
-- as a type with no objective completion signal: once the claim is refused
-- nothing downstream happens on its own, and a human decides the conversation
-- with the policyholder is over. Every other type still refuses.

create or replace function tci.complete_task(p_task_id uuid)
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
  if v_task.task_type not in
     ('submission_declined', 'uncovered_excess_review', 'claim_declined_review') then
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
-- 6. Shared write entry points for claim invoices
-- ---------------------------------------------------------------------------
-- Both sides write invoices, under different windows, so the entry point is
-- shared and the window is a function. It lives here rather than in 0032
-- because the client half of it needs tci.may_access_claim from 0035.

create function tci.may_edit_claim_content(p_claim_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    -- Staff may correct the file until it has been decided. After a decision
    -- the invoices must not move: the indemnity was frozen from them.
    when tci.has_role('claims', 'sales', 'admin') then exists (
      select 1 from tci.claims
       where id = p_claim_id
         and status in ('draft', 'submitted', 'under_assessment', 'info_requested'))
    -- The policyholder edits while the ball is theirs.
    when tci.has_role('client') then exists (
      select 1 from tci.claims c
      join tci.policies p on p.id = c.policy_id
      where c.id = p_claim_id
        and p.entity_id in (select tci.my_client_entities())
        and c.status in ('draft', 'info_requested'))
    else false
  end
$$;

comment on function tci.may_edit_claim_content(uuid) is
  'Whether the caller may still change the invoices of a claim. Closes for everyone once a decision is made, because the indemnity was frozen from them.';

revoke execute on function tci.may_edit_claim_content(uuid) from public, anon;
grant execute on function tci.may_edit_claim_content(uuid) to authenticated, service_role;

create function tci.save_claim_invoice(
  p_claim_id       uuid,
  p_invoice_number text,
  p_invoice_date   date,
  p_shipment_date  date,
  p_due_date       date,
  p_amount         numeric,
  p_paid_amount    numeric default 0,
  p_disputed_amount numeric default 0,
  p_note           text default null,
  p_invoice_id     uuid default null
)
returns tci.claim_invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim tci.claims%rowtype;
  v_row   tci.claim_invoices%rowtype;
begin
  if not tci.may_edit_claim_content(p_claim_id) then
    raise exception 'this claim can no longer be edited' using errcode = 'P0004';
  end if;
  select * into v_claim from tci.claims where id = p_claim_id;

  if coalesce(trim(coalesce(p_invoice_number, '')), '') = '' then
    raise exception 'an invoice needs its number' using errcode = 'P0001';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'an invoice needs a positive amount' using errcode = 'P0001';
  end if;
  if p_due_date < p_invoice_date then
    raise exception 'the due date cannot precede the invoice date' using errcode = 'P0001';
  end if;
  if coalesce(p_paid_amount, 0) + coalesce(p_disputed_amount, 0) > p_amount then
    raise exception 'paid and disputed amounts cannot exceed the invoice'
      using errcode = 'P0001';
  end if;

  if p_invoice_id is null then
    insert into tci.claim_invoices (
      claim_id, invoice_number, invoice_date, shipment_date, due_date,
      amount, currency_code, paid_amount, disputed_amount, note
    ) values (
      p_claim_id, trim(p_invoice_number), p_invoice_date, p_shipment_date, p_due_date,
      p_amount, v_claim.currency_code, coalesce(p_paid_amount, 0),
      coalesce(p_disputed_amount, 0), p_note
    ) returning * into v_row;
  else
    update tci.claim_invoices
       set invoice_number = trim(p_invoice_number),
           invoice_date = p_invoice_date,
           shipment_date = p_shipment_date,
           due_date = p_due_date,
           amount = p_amount,
           paid_amount = coalesce(p_paid_amount, 0),
           disputed_amount = coalesce(p_disputed_amount, 0),
           note = p_note,
           updated_at = now()
     where id = p_invoice_id and claim_id = p_claim_id
     returning * into v_row;
    if not found then
      raise exception 'invoice not found on this claim' using errcode = 'P0002';
    end if;
  end if;

  -- Keep the verdicts honest. Recomputation never touches an override, so
  -- doing it eagerly costs nothing and stops a stale verdict from reaching
  -- an assessment.
  if exists (select 1 from tci.claim_invoice_verdicts where claim_id = p_claim_id) then
    perform tci.verify_claim_coverage(p_claim_id);
  end if;

  return v_row;
end;
$$;

create function tci.delete_claim_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_claim uuid;
begin
  select claim_id into v_claim from tci.claim_invoices where id = p_invoice_id;
  if v_claim is null then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  if not tci.may_edit_claim_content(v_claim) then
    raise exception 'this claim can no longer be edited' using errcode = 'P0004';
  end if;
  delete from tci.claim_invoices where id = p_invoice_id;
  if exists (select 1 from tci.claim_invoice_verdicts where claim_id = v_claim) then
    perform tci.verify_claim_coverage(v_claim);
  end if;
end;
$$;

revoke execute on function tci.save_claim_invoice(uuid, text, date, date, date, numeric, numeric, numeric, text, uuid) from public, anon;
grant execute on function tci.save_claim_invoice(uuid, text, date, date, date, numeric, numeric, numeric, text, uuid) to authenticated, service_role;
revoke execute on function tci.delete_claim_invoice(uuid) from public, anon;
grant execute on function tci.delete_claim_invoice(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. The client portal surface
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER views carrying their own has_role('client') +
-- policyholder mapping gate, selecting only safe columns, reading BASE TABLES
-- and SECURITY DEFINER FUNCTIONS only. Never an invoker view: security_invoker
-- propagates (0030).

create view tci.v_client_claims as
select
  c.id,
  c.claim_number,
  c.policy_id,
  p.policy_number,
  c.entity_id                as buyer_id,
  b.name                     as buyer_name,
  c.overdue_notification_id,
  c.status,
  c.cause_of_loss,
  c.insolvency_reference,
  c.claimed_amount,
  c.currency_code,
  c.approved_indemnity,
  c.filed_at,
  c.assessed_at,
  -- The reason IS communicated: a refusal the policyholder cannot read is not
  -- a decision, it is a silence. The assessor's internal comments live on the
  -- verdicts and the status history, neither of which is exposed here.
  c.decision_reason,
  c.info_requested_at,
  p.insured_percentage,
  p.waiting_period_days,
  p.nql_amount,
  p.deductible_each_loss,
  c.created_at,
  c.updated_at
from tci.claims c
join tci.policies p on p.id = c.policy_id
join tci.legal_entities b on b.id = c.entity_id
where tci.has_role('client')
  and p.entity_id in (select tci.my_client_entities());

create view tci.v_client_claim_invoices as
select
  i.id,
  i.claim_id,
  i.invoice_number,
  i.invoice_date,
  i.shipment_date,
  i.due_date,
  i.amount,
  i.paid_amount,
  i.disputed_amount,
  i.outstanding_amount,
  i.claimable_amount,
  i.payment_terms_days,
  i.currency_code,
  i.note,
  -- The verdict and WHY, in codes. What the policyholder does not get is the
  -- machinery behind it: system_detail carries decision ids and underwriting
  -- internals, and override_justification is the assessor's own reasoning.
  v.effective_verdict,
  v.effective_covered_amount,
  v.system_reasons
from tci.claim_invoices i
join tci.claims c on c.id = i.claim_id
join tci.policies p on p.id = c.policy_id
left join tci.claim_invoice_verdicts v on v.claim_invoice_id = i.id
where tci.has_role('client')
  and p.entity_id in (select tci.my_client_entities())
  -- Verdicts are working notes until the claim is decided.
  and (v.id is null or c.status in
       ('approved', 'partially_approved', 'declined', 'paid', 'closed'));

create view tci.v_client_claim_documents as
select
  d.id,
  d.claim_id,
  d.storage_path,
  d.document_type,
  d.original_filename,
  d.size_bytes,
  d.content_type,
  d.uploaded_at,
  (d.uploaded_by = (select auth.uid())) as uploaded_by_me
from tci.claim_documents d
join tci.claims c on c.id = d.claim_id
join tci.policies p on p.id = c.policy_id
where tci.has_role('client')
  and p.entity_id in (select tci.my_client_entities());

create view tci.v_client_claim_payments as
select
  pay.id,
  pay.claim_id,
  pay.amount,
  pay.currency_code,
  pay.paid_at,
  pay.reference
from tci.claim_payments pay
join tci.claims c on c.id = pay.claim_id
join tci.policies p on p.id = c.policy_id
where tci.has_role('client')
  and p.entity_id in (select tci.my_client_entities());

create view tci.v_client_claim_recoveries as
select
  r.id,
  r.claim_id,
  r.received_at,
  r.gross_amount,
  r.recovery_costs,
  r.net_amount,
  -- Only their own side of the split. What the insurer kept, and the borne
  -- amounts the ratio was computed from, are not the policyholder's business.
  r.policyholder_share,
  r.currency_code,
  r.note
from tci.recoveries r
join tci.claims c on c.id = r.claim_id
join tci.policies p on p.id = c.policy_id
where tci.has_role('client')
  and p.entity_id in (select tci.my_client_entities());

-- Which buyers a claim can be raised against, with the open NOA when there is
-- one and whether the waiting period has run.
create view tci.v_client_claimable as
select
  n.id                    as noa_id,
  n.policy_id,
  p.policy_number,
  n.entity_id             as buyer_id,
  b.name                  as buyer_name,
  n.first_due_date,
  n.overdue_amount,
  n.currency_code,
  p.waiting_period_days,
  (n.first_due_date + p.waiting_period_days) as claimable_from,
  (current_date >= n.first_due_date + p.waiting_period_days) as claimable_now,
  exists (select 1 from tci.claims c
           where c.overdue_notification_id = n.id and c.status <> 'withdrawn') as claim_exists
from tci.overdue_notifications n
join tci.policies p on p.id = n.policy_id
join tci.legal_entities b on b.id = n.entity_id
where tci.has_role('client')
  and n.status = 'open'
  and p.entity_id in (select tci.my_client_entities());

-- The client's own task rows, by user id. Never by role: every policyholder
-- holds `client`, so a role-scoped read would cross files.
create view tci.v_client_tasks as
select
  t.id,
  t.task_type,
  t.object_type,
  t.object_id,
  t.title_key,
  t.params,
  t.due_at,
  t.priority,
  t.created_at
from tci.tasks t
where tci.has_role('client')
  and t.status = 'open'
  and t.target_user = (select auth.uid());

comment on view tci.v_client_claims is
  'A policyholder''s own claims. The decision reason is exposed on purpose; the status-history comments, coverage internals and assessor identity are not.';
comment on view tci.v_client_claimable is
  'Open overdue notifications the policyholder may turn into a claim, with the waiting period made explicit.';

-- ---------------------------------------------------------------------------
-- 8. Client writes
-- ---------------------------------------------------------------------------
-- Thin, explicit wrappers. Each underlying function already refuses a client
-- who does not own the claim; naming them client_* keeps the portal's whole
-- write surface enumerable in one place, as 0025 established.

create function tci.client_open_claim(
  p_policy_id uuid,
  p_entity_id uuid,
  p_cause     tci.claim_cause_of_loss default 'protracted_default',
  p_noa_id    uuid default null,
  p_insolvency_reference text default null
)
returns tci.claims
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not tci.has_role('client') then
    raise exception 'this entry point is for portal users' using errcode = 'P0004';
  end if;
  return tci.open_claim(p_policy_id, p_entity_id, p_cause, p_noa_id, p_insolvency_reference);
end;
$$;

create function tci.client_claim_readiness(p_claim_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not tci.has_role('client') or not tci.may_access_claim(p_claim_id) then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'blockers', to_jsonb(tci.claim_submission_blockers(p_claim_id)),
    'required_documents', to_jsonb(
      (select tci.required_claim_documents(c.cause_of_loss) from tci.claims c where c.id = p_claim_id)),
    'missing_documents', to_jsonb(tci.missing_claim_documents(p_claim_id)),
    'eligible_from', tci.claim_eligible_from(p_claim_id));
end;
$$;

create function tci.client_submit_claim(p_claim_id uuid)
returns tci.claims
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not tci.has_role('client') then
    raise exception 'this entry point is for portal users' using errcode = 'P0004';
  end if;
  return tci.change_claim_status(p_claim_id, 'submitted', null);
end;
$$;

create function tci.client_withdraw_claim(p_claim_id uuid, p_comment text default null)
returns tci.claims
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not tci.has_role('client') then
    raise exception 'this entry point is for portal users' using errcode = 'P0004';
  end if;
  return tci.change_claim_status(p_claim_id, 'withdrawn', p_comment);
end;
$$;

create function tci.client_respond_to_info_request(p_claim_id uuid, p_comment text)
returns tci.claims
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not tci.has_role('client') then
    raise exception 'this entry point is for portal users' using errcode = 'P0004';
  end if;
  if coalesce(trim(coalesce(p_comment, '')), '') = '' then
    raise exception 'say what you are sending back' using errcode = 'P0001';
  end if;
  return tci.change_claim_status(p_claim_id, 'under_assessment', p_comment);
end;
$$;

do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'client_open_claim(uuid, uuid, tci.claim_cause_of_loss, uuid, text)',
    'client_claim_readiness(uuid)',
    'client_submit_claim(uuid)',
    'client_withdraw_claim(uuid, text)',
    'client_respond_to_info_request(uuid, text)'
  ] loop
    execute format('revoke execute on function tci.%s from public, anon', v_fn);
    execute format('grant execute on function tci.%s to authenticated, service_role', v_fn);
  end loop;
end;
$$;

do $$
declare v_view text;
begin
  foreach v_view in array array[
    'v_client_claims', 'v_client_claim_invoices', 'v_client_claim_documents',
    'v_client_claim_payments', 'v_client_claim_recoveries', 'v_client_claimable',
    'v_client_tasks'
  ] loop
    execute format('grant select on tci.%I to authenticated, service_role', v_view);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad text;
  v_n   int;
begin
  -- The 0030 rule: a client view must not read a security_invoker view.
  select string_agg(distinct c.relname, ', ') into v_bad
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_depend d on d.refobjid = c.oid
    join pg_rewrite rw on rw.oid = d.objid
    join pg_class cv on cv.oid = rw.ev_class
    join pg_namespace nv on nv.oid = cv.relnamespace
   where nv.nspname = 'tci' and cv.relname like 'v_client_claim%'
     and n.nspname = 'tci' and c.relkind = 'v'
     and c.reloptions::text like '%security_invoker=true%';
  if v_bad is not null then
    raise exception 'a client claim view reads the security_invoker view(s): %', v_bad;
  end if;

  -- The three tasks triggers coexist; none replaced another.
  select count(*) into v_n from pg_trigger
   where tgrelid = 'tci.workflow_events'::regclass and not tgisinternal;
  if v_n <> 3 then
    raise exception 'expected 3 workflow_events triggers, found %', v_n;
  end if;

  -- Every view Phase 5 adds must actually be readable by the app's role. A
  -- view without a grant is a screen that renders "permission denied" - which
  -- is exactly what the local replay caught before this shipped.
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'tci' and c.relkind = 'v'
     and (c.relname like 'v_claim%' or c.relname = 'v_claims'
          or c.relname = 'v_policy_liability' or c.relname like 'v_client_claim%')
     and not has_table_privilege('authenticated', c.oid, 'select');
  if v_bad is not null then
    raise exception 'these Phase 5 views are not readable by authenticated: %', v_bad;
  end if;

  -- No client-facing task type may be addressed to the client ROLE.
  if exists (
    select 1 from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
     where n.nspname = 'tci' and pr.proname in ('refresh_agenda', 'handle_phase5_event')
       and pr.prosrc like '%''claim_ready_to_file''%''client''::tci.user_role%'
  ) then
    raise exception 'a client task must be addressed to a user, never to the client role';
  end if;
end;
$$;
