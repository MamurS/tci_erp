-- What: the Phase 4 Agenda task types and their generation, plus the client
--       portal surface for declarations, premium and overdue notifications.
-- Why:  Declarations, instalments and NOAs all create work for somebody, and
--       the Agenda is where work lives. And the policyholder is the one who
--       declares and who reports overdue accounts, so the portal has to reach
--       all three - through views and functions, never base tables.
--
-- Two structural choices worth stating:
--
--   * A SECOND event trigger, not a rewrite. tci.handle_workflow_event (0024,
--     extended in 0025) is ~200 lines of mapping that works. Reproducing it
--     to bolt on seven more cases would risk changing a line by accident, so
--     Phase 4 gets its OWN AFTER INSERT trigger on tci.workflow_events that
--     handles only its own event types and ignores the rest. Both fire; they
--     never touch the same task types.
--   * refresh_agenda IS replaced, because lazy generation has to happen in the
--     one call the screen already makes. The two existing sections are carried
--     over unchanged.

-- The seven task types this migration adds, in the same shape as the 0024
-- header. src/features/agenda/catalogue.ts mirrors this table and a contract
-- test reads it.
--
--   declaration_due                  sales                   normal  AUTO declaration.submitted, or lazily once declared
--   declaration_overdue              sales                   high    AUTO same signal, louder
--   declaration_awaiting_acceptance  commercial_underwriter  normal  AUTO declaration.accepted / declaration.disputed
--   instalment_due                   commercial_underwriter  normal  AUTO lazily, once paid or cancelled
--   instalment_overdue               commercial_underwriter  high    AUTO lazily, once paid or cancelled
--   noa_credit_review                credit_underwriter      urgent  AUTO noa.resolved
--   uncovered_excess_review          commercial_underwriter  high    MANUAL - the second one a human closes
--
-- uncovered_excess_review is MANUAL because nothing downstream resolves it:
-- turnover shipped outside cover is a conversation with the policyholder, and
-- a human decides when that conversation is over.

-- ---------------------------------------------------------------------------
-- 1. New task types
-- ---------------------------------------------------------------------------

alter type tci.task_type add value 'declaration_due';
alter type tci.task_type add value 'declaration_overdue';
alter type tci.task_type add value 'declaration_awaiting_acceptance';
alter type tci.task_type add value 'instalment_due';
alter type tci.task_type add value 'instalment_overdue';
alter type tci.task_type add value 'noa_credit_review';
alter type tci.task_type add value 'uncovered_excess_review';

-- ---------------------------------------------------------------------------
-- 2. Period arithmetic for declarations
-- ---------------------------------------------------------------------------
-- Which period a policy is currently declaring, and when it closed. Pure, so
-- the frontend can show "your July declaration is due" without a round trip.

create function tci.declaration_period_start(
  p_as_of     date,
  p_frequency tci.declaration_frequency
)
returns date
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_frequency
    when 'monthly'   then date_trunc('month',   p_as_of)::date
    when 'quarterly' then date_trunc('quarter', p_as_of)::date
  end
$$;

create function tci.declaration_period_end(
  p_period_start date,
  p_frequency    tci.declaration_frequency
)
returns date
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_frequency
    when 'monthly'   then (p_period_start + interval '1 month'  - interval '1 day')::date
    when 'quarterly' then (p_period_start + interval '3 months' - interval '1 day')::date
  end
$$;

comment on function tci.declaration_period_start(date, tci.declaration_frequency) is
  'The declaration period containing a date, at the policy frequency. Mirrored in src/features/declarations/period.ts.';

-- ---------------------------------------------------------------------------
-- 3. The Phase 4 event mapping
-- ---------------------------------------------------------------------------

create function tci.handle_phase4_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dec tci.declarations%rowtype;
  v_noa record;
