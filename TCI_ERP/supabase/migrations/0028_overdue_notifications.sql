-- What: overdue notifications (NOA) - tci.overdue_notifications, the lateness
--       derivation, and the automatic limit suspension a filed NOA triggers.
-- Why:  Phase 4. A policyholder must tell the insurer when a buyer stops
--       paying, within the notification window. Two things follow, and both
--       are enforced here rather than left to a human remembering:
--
--   * LATENESS IS DERIVED AND SHOWN. A report filed after
--     max_extension_period_days + noa_window_days is late, and a late NOA can
--     prejudice cover. It is computed, never typed, and flagged prominently.
--   * A FILED NOA SUSPENDS THE LIMIT. The buyer has stopped paying, so new
--     shipments must not accrue fresh insured exposure. The suspension goes
--     through the EXISTING emergency path - a `revoked` decision, which
--     tci.apply_emergency_release already releases immediately, bypassing
--     commercial review and the sales window - so the policyholder sees it at
--     once. The prior limit stays in history and a credit underwriter can
--     reinstate by making a new decision.
--
-- This is deliberately NOT a claim. Claims are the next phase; an NOA that
-- turns into one is marked `escalated_to_claim` and handed over there.

-- ---------------------------------------------------------------------------
-- 1. A decision can now be made by the system
-- ---------------------------------------------------------------------------
-- Until now every decision had a human decider. A suspension has none: it is
-- a consequence of a filing, and the filer may be the CLIENT, who must never
-- appear as the author of an underwriting decision. So decided_by becomes
-- nullable and a decision must name either a person or the system.

alter table tci.credit_limit_decisions
  alter column decided_by drop not null;

alter table tci.credit_limit_decisions
  add column system_generated boolean not null default false,
  -- An i18n KEY, never rendered text: the UI owns the wording in three
  -- languages, the database owns the fact. Same rule as tci.tasks.title_key.
  add column system_reason_key text;

alter table tci.credit_limit_decisions
  add constraint decisions_decider_recorded check (
    decided_by is not null or system_generated
  ),
  add constraint decisions_system_reason_recorded check (
    system_generated = (system_reason_key is not null)
  );

comment on column tci.credit_limit_decisions.system_generated is
  'True when the database made this decision rather than a person - today only the automatic suspension a filed NOA triggers.';
comment on column tci.credit_limit_decisions.system_reason_key is
  'i18n key for why the system decided, e.g. limits.systemReason.noaSuspension. Never rendered text.';

-- ---------------------------------------------------------------------------
-- 2. The notification window on the policy
-- ---------------------------------------------------------------------------

alter table tci.policies
  add column noa_window_days int not null default 30
    check (noa_window_days >= 0);

comment on column tci.policies.noa_window_days is
  'Days after the maximum extension period within which an overdue account must be notified. Past that the NOA is late and cover may be prejudiced.';

-- ---------------------------------------------------------------------------
-- 3. The notifications themselves
-- ---------------------------------------------------------------------------

create type tci.noa_status as enum (
  'open',
  'resolved_paid',        -- the buyer paid; the file closes
  'escalated_to_claim',   -- handed to claims (Phase 5)
  'withdrawn'             -- filed in error
);