begin
  case new.event_type

    -- A declaration is with the insurer: commercial underwriting has to
    -- accept or dispute it. The chasing task, if one was open, is answered.
    when 'declaration.submitted' then
      select * into v_dec from tci.declarations where id = new.object_id;
      if found then
        perform tci.close_tasks(
          array['declaration_due', 'declaration_overdue']::tci.task_type[],
          v_dec.policy_id);
        perform tci.open_task(
          'declaration_awaiting_acceptance', 'declaration', new.object_id,
          'agenda.tasks.declaration_awaiting_acceptance',
          jsonb_build_object(
            'policy_id', v_dec.policy_id,
            'period_start', v_dec.period_start,
            'total', v_dec.total_insurable_turnover),
          'commercial_underwriter'::tci.user_role, null, null, 'normal', new.id);
      end if;

    -- Accepted or disputed: either way it is no longer awaiting acceptance.
    when 'declaration.accepted', 'declaration.disputed' then
      perform tci.close_tasks(
        array['declaration_awaiting_acceptance']::tci.task_type[], new.object_id);

    -- A correction is a new declaration in draft; the old one's task is moot.
    when 'declaration.corrected' then
      perform tci.close_tasks(
        array['declaration_awaiting_acceptance']::tci.task_type[],
        (new.payload->>'supersedes')::uuid, 'cancelled');

    -- Turnover shipped outside cover. Nothing downstream resolves this on its
    -- own - it is a conversation with the policyholder - so it is the one
    -- Phase 4 task a human closes by hand.
    when 'declaration.uncovered_excess' then
      perform tci.open_task(
        'uncovered_excess_review', 'declaration', new.object_id,
        'agenda.tasks.uncovered_excess_review',
        jsonb_build_object(
          'policy_id', new.payload->>'policy_id',
          'uncovered_excess', new.payload->>'uncovered_excess'),
        'commercial_underwriter'::tci.user_role, null, null, 'high', new.id);

    -- A buyer has stopped paying. Credit underwriting reviews them, and it is
    -- urgent: the limit is already suspended and somebody has to decide what
    -- happens next.
    when 'noa.filed' then
      select * into v_noa from tci.v_overdue_notifications where id = new.object_id;
      if found then
        perform tci.open_task(
          'noa_credit_review', 'overdue_notification', new.object_id,
          'agenda.tasks.noa_credit_review',
          jsonb_build_object(
            'policy_id', v_noa.policy_id,
            'entity_id', v_noa.buyer_entity_id,
            'buyer_name', v_noa.buyer_name,
            'overdue_amount', v_noa.overdue_amount,
            'currency', v_noa.currency_code,
            'reported_late', v_noa.reported_late,
            'limit_suspended', v_noa.limit_suspended),
          'credit_underwriter'::tci.user_role, null, null, 'urgent', new.id);
      end if;

    when 'noa.resolved' then
      perform tci.close_tasks(
        array['noa_credit_review']::tci.task_type[], new.object_id);

    else
      -- Every other event belongs to tci.handle_workflow_event.
      null;
  end case;

  return null;
end;
$$;

comment on function tci.handle_phase4_event() is
  'Phase 4 half of the event->task mapping. Runs alongside tci.handle_workflow_event and deliberately ignores every event that one owns.';

create trigger workflow_events_phase4
  after insert on tci.workflow_events
  for each row execute function tci.handle_phase4_event();

-- ---------------------------------------------------------------------------
-- 4. Lazy generation: declarations due, instalments due
-- ---------------------------------------------------------------------------
-- Sections (1) and (2) are carried over verbatim from 0024. Sections (3) and
-- (4) are new. As before the set is RECOMPUTED rather than accumulated, so
-- calling this on every read is a no-op once it has settled - and there is
-- still no cron anywhere.

create or replace function tci.refresh_agenda()
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

  return v_opened;
end;
$$;

comment on function tci.refresh_agenda() is
  'Lazily generates and retires the time-based task kinds: limit review due, stale rating, declaration due/overdue, instalment due/overdue. Called on read by the Agenda screen - there is no cron.';

-- ---------------------------------------------------------------------------
-- 5. Completing by hand
-- ---------------------------------------------------------------------------
-- uncovered_excess_review joins submission_declined as a type with no
-- objective completion signal: the conversation with the policyholder ends
-- when a human says it does. Every other type still refuses.

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
  if v_task.task_type not in ('submission_declined', 'uncovered_excess_review') then
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
-- 6. Client portal surface
-- ---------------------------------------------------------------------------
-- Same doctrine as 0025: SECURITY DEFINER views carrying their own gate, and
-- SECURITY DEFINER functions for every write. No client policy is added to
-- tci.declarations, tci.declaration_lines, tci.overdue_notifications or
-- tci.premium_instalments - a client selecting from any of them gets nothing.

create view tci.v_client_declarations as
select
  d.id,
  d.policy_id,
  p.policy_number,
  d.period_start,
  d.period_end,
  d.status,
  d.currency_code,
  d.total_insurable_turnover,
  d.note,
  d.submitted_at,
  d.accepted_at,
  -- The dispute NOTE is shown: it is addressed to the policyholder and tells
  -- them what to fix. The underwriter's other commentary is not here.
  d.disputed_at,
  d.dispute_note,
  d.supersedes_id,
  (d.status = 'corrected') as superseded,
  t.covered_turnover,
  t.uncovered_excess,
  t.line_count,
  pe.amount as premium_amount,
  pe.rate_used as premium_rate_used
from tci.declarations d
join tci.policies p on p.id = d.policy_id
left join tci.v_declaration_totals t on t.declaration_id = d.id
left join tci.premium_entries pe on pe.declaration_id = d.id
where tci.has_role('client')
  and p.entity_id in (select tci.my_client_entities());

create view tci.v_client_declaration_lines as
select
  l.id,
  l.declaration_id,
  l.entity_id,
  l.entity_name,
  l.insurable_turnover,
  l.overdue_amount,
  l.line_note,
  l.coverage_basis,
  l.covered_amount,
  l.uncovered_excess,
  l.is_frozen
from tci.v_declaration_lines l
join tci.declarations d on d.id = l.declaration_id
join tci.policies p on p.id = d.policy_id
where tci.has_role('client')
  and p.entity_id in (select tci.my_client_entities());

create view tci.v_client_premium as
select
  vp.policy_id,
  vp.policy_number,
  vp.currency_code,
  vp.premium_basis,
  vp.premium_rate_pct,
  vp.minimum_premium,
  vp.instalments_total,
  vp.instalments_paid,
  vp.instalments_overdue,
  vp.next_due_date,
  vp.earned_premium,
  vp.adjustment_amount,
  vp.premium_due_total,
  vp.period_closed
from tci.v_policy_premium vp
join tci.policies p on p.id = vp.policy_id
where tci.has_role('client')
  and p.entity_id in (select tci.my_client_entities());

create view tci.v_client_premium_instalments as
select
  pi.id,
  pi.policy_id,
  pi.sequence,
  pi.due_date,
  pi.amount,
  pi.status,
  pi.paid_at,
  (pi.status in ('pending', 'invoiced') and pi.due_date < current_date) as overdue
from tci.premium_instalments pi
join tci.policies p on p.id = pi.policy_id
where tci.has_role('client')
  and p.entity_id in (select tci.my_client_entities())
  -- A cancelled instalment is an internal correction; it is not a bill the
  -- policyholder ever owed, so it is not shown to them.
  and pi.status <> 'cancelled';

create view tci.v_client_overdue_notifications as
select
  n.id,
  n.policy_id,
  n.policy_number,
  n.buyer_entity_id,
  n.buyer_name,
  n.first_due_date,
  n.overdue_amount,
  n.currency_code,
  n.reported_at,
  n.status,
  n.resolved_at,
  n.notify_by_date,
  n.days_past_due,
  n.reported_late,
  n.days_late,
  -- The policyholder must know their limit was suspended - that is the point
  -- of doing it immediately - but not which decision row carries it.
  n.limit_suspended
from tci.v_overdue_notifications n
join tci.policies p on p.id = n.policy_id
where tci.has_role('client')
  and p.entity_id in (select tci.my_client_entities());