create table tci.overdue_notifications (
  id             uuid primary key default gen_random_uuid(),
  policy_id      uuid not null references tci.policies (id) on delete cascade,
  entity_id      uuid not null references tci.legal_entities (id),
  -- The due date of the OLDEST unpaid invoice. Everything about lateness and
  -- ageing is measured from here, so it is required.
  first_due_date date not null,
  overdue_amount numeric(18,2) not null check (overdue_amount > 0),
  currency_code  char(3) not null references tci.currencies (code),
  reported_at    timestamptz not null default now(),
  reported_by    uuid references auth.users (id),
  status         tci.noa_status not null default 'open',
  resolution_note text,
  resolved_at    timestamptz,
  -- The suspension this filing caused, when it caused one. Null when the
  -- buyer had no effective limit to suspend.
  suspension_decision_id uuid references tci.credit_limit_decisions (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint noa_resolution_recorded check (
    (status = 'open') = (resolved_at is null)
  )
);

-- One OPEN notification per (policy, buyer). A second overdue on the same
-- buyer belongs on the first notification, not beside it.
create unique index overdue_notifications_open_uq
  on tci.overdue_notifications (policy_id, entity_id)
  where status = 'open';

create index overdue_notifications_policy_idx on tci.overdue_notifications (policy_id, reported_at desc);
create index overdue_notifications_open_idx on tci.overdue_notifications (first_due_date)
  where status = 'open';

comment on table tci.overdue_notifications is
  'Policyholder notification that a buyer is overdue (NOA). Filing one suspends the buyer''s limit through the emergency release path. Not a claim.';

-- ---------------------------------------------------------------------------
-- 4. Lateness, derived
-- ---------------------------------------------------------------------------
-- Pure, so the frontend can mirror it exactly and warn the policyholder
-- BEFORE they file rather than after.

create function tci.noa_deadline(
  p_first_due_date            date,
  p_max_extension_period_days int,
  p_noa_window_days           int
)
returns date
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_first_due_date
       + coalesce(p_max_extension_period_days, 0)
       + coalesce(p_noa_window_days, 0)
$$;

comment on function tci.noa_deadline(date, int, int) is
  'The last day an overdue account can be notified without prejudicing cover: first due date + maximum extension period + the notification window.';

create view tci.v_overdue_notifications
with (security_invoker = true) as
select
  n.id,
  n.policy_id,
  p.policy_number,
  p.entity_id                    as policyholder_entity_id,
  ph.name                        as policyholder_name,
  n.entity_id                    as buyer_entity_id,
  b.name                         as buyer_name,
  n.first_due_date,
  n.overdue_amount,
  n.currency_code,
  n.reported_at,
  n.reported_by,
  n.status,
  n.resolution_note,
  n.resolved_at,
  n.suspension_decision_id,
  (n.suspension_decision_id is not null) as limit_suspended,
  p.max_extension_period_days,
  p.noa_window_days,
  tci.noa_deadline(n.first_due_date, p.max_extension_period_days, p.noa_window_days)
    as notify_by_date,
  (current_date - n.first_due_date)::int as days_past_due,
  -- Lateness is judged at the moment of REPORTING, not now: an NOA filed on
  -- time does not become late because the file stayed open.
  (n.reported_at::date
     > tci.noa_deadline(n.first_due_date, p.max_extension_period_days, p.noa_window_days))
    as reported_late,
  (n.reported_at::date
     - tci.noa_deadline(n.first_due_date, p.max_extension_period_days, p.noa_window_days))::int
    as days_late,
  n.created_at,
  n.updated_at
from tci.overdue_notifications n
join tci.policies p on p.id = n.policy_id
join tci.legal_entities ph on ph.id = p.entity_id
join tci.legal_entities b on b.id = n.entity_id;

comment on view tci.v_overdue_notifications is
  'NOAs with ageing and lateness derived. reported_late is judged at the reporting date, so an on-time filing never turns late while it stays open.';

-- ---------------------------------------------------------------------------
-- 5. The suspension chain
-- ---------------------------------------------------------------------------
-- Filing an NOA writes a `revoked` decision on the buyer's OPEN limit request
-- under this policy. tci.apply_emergency_release (0020, fixed in 0023) sees
-- outcome = 'revoked' and stamps released_at = now(), release_kind =
-- 'immediate' - so it bypasses commercial review and the sales window and is
-- visible to the policyholder straight away. That is the whole point: the
-- limit must stop covering new shipments the moment the buyer is reported
-- overdue.

create function tci.suspend_limit_for_noa(p_noa_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_noa      tci.overdue_notifications%rowtype;
  v_limit    record;
  v_decision tci.credit_limit_decisions%rowtype;
begin
  select * into v_noa from tci.overdue_notifications where id = p_noa_id;
  if not found then
    raise exception 'notification not found' using errcode = 'P0002';
  end if;

  select * into v_limit
    from tci.v_effective_limits v
   where v.policy_id = v_noa.policy_id
     and v.entity_id = v_noa.entity_id
     and v.outcome in ('approved', 'partial')
   limit 1;

  -- Nothing to suspend: the buyer was trading on the discretionary limit, or
  -- the limit was already revoked. Not an error - most NOAs on small buyers
  -- land here - so the filing stands and simply records no suspension.
  if not found then
    return null;
  end if;

  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code,
    valid_from, comment, decided_by, system_generated, system_reason_key, stage
  ) values (
    v_limit.request_id, 'revoked', 0, v_limit.currency_code,
    current_date, null, null, true, 'limits.systemReason.noaSuspension', 'credit'
  ) returning * into v_decision;

  -- Supersede the prior effective decisions for this buyer in this scope, the
  -- same way tci.decide_limit_request does. Without it the old decision stays
  -- 'effective' and v_effective_limits, which ranks a COMMERCIAL stage row
  -- above a credit one, would keep serving a commercially adjusted limit as
  -- live - so the suspension would be invisible exactly where it matters.
  update tci.credit_limit_decisions d
     set lifecycle = 'superseded'
    from tci.credit_limit_requests r,
         tci.credit_limit_requests nr
   where r.id = d.request_id
     and nr.id = v_decision.request_id
     and d.id <> v_decision.id
     and d.lifecycle = 'effective'
     and tci.limit_scope(r.policy_id, r.insurance_request_id)
         = tci.limit_scope(nr.policy_id, nr.insurance_request_id)
     and r.entity_id = nr.entity_id;

  update tci.overdue_notifications
     set suspension_decision_id = v_decision.id, updated_at = now()
   where id = p_noa_id;

  return v_decision.id;
end;
$$;

comment on function tci.suspend_limit_for_noa(uuid) is
  'Writes the automatic revocation a filed NOA triggers. Returns null when the buyer held no effective limit - a normal outcome, not a failure.';

-- Filing. One entry point for both sides: staff file on behalf of a
-- policyholder who phoned in, clients file their own through
-- tci.client_file_noa (0029), which delegates here.
create function tci.file_overdue_notification(
  p_policy_id      uuid,
  p_entity_id      uuid,
  p_first_due_date date,
  p_overdue_amount numeric,
  p_currency       char(3) default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy tci.policies%rowtype;
  v_noa    tci.overdue_notifications%rowtype;
  v_suspension uuid;
  v_late   boolean;
begin
  select * into v_policy from tci.policies where id = p_policy_id;
  if not found then
    raise exception 'policy not found' using errcode = 'P0002';
  end if;
  if v_policy.status <> 'active' then
    raise exception 'overdue accounts can only be notified under an active policy (this one is %)',
      v_policy.status using errcode = 'P0001';
  end if;
  if p_first_due_date is null or p_first_due_date > current_date then
    raise exception 'the first due date must be in the past' using errcode = 'P0001';
  end if;
  if coalesce(p_overdue_amount, 0) <= 0 then
    raise exception 'an overdue notification needs a positive amount' using errcode = 'P0001';
  end if;
  if not exists (select 1 from tci.legal_entities where id = p_entity_id) then
    raise exception 'buyer not found' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from tci.overdue_notifications
     where policy_id = p_policy_id and entity_id = p_entity_id and status = 'open'
  ) then
    raise exception 'this buyer already has an open overdue notification on this policy'
      using errcode = 'P0001';
  end if;

  insert into tci.overdue_notifications (
    policy_id, entity_id, first_due_date, overdue_amount, currency_code, reported_by
  ) values (
    p_policy_id, p_entity_id, p_first_due_date, p_overdue_amount,
    coalesce(p_currency, v_policy.currency_code), (select auth.uid())
  ) returning * into v_noa;

  v_suspension := tci.suspend_limit_for_noa(v_noa.id);

  select reported_late into v_late
    from tci.v_overdue_notifications where id = v_noa.id;

  perform tci.emit_workflow_event(
    'noa.filed', 'overdue_notification', v_noa.id,
    jsonb_build_object(
      'policy_id', p_policy_id,
      'entity_id', p_entity_id,
      'overdue_amount', p_overdue_amount,
      'currency', coalesce(p_currency, v_policy.currency_code),
      'reported_late', v_late,
      'limit_suspended', (v_suspension is not null)),
    'credit_underwriter'::tci.user_role);

  return jsonb_build_object(
    'result', 'filed',
    'noa_id', v_noa.id,
    'reported_late', v_late,
    'suspension_decision_id', v_suspension);
end;
$$;

create function tci.resolve_overdue_notification(
  p_noa_id uuid,
  p_status tci.noa_status,
  p_note   text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_noa tci.overdue_notifications%rowtype;
begin
  if not tci.is_staff() then
    raise exception 'only staff may resolve an overdue notification' using errcode = 'P0004';
  end if;
  if p_status = 'open' then
    raise exception 'resolving means moving off open' using errcode = 'P0001';
  end if;

  select * into v_noa from tci.overdue_notifications where id = p_noa_id;
  if not found then
    raise exception 'notification not found' using errcode = 'P0002';
  end if;
  if v_noa.status <> 'open' then
    raise exception 'this notification is already %', v_noa.status using errcode = 'P0001';
  end if;

  update tci.overdue_notifications
     set status = p_status,
         resolution_note = p_note,
         resolved_at = now(),
         updated_at = now()
   where id = p_noa_id
   returning * into v_noa;

  -- Resolution does NOT reinstate the limit. The buyer paid this invoice; a
  -- credit underwriter still has to decide whether they are good for the next
  -- one, which is a fresh decision through the normal path.
  perform tci.emit_workflow_event(
    'noa.resolved', 'overdue_notification', v_noa.id,
    jsonb_build_object('policy_id', v_noa.policy_id, 'status', p_status, 'note', p_note),
    'credit_underwriter'::tci.user_role);

  return jsonb_build_object('result', 'resolved', 'noa_id', v_noa.id, 'status', p_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
-- Staff on the base table; clients through tci.v_client_overdue_notifications
-- and tci.client_file_noa in 0029.

alter table tci.overdue_notifications enable row level security;

create policy "overdue_notifications: staff read"
  on tci.overdue_notifications for select to authenticated
  using (tci.is_staff());

create policy "overdue_notifications: staff write"
  on tci.overdue_notifications for insert to authenticated
  with check (tci.has_role('sales', 'commercial_underwriter', 'credit_underwriter', 'claims', 'admin'));

create policy "overdue_notifications: staff update"
  on tci.overdue_notifications for update to authenticated
  using (tci.has_role('sales', 'commercial_underwriter', 'credit_underwriter', 'claims', 'admin'))
  with check (tci.has_role('sales', 'commercial_underwriter', 'credit_underwriter', 'claims', 'admin'));

grant select, insert, update on tci.overdue_notifications to authenticated;
grant select on tci.v_overdue_notifications to authenticated;
grant all on tci.overdue_notifications to service_role;

grant execute on function tci.noa_deadline(date, int, int) to authenticated;
grant execute on function tci.file_overdue_notification(uuid, uuid, date, numeric, char) to authenticated;
grant execute on function tci.resolve_overdue_notification(uuid, tci.noa_status, text) to authenticated;
revoke execute on function tci.suspend_limit_for_noa(uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- 7. Assertions
-- ---------------------------------------------------------------------------

do $$
begin
  -- 1 Jan + 60 + 30 = 1 Jan + 90 days = 1 Apr.
  if tci.noa_deadline(date '2025-01-01', 60, 30) <> date '2025-04-01' then
    raise exception 'noa_deadline is wrong: %', tci.noa_deadline(date '2025-01-01', 60, 30);
  end if;
  -- A null window must not swallow the deadline: 1 Jan + 60 = 2 Mar.
  if tci.noa_deadline(date '2025-01-01', 60, null) <> date '2025-03-02' then
    raise exception 'noa_deadline with a null window is wrong: %',
      tci.noa_deadline(date '2025-01-01', 60, null);
  end if;

  -- The emergency path must still be in place: without it a suspension would
  -- sit in the sales window and the client would keep shipping on a dead limit.
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'tci.credit_limit_decisions'::regclass
       and not t.tgisinternal
       and pg_get_triggerdef(t.oid) ilike '%apply_emergency_release%'
  ) then
    raise exception 'the emergency release trigger is missing - NOA suspensions would not reach the client';
  end if;
end
$$;