-- Buyers a policyholder may declare against. Everyone in the registry is
-- declarable - turnover against an unknown buyer simply falls under the
-- discretionary limit - so this is not a whitelist. It is the picker's FIRST
-- page: the buyers this policy already has limits for, flagged, so the client
-- can see at a glance what is covered outright and what will lean on the DL.
-- Anything else is reached through tci.client_search_entities (0025).
create view tci.v_client_declarable_buyers as
select
  v.policy_id,
  v.entity_id,
  e.name as entity_name,
  v.approved_amount,
  v.currency_code,
  v.valid_until
from tci.v_effective_limits v
join tci.legal_entities e on e.id = v.entity_id
join tci.policies p on p.id = v.policy_id
where tci.has_role('client')
  and p.entity_id in (select tci.my_client_entities())
  and v.outcome in ('approved', 'partial')
  and v.client_visible
  and coalesce(v.approved_amount, 0) > 0;

grant select on
  tci.v_client_declarations,
  tci.v_client_declaration_lines,
  tci.v_client_premium,
  tci.v_client_premium_instalments,
  tci.v_client_overdue_notifications,
  tci.v_client_declarable_buyers
to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Client writes
-- ---------------------------------------------------------------------------

create function tci.client_policy_guard(p_policy_id uuid)
returns tci.policies
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_policy tci.policies%rowtype;
begin
  if not tci.has_role('client') then
    raise exception 'this entry point is for portal users' using errcode = 'P0004';
  end if;
  select * into v_policy from tci.policies where id = p_policy_id;
  if not found or v_policy.entity_id not in (select tci.my_client_entities()) then
    raise exception 'policy not found' using errcode = 'P0002';
  end if;
  return v_policy;
end;
$$;

create function tci.client_open_declaration(
  p_policy_id    uuid,
  p_period_start date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy tci.policies%rowtype;
  v_start  date;
  v_dec    tci.declarations%rowtype;
begin
  v_policy := tci.client_policy_guard(p_policy_id);
  if v_policy.status <> 'active' then
    raise exception 'declarations are made under an active policy (this one is %)',
      v_policy.status using errcode = 'P0001';
  end if;

  -- Normalise to the period boundary so a client cannot invent a period.
  v_start := tci.declaration_period_start(
    coalesce(p_period_start, current_date), v_policy.declaration_frequency);

  select * into v_dec
    from tci.declarations
   where policy_id = p_policy_id and period_start = v_start and status <> 'corrected';
  if found then
    if v_dec.status <> 'draft' and v_dec.status <> 'disputed' then
      raise exception 'the declaration for this period is already %', v_dec.status
        using errcode = 'P0001';
    end if;
    return jsonb_build_object('result', 'existing', 'declaration_id', v_dec.id);
  end if;

  insert into tci.declarations (policy_id, period_start, period_end, currency_code)
  values (
    p_policy_id, v_start,
    tci.declaration_period_end(v_start, v_policy.declaration_frequency),
    v_policy.currency_code
  ) returning * into v_dec;

  return jsonb_build_object('result', 'created', 'declaration_id', v_dec.id);
end;
$$;

create function tci.client_save_declaration_line(
  p_declaration_id uuid,
  p_entity_id      uuid,
  p_turnover       numeric,
  p_overdue_amount numeric default null,
  p_line_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dec tci.declarations%rowtype;
  v_line tci.declaration_lines%rowtype;
begin
  select * into v_dec from tci.declarations where id = p_declaration_id;
  if not found then
    raise exception 'declaration not found' using errcode = 'P0002';
  end if;
  perform tci.client_policy_guard(v_dec.policy_id);

  if v_dec.status not in ('draft', 'disputed') then
    raise exception 'a declaration can only be edited while it is a draft (this one is %)',
      v_dec.status using errcode = 'P0001';
  end if;
  if coalesce(p_turnover, -1) < 0 then
    raise exception 'turnover cannot be negative' using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.legal_entities where id = p_entity_id) then
    raise exception 'buyer not found' using errcode = 'P0002';
  end if;

  insert into tci.declaration_lines (
    declaration_id, entity_id, insurable_turnover, overdue_amount, line_note
  ) values (
    p_declaration_id, p_entity_id, p_turnover, p_overdue_amount, p_line_note
  )
  on conflict (declaration_id, entity_id) do update
    set insurable_turnover = excluded.insurable_turnover,
        overdue_amount     = excluded.overdue_amount,
        line_note          = excluded.line_note,
        updated_at         = now()
  returning * into v_line;

  return jsonb_build_object('result', 'saved', 'line_id', v_line.id);
end;
$$;

create function tci.client_delete_declaration_line(p_line_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dec tci.declarations%rowtype;
begin
  select d.* into v_dec
    from tci.declaration_lines l
    join tci.declarations d on d.id = l.declaration_id
   where l.id = p_line_id;
  if not found then
    raise exception 'line not found' using errcode = 'P0002';
  end if;
  perform tci.client_policy_guard(v_dec.policy_id);

  if v_dec.status not in ('draft', 'disputed') then
    raise exception 'a declaration can only be edited while it is a draft (this one is %)',
      v_dec.status using errcode = 'P0001';
  end if;

  delete from tci.declaration_lines where id = p_line_id;
  return jsonb_build_object('result', 'deleted');
end;
$$;

create function tci.client_submit_declaration(p_declaration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dec tci.declarations%rowtype;
begin
  select * into v_dec from tci.declarations where id = p_declaration_id;
  if not found then
    raise exception 'declaration not found' using errcode = 'P0002';
  end if;
  perform tci.client_policy_guard(v_dec.policy_id);
  -- The staff path owns the transition, the guards and the event, so the
  -- portal does not get a private workflow.
  return tci.submit_declaration(p_declaration_id);
end;
$$;

create function tci.client_file_noa(
  p_policy_id      uuid,
  p_entity_id      uuid,
  p_first_due_date date,
  p_overdue_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform tci.client_policy_guard(p_policy_id);
  -- Same entry point staff use: same validation, same suspension, same event.
  return tci.file_overdue_notification(
    p_policy_id, p_entity_id, p_first_due_date, p_overdue_amount, null);
end;
$$;

grant execute on function tci.client_open_declaration(uuid, date) to authenticated;
grant execute on function tci.client_save_declaration_line(uuid, uuid, numeric, numeric, text) to authenticated;
grant execute on function tci.client_delete_declaration_line(uuid) to authenticated;
grant execute on function tci.client_submit_declaration(uuid) to authenticated;
grant execute on function tci.client_file_noa(uuid, uuid, date, numeric) to authenticated;
grant execute on function tci.declaration_period_start(date, tci.declaration_frequency) to authenticated;
grant execute on function tci.declaration_period_end(date, tci.declaration_frequency) to authenticated;
revoke execute on function tci.client_policy_guard(uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- 8. Assertions
-- ---------------------------------------------------------------------------
-- The new enum values cannot be USED in the transaction that adds them, so
-- these check structure rather than exercising the tasks.

do $$
begin
  if tci.declaration_period_start(date '2025-07-14', 'monthly') <> date '2025-07-01' then
    raise exception 'monthly period start is wrong';
  end if;
  if tci.declaration_period_end(date '2025-07-01', 'monthly') <> date '2025-07-31' then
    raise exception 'monthly period end is wrong';
  end if;
  if tci.declaration_period_start(date '2025-07-14', 'quarterly') <> date '2025-07-01' then
    raise exception 'quarterly period start is wrong';
  end if;
  if tci.declaration_period_end(date '2025-07-01', 'quarterly') <> date '2025-09-30' then
    raise exception 'quarterly period end is wrong';
  end if;

  -- Both event triggers must be present: one alone would silently drop half
  -- the Agenda.
  if (select count(*) from pg_trigger
       where tgrelid = 'tci.workflow_events'::regclass and not tgisinternal) < 2 then
    raise exception 'the workflow_events triggers are not both installed';
  end if;

  -- No client policy may exist on the Phase 4 base tables.
  if exists (
    select 1 from pg_policies
     where schemaname = 'tci'
       and tablename in ('declarations', 'declaration_lines',
                         'overdue_notifications', 'premium_instalments', 'premium_entries')
       and qual ilike '%my_client_entities%'
  ) then
    raise exception 'a Phase 4 base table carries a client policy - clients go through views';
  end if;
end
$$;
