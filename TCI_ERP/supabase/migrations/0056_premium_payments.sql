-- What: premium instalments become payment records. tci.premium_payments
--       (append-only; a correction is a reversal row), invoices on the
--       instalment (number, date, who), the paid / outstanding / derived
--       status of every instalment in tci.v_premium_instalments, bank-statement
--       import with matching and an «unmatched payments» Agenda task, the
--       service-role integration point tci.record_premium_payment_import, and
--       the fix of the instalment schedule (13 monthly / 5 quarterly
--       instalments on an anniversary-to-anniversary policy, the last two on
--       the same day).
-- Why:  Prompt 23. An instalment was «pending / invoiced / paid» by a status
--       flag someone set by hand: nobody could record HOW MUCH arrived, when,
--       or against what, a part payment did not exist, and correcting a
--       mistake meant overwriting the only record of it. Money is now a list
--       of payments and everything else - paid, outstanding, overdue, the
--       Agenda's chasing tasks, the portal - is DERIVED from it.
--
-- The rules this migration fixes, and the places that state them:
--
--   * ALLOCATION IS DERIVED, OLDEST FIRST. A policy's net payments (payments
--     less reversals) fill its instalments in due-date order; nothing stores
--     which payment paid which instalment, so a reversal or a regenerated
--     schedule can never leave a stale allocation behind
--     (tci.v_premium_instalments).
--   * OVERPAYMENT IS REFUSED. A payment larger than what is still owed on
--     the policy is refused by name (payment_exceeds_outstanding); a bank line
--     that would overpay stays in the import as unmatched for a person to
--     resolve. There is no unallocated-credit balance to drift out of sight.
--   * PAYMENTS ARE NEVER EDITED. No API role may update or delete a payment;
--     a correction is a reversal row naming the payment it reverses (one
--     reversal per payment), and the history keeps both.
--   * THE STORED STATUS IS THE BILLING STATE ONLY: pending, invoiced or
--     cancelled. «Paid», «partially paid» and «overdue» are derived from the
--     money and the date, and 'paid' is no longer a value the column takes.
--
-- Agenda task type (catalogue row, as 0024/0029 list theirs):
--   premium_payment_unmatched        commercial_underwriter  high    AUTO once no line of the import is unmatched or suggested
--
-- Canonical: no statement here removes rows or objects (the schedule is
-- regenerated through tci.generate_premium_instalments, whose refusal to
-- replace billed instalments stays as it was).

-- ---------------------------------------------------------------------------
-- 1. Types
-- ---------------------------------------------------------------------------

create type tci.premium_payment_kind as enum ('payment', 'reversal');

create type tci.premium_payment_source as enum (
  'manual',             -- typed in by a person
  'bank_import',        -- a bank statement line (file import or integration)
  'accounting_import'   -- an accounting-system feed (integration)
);

create type tci.bank_line_status as enum (
  'matched',     -- confident: a reference and the amount agree; one click records it
  'suggested',   -- a reference was found but the amount or date disagree
  'unmatched',   -- nothing to go on, or it would overpay: a person decides
  'confirmed',   -- recorded as a payment
  'ignored',     -- not a premium payment, with a reason
  'duplicate'    -- the same line was already imported and recorded
);

-- Cannot be USED in this transaction (an enum value added in a transaction
-- is invisible to it until it commits); it only appears in plpgsql bodies.
alter type tci.task_type add value 'premium_payment_unmatched';

-- ---------------------------------------------------------------------------
-- 2. Invoices on the instalment
-- ---------------------------------------------------------------------------

alter table tci.premium_instalments
  add column invoiced_at    timestamptz,
  add column invoice_number text,
  add column invoice_date   date,
  add column invoiced_by    uuid references auth.users (id) on delete set null,
  add column invoice_note   text;

create unique index premium_instalments_invoice_number_uq
  on tci.premium_instalments (lower(invoice_number))
  where invoice_number is not null;

comment on column tci.premium_instalments.invoice_number is
  'The number on the invoice sent to the policyholder; unique, so a bank payment quoting it can be matched to exactly one instalment.';

-- ---------------------------------------------------------------------------
-- 3. Payments
-- ---------------------------------------------------------------------------

create table tci.premium_payments (
  id            uuid primary key default gen_random_uuid(),
  policy_id     uuid not null references tci.policies (id) on delete cascade,
  kind          tci.premium_payment_kind not null default 'payment',
  amount        numeric(18,2) not null check (amount > 0),
  currency_code char(3) not null references tci.currencies (code),
  payment_date  date not null,
  reference     text,
  source        tci.premium_payment_source not null default 'manual',
  note          text,
  -- A reversal names the payment it takes back; a payment names nothing.
  reverses_id   uuid references tci.premium_payments (id),
  -- The bank line it came from, when it came from one (FK added in 6).
  bank_line_id  uuid,
  -- The integration's own id, so a feed can be replayed without doubling.
  external_id   text,
  recorded_by   uuid references auth.users (id) on delete set null,
  recorded_at   timestamptz not null default now(),

  constraint premium_payments_reversal_shape check ((kind = 'reversal') = (reverses_id is not null)),
  constraint premium_payments_one_reversal unique (reverses_id),
  constraint premium_payments_external_uq unique (source, external_id)
);

create index premium_payments_policy_idx on tci.premium_payments (policy_id, payment_date);

comment on table tci.premium_payments is
  'Premium received, append-only. A correction is a reversal row (kind = reversal, reverses_id) - never an edit. Allocation to instalments is derived oldest-first in tci.v_premium_instalments.';

alter table tci.premium_payments enable row level security;

create policy "premium_payments: staff read"
  on tci.premium_payments for select to authenticated
  using (tci.is_staff());

-- Read only. Every write is tci.record_premium_payment /
-- tci.reverse_premium_payment / the bank import, all SECURITY DEFINER.
grant select on tci.premium_payments to authenticated;
grant all on tci.premium_payments to service_role;

-- ---------------------------------------------------------------------------
-- 4. What was «paid» becomes a payment
-- ---------------------------------------------------------------------------
-- Every instalment marked paid gets the payment that paid it (dated the day
-- it was marked, in Tashkent), and every instalment that was billed gets the
-- invoice fields, numbered INV-<policy>-<nn>. Then the stored status keeps
-- only the billing state.

-- What was paid per policy, kept for the closing assertion in a
-- transaction-local setting (no temporary table to leave behind).
select set_config('tci.m0056_paid_before', coalesce((
  select jsonb_object_agg(x.policy_id, x.paid_total)::text
    from (select pi.policy_id, coalesce(sum(pi.amount) filter (where pi.status = 'paid'), 0) as paid_total
            from tci.premium_instalments pi group by pi.policy_id) x), '{}'), true);

insert into tci.premium_payments (
  policy_id, kind, amount, currency_code, payment_date, reference, source, recorded_at
)
select pi.policy_id, 'payment', pi.amount, p.currency_code,
       (coalesce(pi.paid_at, pi.updated_at) at time zone 'Asia/Tashkent')::date,
       'MIGRATION-0056', 'manual', coalesce(pi.paid_at, pi.updated_at)
  from tci.premium_instalments pi
  join tci.policies p on p.id = pi.policy_id
 where pi.status = 'paid'
   and pi.amount > 0;

update tci.premium_instalments pi
   set invoiced_at    = coalesce(pi.paid_at, pi.updated_at),
       invoice_date   = (coalesce(pi.paid_at, pi.updated_at) at time zone 'Asia/Tashkent')::date,
       invoice_number = 'INV-' || p.policy_number || '-' || lpad(pi.sequence::text, 2, '0')
  from tci.policies p
 where p.id = pi.policy_id
   and pi.status in ('invoiced', 'paid');

update tci.premium_instalments
   set status = 'invoiced'
 where status = 'paid';

alter table tci.premium_instalments
  add constraint premium_instalments_paid_is_derived check (status <> 'paid'),
  add constraint premium_instalments_invoice_recorded check (status <> 'invoiced' or invoiced_at is not null);

comment on column tci.premium_instalments.status is
  'The BILLING state: pending, invoiced or cancelled. Paid / partially paid / overdue are derived from tci.premium_payments in tci.v_premium_instalments; the value paid is no longer stored (0056).';

-- ---------------------------------------------------------------------------
-- 5. The derived picture
-- ---------------------------------------------------------------------------

-- Per instalment: what has been paid against it and what is still owed.
-- A policy's NET payments fill its instalments oldest first (due date, then
-- sequence); a cancelled instalment takes nothing. Status precedence:
-- cancelled > paid > overdue > partially_paid > invoiced > pending - an
-- instalment past its due date with money still owed is «overdue» whether or
-- not part of it was paid; the paid column says how much was.
create view tci.v_premium_instalments
with (security_invoker = true) as
with net as (
  select pp.policy_id,
         sum(case pp.kind when 'payment' then pp.amount else -pp.amount end) as net_paid
    from tci.premium_payments pp
   group by pp.policy_id
), sched as (
  select pi.*,
         coalesce(sum(case when pi.status = 'cancelled' then 0 else pi.amount end)
                    over (partition by pi.policy_id order by pi.due_date, pi.sequence
                          rows between unbounded preceding and 1 preceding), 0) as owed_before
    from tci.premium_instalments pi
), alloc as (
  select s.*,
         (case when s.status = 'cancelled' then 0
               else least(s.amount, greatest(coalesce(n.net_paid, 0) - s.owed_before, 0))
          end)::numeric(18,2) as paid_amount
    from sched s
    left join net n on n.policy_id = s.policy_id
)
select
  a.id,
  a.policy_id,
  a.sequence,
  a.due_date,
  a.amount,
  a.status,
  a.invoiced_at,
  a.invoice_number,
  a.invoice_date,
  a.invoiced_by,
  a.invoice_note,
  a.note,
  a.created_at,
  a.paid_amount,
  (case when a.status = 'cancelled' then 0 else a.amount - a.paid_amount end)::numeric(18,2) as outstanding,
  case
    when a.status = 'cancelled'            then 'cancelled'
    when a.amount - a.paid_amount <= 0     then 'paid'
    when a.due_date < current_date         then 'overdue'
    when a.paid_amount > 0                 then 'partially_paid'
    when a.invoiced_at is not null         then 'invoiced'
    else 'pending'
  end as derived_status,
  case when a.status <> 'cancelled' and a.amount - a.paid_amount > 0 and a.due_date < current_date
       then current_date - a.due_date end as days_overdue,
  -- The day the policy's running payments first covered this instalment.
  (select min(r.payment_date)
     from (select pp.payment_date,
                  sum(case pp.kind when 'payment' then pp.amount else -pp.amount end)
                    over (order by pp.payment_date, pp.recorded_at, pp.id) as running
             from tci.premium_payments pp
            where pp.policy_id = a.policy_id) r
    where a.status <> 'cancelled'
      and a.amount > 0
      and a.amount - a.paid_amount <= 0
      and r.running >= a.owed_before + a.amount) as settled_on
from alloc a;

comment on view tci.v_premium_instalments is
  'Instalments with paid_amount / outstanding / derived_status from tci.premium_payments: net payments fill instalments oldest first; status precedence cancelled > paid > overdue > partially_paid > invoiced > pending.';

grant select on tci.v_premium_instalments to authenticated;
grant select on tci.v_premium_instalments to service_role;

-- The policy picture, now from the money. Every column keeps its name and
-- meaning (instalments_paid = premium actually received against the
-- schedule, instalments_invoiced = billed and not yet paid,
-- instalments_overdue = owed and past due); five are added at the end.
create or replace view tci.v_policy_premium
with (security_invoker = true) as
select
  p.id as policy_id,
  p.policy_number,
  p.entity_id,
  p.currency_code,
  p.premium_basis,
  p.premium_rate_pct,
  p.minimum_premium,
  coalesce(i.instalment_total, 0)   as instalments_total,
  coalesce(i.instalment_count, 0)   as instalments_count,
  coalesce(i.invoiced_total, 0)     as instalments_invoiced,
  coalesce(i.paid_total, 0)         as instalments_paid,
  coalesce(i.overdue_total, 0)      as instalments_overdue,
  i.next_due_date,
  coalesce(e.earned_premium, 0)     as earned_premium,
  coalesce(e.entry_count, 0)        as premium_entry_count,
  -- There is NO refund below the minimum (0027).
  greatest(coalesce(e.earned_premium, 0) - p.minimum_premium, 0) as adjustment_amount,
  case p.premium_basis
    when 'minimum_with_adjustment'
      then greatest(coalesce(e.earned_premium, 0), p.minimum_premium)
    when 'as_declared'
      then coalesce(e.earned_premium, 0)
  end as premium_due_total,
  (p.expiry_date < current_date) as period_closed,
  coalesce(i.outstanding_total, 0)  as instalments_outstanding,
  coalesce(i.overdue_count, 0)      as instalments_overdue_count,
  coalesce(pay.payments_total, 0)   as payments_total,
  coalesce(pay.reversals_total, 0)  as reversals_total,
  pay.last_payment_date
from tci.policies p
left join lateral (
  select
    sum(vi.amount) filter (where vi.derived_status <> 'cancelled')                     as instalment_total,
    count(*) filter (where vi.derived_status <> 'cancelled')::int                      as instalment_count,
    sum(vi.outstanding) filter (where vi.invoiced_at is not null)                      as invoiced_total,
    sum(vi.paid_amount)                                                                as paid_total,
    sum(vi.outstanding) filter (where vi.derived_status = 'overdue')                    as overdue_total,
    min(vi.due_date) filter (where vi.outstanding > 0)                                 as next_due_date,
    sum(vi.outstanding)                                                                as outstanding_total,
    count(*) filter (where vi.derived_status = 'overdue')::int                         as overdue_count
  from tci.v_premium_instalments vi
  where vi.policy_id = p.id
) i on true
left join lateral (
  select sum(pe.amount) as earned_premium, count(*)::int as entry_count
  from tci.premium_entries pe
  where pe.policy_id = p.id
) e on true
left join lateral (
  select sum(pp.amount) filter (where pp.kind = 'payment')        as payments_total,
         sum(pp.amount) filter (where pp.kind = 'reversal')       as reversals_total,
         max(pp.payment_date) filter (where pp.kind = 'payment')  as last_payment_date
    from tci.premium_payments pp
   where pp.policy_id = p.id
) pay on true;

comment on view tci.v_policy_premium is
  'Per policy: the minimum and its instalments (paid / outstanding / overdue derived from tci.premium_payments, 0056), cumulative earned premium, and the end-of-period adjustment. adjustment_amount is greatest(earned - minimum, 0) - there is no refund below the minimum premium.';

-- The portal. A client view reads base tables or goes through a SECURITY
-- DEFINER function (0030: security_invoker propagates), so the instalments
-- reach it through this reader, inside which the owner reads the invoker view.
create function tci.client_premium_instalments()
returns table (
  id uuid, policy_id uuid, sequence int, due_date date, amount numeric,
  status tci.premium_instalment_status, paid_at timestamptz, overdue boolean,
  paid_amount numeric, outstanding numeric, derived_status text,
  invoice_number text, invoice_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select vi.id, vi.policy_id, vi.sequence, vi.due_date, vi.amount,
         case when vi.derived_status = 'paid' then 'paid'::tci.premium_instalment_status else vi.status end,
         vi.settled_on::timestamptz,
         vi.derived_status = 'overdue',
         vi.paid_amount, vi.outstanding, vi.derived_status,
         vi.invoice_number, vi.invoice_date
    from tci.v_premium_instalments vi
    join tci.policies p on p.id = vi.policy_id
   where tci.has_role('client')
     and p.entity_id in (select tci.my_client_entities())
     -- A cancelled instalment is an internal correction, never a bill.
     and vi.status <> 'cancelled'
$$;
revoke execute on function tci.client_premium_instalments() from public, anon;
grant execute on function tci.client_premium_instalments() to authenticated;

create or replace view tci.v_client_premium_instalments as
select
  ci.id,
  ci.policy_id,
  ci.sequence,
  ci.due_date,
  ci.amount::numeric(18,2) as amount,
  ci.status,
  ci.paid_at,
  ci.overdue,
  ci.paid_amount,
  ci.outstanding,
  ci.derived_status,
  ci.invoice_number,
  ci.invoice_date
from tci.client_premium_instalments() ci;

create or replace view tci.v_client_premium as
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
  vp.period_closed,
  vp.instalments_outstanding,
  vp.last_payment_date
from tci.client_policy_premium() vp;

-- ---------------------------------------------------------------------------
-- 6. The schedule (bug D)
-- ---------------------------------------------------------------------------
-- 0027 measured the period as age(expiry + 1, inception) and billed any
-- remainder as one more period. A policy written anniversary to anniversary
-- (23 May 2026 - 23 May 2027) is «1 year 1 day» by that measure: 13 monthly
-- or 5 quarterly instalments, and because the generator clamps a due date
-- that falls after the expiry onto the expiry, the last two fell on the SAME
-- day (TCI-2026-0002: instalments 4 and 5, both 23 May 2027).
--
-- Now: periods start at the inception and every 1 or 3 months after it,
-- each step measured FROM THE INCEPTION (a 31st inception lands on the last
-- day of a shorter month and never drifts), and a period counts when it
-- starts more than one day before the expiry date. Both expiry conventions -
-- the last day of cover (1 Jan - 31 Dec) and the anniversary (23 May -
-- 23 May, or 29 Feb - 1 Mar) - are then one year; a trailing stub of one or
-- two days is the convention, not a period to bill. A part period of three
-- days or more is still a period (0027's assertions hold).
create or replace function tci.premium_instalment_count(
  p_inception date,
  p_expiry    date,
  p_frequency tci.declaration_frequency
)
returns int
language sql
immutable
parallel safe
set search_path = ''
as $$
  select greatest(1, (
    select count(*)::int
      from generate_series(0, 1200) k
     where p_inception + make_interval(months => k * case p_frequency when 'monthly' then 1 else 3 end)
           < p_expiry - 1
  ))
$$;

comment on function tci.premium_instalment_count(date, date, tci.declaration_frequency) is
  'Instalments in a policy period: periods start at the inception and every 1 (monthly) or 3 (quarterly) months after it, and count when they start more than one day before the expiry. At least one. Anniversary-to-anniversary and last-day-of-cover policies are both one year (0056).';

-- Regenerate every schedule the old count got wrong. All data here is mock
-- data, so a schedule with billed instalments is regenerated too: its
-- invoices are put back to pending first (the generator still refuses to
-- replace a billed instalment, and that guard stays), and afterwards the
-- same number of instalments, in order, is invoiced again with the original
-- invoice dates. Payments are untouched - they belong to the policy, and the
-- oldest-first allocation re-derives what they paid.
do $$
declare
  r       record;
  v_old   int;
  v_k     int;
  v_dates timestamptz[];
begin
  perform tci.begin_trusted_call();
  for r in
    select p.id, p.policy_number, p.inception_date, p.expiry_date, p.declaration_frequency
      from tci.policies p
     where exists (select 1 from tci.premium_instalments i where i.policy_id = p.id)
       and (
         (select count(*) from tci.premium_instalments i
           where i.policy_id = p.id and i.status <> 'cancelled')
           <> tci.premium_instalment_count(p.inception_date, p.expiry_date, p.declaration_frequency)
         or exists (select 1 from tci.premium_instalments i
                     where i.policy_id = p.id and i.status <> 'cancelled'
                     group by i.due_date having count(*) > 1)
       )
     order by p.policy_number
  loop
    select count(*), count(*) filter (where i.invoiced_at is not null),
           array_agg(i.invoiced_at order by i.sequence) filter (where i.invoiced_at is not null)
      into v_old, v_k, v_dates
      from tci.premium_instalments i where i.policy_id = r.id;

    update tci.premium_instalments
       set status = 'pending', invoiced_at = null, invoice_number = null,
           invoice_date = null, invoiced_by = null, invoice_note = null
     where policy_id = r.id and status = 'invoiced';

    perform tci.generate_premium_instalments(r.id, true);

    update tci.premium_instalments i
       set status = 'invoiced',
           invoiced_at = v_dates[i.sequence],
           invoice_date = (v_dates[i.sequence] at time zone 'Asia/Tashkent')::date,
           invoice_number = 'INV-' || r.policy_number || '-' || lpad(i.sequence::text, 2, '0')
     where i.policy_id = r.id and i.sequence <= v_k;

    raise notice '0056: regenerated the schedule of % (% -> % instalments, % re-invoiced)',
      r.policy_number, v_old,
      (select count(*) from tci.premium_instalments i where i.policy_id = r.id), v_k;
  end loop;
  perform set_config('tci.internal_call', '', true);
end
$$;

-- ---------------------------------------------------------------------------
-- 7. Invoicing and payments
-- ---------------------------------------------------------------------------

-- The one writer of tci.premium_payments. Internal: trusted code marks the
-- transaction first. Refusals carry a stable code first, then words.
create function tci.record_premium_payment_internal(
  p_policy_id    uuid,
  p_kind         tci.premium_payment_kind,
  p_amount       numeric,
  p_currency     text,
  p_payment_date date,
  p_reference    text,
  p_source       tci.premium_payment_source,
  p_note         text,
  p_reverses_id  uuid,
  p_bank_line_id uuid,
  p_external_id  text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy      tci.policies%rowtype;
  v_outstanding numeric(18,2);
  v_id          uuid;
  v_row         record;
begin
  perform tci.require_internal_call();

  select * into v_policy from tci.policies where id = p_policy_id;
  if not found then
    raise exception 'policy_not_found' using errcode = 'P0002';
  end if;

  if p_kind = 'payment' then
    if v_policy.status in ('draft', 'annulled') then
      raise exception 'policy_not_billable: a % policy takes no premium payments', v_policy.status
        using errcode = 'P0001';
    end if;
    if p_amount is null or p_amount <= 0 then
      raise exception 'payment_amount_positive: a payment must be a positive amount' using errcode = 'P0001';
    end if;
    if upper(coalesce(p_currency, '')) <> v_policy.currency_code then
      raise exception 'payment_currency_mismatch: the policy is in %, the payment in %',
        v_policy.currency_code, coalesce(p_currency, '?') using errcode = 'P0001';
    end if;
    if p_payment_date is null or p_payment_date > current_date then
      raise exception 'payment_date_invalid: a payment is dated today or earlier' using errcode = 'P0001';
    end if;
    select coalesce(sum(vi.outstanding), 0) into v_outstanding
      from tci.v_premium_instalments vi where vi.policy_id = p_policy_id;
    if p_amount > v_outstanding then
      raise exception 'payment_exceeds_outstanding: % % is more than the % % still owed on this policy',
        p_amount, v_policy.currency_code, v_outstanding, v_policy.currency_code
        using errcode = 'P0001';
    end if;
  end if;

  insert into tci.premium_payments (
    policy_id, kind, amount, currency_code, payment_date, reference, source, note,
    reverses_id, bank_line_id, external_id, recorded_by
  ) values (
    p_policy_id, p_kind, round(p_amount, 2), v_policy.currency_code,
    coalesce(p_payment_date, current_date),
    nullif(btrim(p_reference), ''), p_source, nullif(btrim(p_note), ''),
    p_reverses_id, p_bank_line_id, nullif(btrim(p_external_id), ''), auth.uid()
  )
  returning id into v_id;

  -- A payment settles instalments: their chasing tasks are answered, now -
  -- not at the next refresh of somebody's Agenda.
  for v_row in
    select vi.id from tci.v_premium_instalments vi
     where vi.policy_id = p_policy_id and vi.derived_status = 'paid'
  loop
    perform tci.close_tasks(array['instalment_due', 'instalment_overdue']::tci.task_type[], v_row.id, 'done');
  end loop;

  perform tci.emit_workflow_event(
    case p_kind when 'payment' then 'premium.payment_recorded' else 'premium.payment_reversed' end,
    'policy', p_policy_id,
    jsonb_build_object('payment_id', v_id, 'amount', round(p_amount, 2), 'currency', v_policy.currency_code,
                       'source', p_source, 'reverses_id', p_reverses_id));
  return v_id;
end;
$$;
revoke execute on function tci.record_premium_payment_internal(uuid, tci.premium_payment_kind, numeric, text, date, text, tci.premium_payment_source, text, uuid, uuid, text) from public, anon, authenticated;

-- Record a payment by hand. Returns the policy's instalments as they now
-- stand, so the screen replaces its table from the answer.
create function tci.record_premium_payment(
  p_policy_id    uuid,
  p_amount       numeric,
  p_payment_date date,
  p_currency     text default null,
  p_reference    text default null,
  p_source       tci.premium_payment_source default 'manual',
  p_note         text default null
)
returns setof tci.v_premium_instalments
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform tci.require_role('commercial_underwriter', 'admin');
  perform tci.begin_trusted_call();
  perform tci.record_premium_payment_internal(
    p_policy_id, 'payment', p_amount,
    coalesce(p_currency, (select currency_code from tci.policies where id = p_policy_id)),
    p_payment_date, p_reference, coalesce(p_source, 'manual'), p_note, null, null, null);
  return query
    select * from tci.v_premium_instalments vi where vi.policy_id = p_policy_id order by vi.sequence;
end;
$$;
revoke execute on function tci.record_premium_payment(uuid, numeric, date, text, text, tci.premium_payment_source, text) from public, anon;
grant execute on function tci.record_premium_payment(uuid, numeric, date, text, text, tci.premium_payment_source, text) to authenticated;

-- A correction: a reversal row for the whole payment, with a reason. The
-- payment and its reversal both stay; a payment is reversed at most once.
create function tci.reverse_premium_payment(p_payment_id uuid, p_reason text)
returns setof tci.v_premium_instalments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment tci.premium_payments%rowtype;
begin
  perform tci.require_role('commercial_underwriter', 'admin');

  select * into v_payment from tci.premium_payments where id = p_payment_id;
  if not found then
    raise exception 'payment_not_found' using errcode = 'P0002';
  end if;
  if v_payment.kind = 'reversal' then
    raise exception 'payment_is_reversal: a reversal cannot itself be reversed' using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.premium_payments where reverses_id = p_payment_id) then
    raise exception 'payment_already_reversed: this payment has already been reversed' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'reversal_reason_required: say why the payment is reversed' using errcode = 'P0001';
  end if;

  perform tci.begin_trusted_call();
  perform tci.record_premium_payment_internal(
    v_payment.policy_id, 'reversal', v_payment.amount, v_payment.currency_code, current_date,
    v_payment.reference, v_payment.source, p_reason, p_payment_id, null, null);
  return query
    select * from tci.v_premium_instalments vi where vi.policy_id = v_payment.policy_id order by vi.sequence;
end;
$$;
revoke execute on function tci.reverse_premium_payment(uuid, text) from public, anon;
grant execute on function tci.reverse_premium_payment(uuid, text) to authenticated;

-- Bill an instalment: number, date (today by default, never in the future),
-- note. A billed instalment's amount and date are frozen by
-- guard_instalment_edit (0027) from here on.
create function tci.invoice_premium_instalment(
  p_instalment_id  uuid,
  p_invoice_number text,
  p_invoice_date   date default null,
  p_note           text default null
)
returns setof tci.v_premium_instalments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    tci.v_premium_instalments%rowtype;
  v_number text := nullif(btrim(p_invoice_number), '');
begin
  perform tci.require_role('commercial_underwriter', 'admin');

  -- (filtered by policy first: the allocation is a window per policy)
  select * into v_row from tci.v_premium_instalments vi
   where vi.policy_id = (select pi.policy_id from tci.premium_instalments pi where pi.id = p_instalment_id)
     and vi.id = p_instalment_id;
  if not found then
    raise exception 'instalment_not_found' using errcode = 'P0002';
  end if;
  if v_row.status = 'cancelled' then
    raise exception 'instalment_cancelled: a cancelled instalment is not billed' using errcode = 'P0001';
  end if;
  if v_row.invoiced_at is not null then
    raise exception 'instalment_already_invoiced: this instalment was invoiced as %', v_row.invoice_number
      using errcode = 'P0001';
  end if;
  if v_row.outstanding <= 0 then
    raise exception 'instalment_already_paid: nothing is owed on this instalment' using errcode = 'P0001';
  end if;
  if v_number is null then
    raise exception 'invoice_number_required: an invoice needs its number' using errcode = 'P0001';
  end if;
  if length(v_number) > 64 then
    raise exception 'invoice_number_too_long: at most 64 characters' using errcode = 'P0001';
  end if;
  if exists (select 1 from tci.premium_instalments where lower(invoice_number) = lower(v_number)) then
    raise exception 'invoice_number_taken: % is already the number of another invoice', v_number
      using errcode = 'P0001';
  end if;
  if coalesce(p_invoice_date, current_date) > current_date then
    raise exception 'invoice_date_in_future: an invoice is dated today or earlier' using errcode = 'P0001';
  end if;

  perform tci.begin_trusted_call();
  update tci.premium_instalments
     set status         = 'invoiced',
         invoiced_at    = now(),
         invoice_date   = coalesce(p_invoice_date, current_date),
         invoice_number = v_number,
         invoiced_by    = auth.uid(),
         invoice_note   = nullif(btrim(p_note), '')
   where id = p_instalment_id;

  perform tci.emit_workflow_event(
    'premium.instalment_invoiced', 'premium_instalment', p_instalment_id,
    jsonb_build_object('policy_id', v_row.policy_id, 'invoice_number', v_number, 'amount', v_row.amount));
  return query
    select * from tci.v_premium_instalments vi where vi.policy_id = v_row.policy_id order by vi.sequence;
end;
$$;
revoke execute on function tci.invoice_premium_instalment(uuid, text, date, text) from public, anon;
grant execute on function tci.invoice_premium_instalment(uuid, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Bank statements
-- ---------------------------------------------------------------------------

-- How one bank's statement file is laid out: which column is the date, the
-- amount, the purpose text… The browser parses the file with it; the server
-- only keeps it so the next statement from that bank needs no mapping.
create table tci.bank_statement_profiles (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  mapping    jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint bank_statement_profiles_name_uq unique (name),
  constraint bank_statement_profiles_name_present check (btrim(name) <> '')
);

create table tci.bank_statement_imports (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid references tci.bank_statement_profiles (id) on delete set null,
  source      tci.premium_payment_source not null,
  file_name   text,
  line_count  int not null default 0,
  imported_by uuid references auth.users (id) on delete set null,
  imported_at timestamptz not null default now()
);

create table tci.bank_statement_lines (
  id                  uuid primary key default gen_random_uuid(),
  import_id           uuid not null references tci.bank_statement_imports (id) on delete cascade,
  line_no             int not null,
  value_date          date not null,
  amount              numeric(18,2) not null check (amount > 0),
  currency_code       char(3) not null,
  purpose             text,
  reference           text,
  payer               text,
  external_id         text,
  -- Same date, amount, currency, reference and purpose: the same money.
  dedupe_key          text not null,
  status              tci.bank_line_status not null,
  match_policy_id     uuid references tci.policies (id) on delete set null,
  match_instalment_id uuid references tci.premium_instalments (id) on delete set null,
  -- Why it matched, or did not: invoice_number, policy_number, amount_differs,
  -- date_far, currency, exceeds_outstanding, no_reference, ambiguous, assigned.
  match_reason        text not null,
  payment_id          uuid references tci.premium_payments (id),
  resolved_by         uuid references auth.users (id) on delete set null,
  resolved_at         timestamptz,
  ignore_reason       text,
  constraint bank_statement_lines_no_uq unique (import_id, line_no),
  constraint bank_statement_lines_confirmed_has_payment check ((status = 'confirmed') = (payment_id is not null)),
  constraint bank_statement_lines_ignored_has_reason check (status <> 'ignored' or btrim(coalesce(ignore_reason, '')) <> '')
);

create index bank_statement_lines_import_idx on tci.bank_statement_lines (import_id, status);
create index bank_statement_lines_dedupe_idx on tci.bank_statement_lines (dedupe_key);

alter table tci.premium_payments
  add constraint premium_payments_bank_line_fk
  foreign key (bank_line_id) references tci.bank_statement_lines (id) on delete set null;

alter table tci.bank_statement_profiles enable row level security;
alter table tci.bank_statement_imports enable row level security;
alter table tci.bank_statement_lines enable row level security;

-- A bank statement shows every payment a bank received, not only premium:
-- it is commercial underwriting's (and admin's), nobody else's.
create policy "bank_statement_profiles: commercial read"
  on tci.bank_statement_profiles for select to authenticated
  using (tci.has_role('commercial_underwriter', 'admin'));
create policy "bank_statement_imports: commercial read"
  on tci.bank_statement_imports for select to authenticated
  using (tci.has_role('commercial_underwriter', 'admin'));
create policy "bank_statement_lines: commercial read"
  on tci.bank_statement_lines for select to authenticated
  using (tci.has_role('commercial_underwriter', 'admin'));

grant select on tci.bank_statement_profiles, tci.bank_statement_imports, tci.bank_statement_lines to authenticated;
grant all on tci.bank_statement_profiles, tci.bank_statement_imports, tci.bank_statement_lines to service_role;

-- Letters and digits only, upper case: «INV-TCI-2026-0002-01» and
-- «inv tci 2026 0002 01» are the same reference.
create function tci.payment_text_key(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_text, ''), '[^[:alnum:]]', '', 'g'))
$$;
revoke execute on function tci.payment_text_key(text) from public, anon;
grant execute on function tci.payment_text_key(text) to authenticated;

-- What a payment text points at. In order:
--   1. an invoice number of an instalment still owed (the longest one found
--      wins; two of the same length is ambiguous) - confident when the amount
--      is what that instalment still owes, or what the whole policy owes;
--   2. a policy number - confident when the amount is what the oldest
--      outstanding instalment owes, or what the whole policy owes, AND the
--      money arrived within 120 days of that instalment's due date;
--   3. nothing: unmatched.
-- A reference with the wrong currency, or an amount above what the policy
-- still owes, is unmatched whatever it says: recording it would be refused.
create function tci.match_payment_text(
  p_text       text,
  p_amount     numeric,
  p_currency   text,
  p_value_date date,
  out policy_id     uuid,
  out instalment_id uuid,
  out status        tci.bank_line_status,
  out reason        text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_key   text := tci.payment_text_key(p_text);
  v_hits  uuid[];
  v_inst  record;
  v_owed  numeric(18,2);
  v_pol   record;
begin
  status := 'unmatched';
  reason := 'no_reference';
  if v_key = '' then
    return;
  end if;

  -- 1. invoice numbers
  select array_agg(x.id) into v_hits
    from (
      select vi.id, length(tci.payment_text_key(vi.invoice_number)) as len,
             max(length(tci.payment_text_key(vi.invoice_number))) over () as best
        from tci.v_premium_instalments vi
       where vi.invoice_number is not null
         and vi.outstanding > 0
         and length(tci.payment_text_key(vi.invoice_number)) >= 3
         and position(tci.payment_text_key(vi.invoice_number) in v_key) > 0
    ) x
   where x.len = x.best;

  if coalesce(array_length(v_hits, 1), 0) = 1 then
    select vi.*, p.currency_code as policy_currency into v_inst
      from tci.v_premium_instalments vi join tci.policies p on p.id = vi.policy_id
     where vi.policy_id = (select pi.policy_id from tci.premium_instalments pi where pi.id = v_hits[1])
       and vi.id = v_hits[1];
    policy_id := v_inst.policy_id;
    instalment_id := v_inst.id;
    select coalesce(sum(vi.outstanding), 0) into v_owed
      from tci.v_premium_instalments vi where vi.policy_id = v_inst.policy_id;
    if upper(coalesce(p_currency, '')) <> v_inst.policy_currency then
      status := 'unmatched'; reason := 'currency';
    elsif p_amount > v_owed then
      status := 'unmatched'; reason := 'exceeds_outstanding';
    elsif p_amount = v_inst.outstanding or p_amount = v_owed then
      status := 'matched'; reason := 'invoice_number';
    else
      status := 'suggested'; reason := 'amount_differs';
    end if;
    return;
  end if;

  -- 2. policy numbers
  select array_agg(x.id) into v_hits
    from (
      select p.id, length(tci.payment_text_key(p.policy_number)) as len,
             max(length(tci.payment_text_key(p.policy_number))) over () as best
        from tci.policies p
       where p.status not in ('draft', 'annulled')
         and length(tci.payment_text_key(p.policy_number)) >= 3
         and position(tci.payment_text_key(p.policy_number) in v_key) > 0
    ) x
   where x.len = x.best;

  if coalesce(array_length(v_hits, 1), 0) > 1 then
    reason := 'ambiguous';
    return;
  end if;
  if coalesce(array_length(v_hits, 1), 0) = 0 then
    return;
  end if;

  select * into v_pol from tci.policies where id = v_hits[1];
  policy_id := v_pol.id;
  select coalesce(sum(vi.outstanding), 0) into v_owed
    from tci.v_premium_instalments vi where vi.policy_id = v_pol.id;

  if upper(coalesce(p_currency, '')) <> v_pol.currency_code then
    status := 'unmatched'; reason := 'currency';
    return;
  end if;
  if v_owed <= 0 or p_amount > v_owed then
    status := 'unmatched'; reason := 'exceeds_outstanding';
    return;
  end if;

  -- The oldest instalment still owed (there is one: v_owed > 0).
  select vi.id, vi.outstanding, vi.due_date into v_inst
    from tci.v_premium_instalments vi
   where vi.policy_id = v_pol.id and vi.outstanding > 0
   order by vi.due_date, vi.sequence limit 1;
  instalment_id := v_inst.id;

  if p_amount = v_inst.outstanding or p_amount = v_owed then
    if abs(p_value_date - v_inst.due_date) <= 120 then
      status := 'matched'; reason := 'policy_number';
    else
      status := 'suggested'; reason := 'date_far';
    end if;
  else
    status := 'suggested'; reason := 'amount_differs';
  end if;
end;
$$;
revoke execute on function tci.match_payment_text(text, numeric, text, date) from public, anon, authenticated;

-- One Agenda task per import while any of its lines needs a person
-- (unmatched or suggested); it closes when the last one is resolved.
create function tci.sync_unmatched_payments_task(p_import_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_open int;
  v_imp  tci.bank_statement_imports%rowtype;
begin
  perform tci.require_internal_call();
  select * into v_imp from tci.bank_statement_imports where id = p_import_id;
  select count(*) into v_open
    from tci.bank_statement_lines
   where import_id = p_import_id and status in ('unmatched', 'suggested');

  if v_open > 0 then
    perform tci.open_task(
      'premium_payment_unmatched'::tci.task_type, 'bank_statement_import', p_import_id,
      'agenda.tasks.premium_payment_unmatched',
      jsonb_build_object('import_id', p_import_id, 'file_name', v_imp.file_name,
                         'source', v_imp.source, 'count', v_open),
      'commercial_underwriter'::tci.user_role, null,
      v_imp.imported_at + interval '2 days', 'high'::tci.task_priority, null);
    -- The count on an open task follows the lines.
    update tci.tasks
       set params = params || jsonb_build_object('count', v_open)
     where task_type = 'premium_payment_unmatched'::tci.task_type
       and object_id = p_import_id
       and status = 'open';
  else
    perform tci.close_tasks(array['premium_payment_unmatched']::tci.task_type[], p_import_id, 'done');
  end if;
end;
$$;
revoke execute on function tci.sync_unmatched_payments_task(uuid) from public, anon, authenticated;

-- Store and match the lines of one statement (internal: the screen's import
-- and the integration both come through here). p_lines: [{line_no?,
-- value_date, amount, currency, purpose?, reference?, payer?, external_id?,
-- policy_number?, invoice_number?}] - credits only, as the bank stated them.
create function tci.import_statement_lines(
  p_import_id uuid,
  p_lines     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line   jsonb;
  v_no     int := 0;
  v_amount numeric(18,2);
  v_date   date;
  v_ccy    text;
  v_key    text;
  v_pol    uuid;
  v_inst   uuid;
  v_status tci.bank_line_status;
  v_reason text;
  v_source tci.premium_payment_source;
  v_ext    text;
  v_counts jsonb := '{"matched":0,"suggested":0,"unmatched":0,"duplicate":0}'::jsonb;
begin
  perform tci.require_internal_call();
  select source into v_source from tci.bank_statement_imports where id = p_import_id;

  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'statement_empty: the statement has no lines to import' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_lines) > 5000 then
    raise exception 'statement_too_large: at most 5000 lines per import' using errcode = 'P0001';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_no := coalesce((v_line->>'line_no')::int, v_no + 1);
    begin
      v_amount := round((v_line->>'amount')::numeric, 2);
      v_date := (v_line->>'value_date')::date;
    exception when others then
      raise exception 'statement_line_invalid: line % has no readable date or amount', v_no using errcode = 'P0001';
    end;
    if v_amount is null or v_amount <= 0 or v_date is null then
      raise exception 'statement_line_invalid: line % has no readable date or amount', v_no using errcode = 'P0001';
    end if;
    v_ccy := upper(nullif(btrim(v_line->>'currency'), ''));
    if v_ccy is null or length(v_ccy) <> 3 then
      raise exception 'statement_line_invalid: line % has no currency', v_no using errcode = 'P0001';
    end if;
    v_ext := nullif(btrim(v_line->>'external_id'), '');
    v_key := md5(concat_ws('|', v_date, v_amount, v_ccy,
                           tci.payment_text_key(v_line->>'reference'), tci.payment_text_key(v_line->>'purpose')));

    if (v_ext is not null and exists (
          select 1 from tci.premium_payments pp where pp.source = v_source and pp.external_id = v_ext))
       or exists (
          select 1 from tci.bank_statement_lines l
           where l.dedupe_key = v_key and l.status in ('confirmed', 'matched', 'suggested', 'unmatched')
             and (l.import_id <> p_import_id or l.status = 'confirmed')) then
      v_status := 'duplicate';
      v_reason := 'duplicate';
      v_pol := null;
      v_inst := null;
    else
      select m.policy_id, m.instalment_id, m.status, m.reason
        into v_pol, v_inst, v_status, v_reason
        from tci.match_payment_text(
               concat_ws(' ', v_line->>'invoice_number', v_line->>'policy_number',
                         v_line->>'reference', v_line->>'purpose'),
               v_amount, v_ccy, v_date) m;
    end if;

    insert into tci.bank_statement_lines (
      import_id, line_no, value_date, amount, currency_code, purpose, reference, payer,
      external_id, dedupe_key, status, match_policy_id, match_instalment_id, match_reason
    ) values (
      p_import_id, v_no, v_date, v_amount, v_ccy,
      nullif(btrim(v_line->>'purpose'), ''), nullif(btrim(v_line->>'reference'), ''),
      nullif(btrim(v_line->>'payer'), ''), v_ext, v_key, v_status,
      v_pol,
      v_inst,
      v_reason
    );
    v_counts := jsonb_set(v_counts, array[v_status::text], to_jsonb((v_counts->>v_status::text)::int + 1));
  end loop;

  update tci.bank_statement_imports set line_count = v_no where id = p_import_id;
  perform tci.sync_unmatched_payments_task(p_import_id);
  return v_counts;
end;
$$;
revoke execute on function tci.import_statement_lines(uuid, jsonb) from public, anon, authenticated;

-- Record one line as a payment (internal). Returns null when recorded, or
-- the refusal's code when the payment is refused (the line then stays as it
-- was, for a person).
create function tci.confirm_statement_line(p_line_id uuid, p_policy_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line   tci.bank_statement_lines%rowtype;
  v_source tci.premium_payment_source;
  v_pay    uuid;
begin
  perform tci.require_internal_call();
  select * into v_line from tci.bank_statement_lines where id = p_line_id for update;
  if not found then
    raise exception 'statement_line_not_found' using errcode = 'P0002';
  end if;
  if v_line.status not in ('matched', 'suggested', 'unmatched') then
    return 'statement_line_resolved';
  end if;
  select source into v_source from tci.bank_statement_imports where id = v_line.import_id;

  begin
    v_pay := tci.record_premium_payment_internal(
      p_policy_id, 'payment', v_line.amount, v_line.currency_code, v_line.value_date,
      coalesce(v_line.reference, left(v_line.purpose, 200)), v_source, null, null, v_line.id,
      v_line.external_id);
  exception when sqlstate 'P0001' then
    return split_part(sqlerrm, ':', 1);
  end;

  update tci.bank_statement_lines
     set status = 'confirmed', payment_id = v_pay, match_policy_id = p_policy_id,
         resolved_by = auth.uid(), resolved_at = now()
   where id = p_line_id;
  return null;
end;
$$;
revoke execute on function tci.confirm_statement_line(uuid, uuid) from public, anon, authenticated;

-- Save a bank's column mapping under its name (a second save of the same
-- name updates it: a mapping is configuration, not history).
create function tci.save_bank_statement_profile(p_name text, p_mapping jsonb)
returns tci.bank_statement_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row tci.bank_statement_profiles%rowtype;
  v_name text := nullif(btrim(p_name), '');
begin
  perform tci.require_role('commercial_underwriter', 'admin');
  if v_name is null then
    raise exception 'profile_name_required: name the bank this layout belongs to' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_mapping) is distinct from 'object' then
    raise exception 'profile_mapping_invalid: the column mapping is not readable' using errcode = 'P0001';
  end if;
  update tci.bank_statement_profiles
     set mapping = p_mapping, updated_by = auth.uid(), updated_at = now()
   where name = v_name
  returning * into v_row;
  if not found then
    insert into tci.bank_statement_profiles (name, mapping, created_by, updated_by)
    values (v_name, p_mapping, auth.uid(), auth.uid())
    returning * into v_row;
  end if;
  return v_row;
end;
$$;
revoke execute on function tci.save_bank_statement_profile(text, jsonb) from public, anon;
grant execute on function tci.save_bank_statement_profile(text, jsonb) to authenticated;

-- Import a statement the browser has parsed with a profile. Returns the
-- import id and how many lines fell into each status.
create function tci.import_bank_statement(
  p_profile_id uuid,
  p_file_name  text,
  p_lines      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_counts jsonb;
begin
  perform tci.require_role('commercial_underwriter', 'admin');
  perform tci.begin_trusted_call();
  insert into tci.bank_statement_imports (profile_id, source, file_name, imported_by)
  values (p_profile_id, 'bank_import', nullif(btrim(p_file_name), ''), auth.uid())
  returning id into v_id;
  v_counts := tci.import_statement_lines(v_id, p_lines);
  perform tci.emit_workflow_event('premium.statement_imported', 'bank_statement_import', v_id, v_counts);
  return jsonb_build_object('import_id', v_id) || v_counts;
end;
$$;
revoke execute on function tci.import_bank_statement(uuid, text, jsonb) from public, anon;
grant execute on function tci.import_bank_statement(uuid, text, jsonb) to authenticated;

-- Record the given lines (matched or suggested ones, to the policy they were
-- matched to). One answer per line: recorded, or the refusal's code.
create function tci.confirm_bank_lines(p_line_ids uuid[])
returns table (line_id uuid, result text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line    tci.bank_statement_lines%rowtype;
  v_imports uuid[] := '{}';
  v_refusal text;
  v_import  uuid;
begin
  perform tci.require_role('commercial_underwriter', 'admin');
  perform tci.begin_trusted_call();
  for v_line in
    select * from tci.bank_statement_lines l
     where l.id = any (p_line_ids)
     order by l.import_id, l.line_no
  loop
    line_id := v_line.id;
    if v_line.status not in ('matched', 'suggested') or v_line.match_policy_id is null then
      result := 'statement_line_not_matched';
    else
      v_refusal := tci.confirm_statement_line(v_line.id, v_line.match_policy_id);
      result := coalesce(v_refusal, 'recorded');
    end if;
    v_imports := array_append(v_imports, v_line.import_id);
    return next;
  end loop;
  foreach v_import in array coalesce((select array_agg(distinct x) from unnest(v_imports) x), '{}'::uuid[])
  loop
    perform tci.sync_unmatched_payments_task(v_import);
  end loop;
end;
$$;
revoke execute on function tci.confirm_bank_lines(uuid[]) from public, anon;
grant execute on function tci.confirm_bank_lines(uuid[]) to authenticated;

-- A person decides where an unmatched (or suggested) line belongs.
create function tci.assign_bank_line(p_line_id uuid, p_policy_id uuid)
returns tci.bank_statement_lines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line    tci.bank_statement_lines%rowtype;
  v_refusal text;
begin
  perform tci.require_role('commercial_underwriter', 'admin');
  select * into v_line from tci.bank_statement_lines where id = p_line_id;
  if not found then
    raise exception 'statement_line_not_found' using errcode = 'P0002';
  end if;
  perform tci.begin_trusted_call();
  v_refusal := tci.confirm_statement_line(p_line_id, p_policy_id);
  if v_refusal is not null then
    raise exception '%: the payment cannot be recorded on this policy', v_refusal using errcode = 'P0001';
  end if;
  update tci.bank_statement_lines set match_reason = 'assigned' where id = p_line_id;
  perform tci.sync_unmatched_payments_task(v_line.import_id);
  select * into v_line from tci.bank_statement_lines where id = p_line_id;
  return v_line;
end;
$$;
revoke execute on function tci.assign_bank_line(uuid, uuid) from public, anon;
grant execute on function tci.assign_bank_line(uuid, uuid) to authenticated;

-- Not a premium payment (a refund, another product): set aside, with why.
create function tci.ignore_bank_line(p_line_id uuid, p_reason text)
returns tci.bank_statement_lines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line tci.bank_statement_lines%rowtype;
begin
  perform tci.require_role('commercial_underwriter', 'admin');
  select * into v_line from tci.bank_statement_lines where id = p_line_id for update;
  if not found then
    raise exception 'statement_line_not_found' using errcode = 'P0002';
  end if;
  if v_line.status not in ('matched', 'suggested', 'unmatched') then
    raise exception 'statement_line_resolved: this line has already been resolved' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'ignore_reason_required: say why this line is not a premium payment' using errcode = 'P0001';
  end if;
  update tci.bank_statement_lines
     set status = 'ignored', ignore_reason = btrim(p_reason), resolved_by = auth.uid(), resolved_at = now()
   where id = p_line_id
  returning * into v_line;
  perform tci.begin_trusted_call();
  perform tci.sync_unmatched_payments_task(v_line.import_id);
  return v_line;
end;
$$;
revoke execute on function tci.ignore_bank_line(uuid, text) from public, anon;
grant execute on function tci.ignore_bank_line(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The integration point
-- ---------------------------------------------------------------------------
-- A bank or accounting feed posts its payments here with the SERVICE ROLE
-- key (from a server, never a browser):
--
--   select tci.record_premium_payment_import('{
--     "source": "accounting_import",          -- or "bank_import"
--     "file_name": "1C export 2026-10-22",    -- optional, shown on screen
--     "payments": [{
--       "external_id": "1C-000123",           -- required: replays never double
--       "value_date": "2026-10-21", "amount": 11250, "currency": "USD",
--       "invoice_number": "INV-TCI-2026-0002-04",   -- optional hints
--       "policy_number": "TCI-2026-0002",
--       "reference": "PP 512", "purpose": "...", "payer": "..."
--     }]}')
--
-- Confident matches are recorded at once (that is what an integration is
-- for); everything else waits in the same «unmatched payments» queue as a
-- file import. Each payment is answered: recorded, queued (with the line's
-- status) or duplicate. No connector is built here.

create function tci.require_service_role()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'not permitted: service role only' using errcode = '42501';
  end if;
end;
$$;
revoke execute on function tci.require_service_role() from public, anon, authenticated;
grant execute on function tci.require_service_role() to service_role;

create function tci.record_premium_payment_import(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source  tci.premium_payment_source;
  v_import  uuid;
  v_counts  jsonb;
  v_line    tci.bank_statement_lines%rowtype;
  v_refusal text;
  v_results jsonb := '[]'::jsonb;
  v_item    jsonb;
begin
  perform tci.require_service_role();

  begin
    v_source := coalesce(p_payload->>'source', 'accounting_import')::tci.premium_payment_source;
  exception when others then
    raise exception 'import_source_invalid: source is bank_import or accounting_import' using errcode = 'P0001';
  end;
  if v_source = 'manual' then
    raise exception 'import_source_invalid: source is bank_import or accounting_import' using errcode = 'P0001';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_payload->'payments', '[]'::jsonb))
  loop
    if nullif(btrim(v_item->>'external_id'), '') is null then
      raise exception 'external_id_required: every payment carries the sender''s own id' using errcode = 'P0001';
    end if;
  end loop;

  perform tci.begin_trusted_call();
  insert into tci.bank_statement_imports (source, file_name)
  values (v_source, nullif(btrim(p_payload->>'file_name'), ''))
  returning id into v_import;
  v_counts := tci.import_statement_lines(v_import, coalesce(p_payload->'payments', '[]'::jsonb));

  for v_line in
    select * from tci.bank_statement_lines where import_id = v_import order by line_no
  loop
    if v_line.status = 'matched' then
      v_refusal := tci.confirm_statement_line(v_line.id, v_line.match_policy_id);
      v_results := v_results || jsonb_build_object(
        'external_id', v_line.external_id, 'line_id', v_line.id,
        'result', case when v_refusal is null then 'recorded' else 'queued' end,
        'reason', coalesce(v_refusal, v_line.match_reason));
    else
      v_results := v_results || jsonb_build_object(
        'external_id', v_line.external_id, 'line_id', v_line.id,
        'result', case when v_line.status = 'duplicate' then 'duplicate' else 'queued' end,
        'reason', v_line.match_reason);
    end if;
  end loop;
  perform tci.sync_unmatched_payments_task(v_import);
  perform tci.emit_workflow_event('premium.statement_imported', 'bank_statement_import', v_import, v_counts);
  return jsonb_build_object('import_id', v_import, 'results', v_results);
end;
$$;
revoke execute on function tci.record_premium_payment_import(jsonb) from public, anon, authenticated;
grant execute on function tci.record_premium_payment_import(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 10. Direct writes on the schedule are closed
-- ---------------------------------------------------------------------------
-- Billing an instalment is tci.invoice_premium_instalment; payments are
-- functions; the schedule is generated. authenticated keeps only SELECT
-- (its old write policies are inert without a grant).
revoke all on tci.premium_instalments from authenticated;
grant select on tci.premium_instalments to authenticated;

-- ---------------------------------------------------------------------------
-- 11. refresh_agenda: the 0055 text (as on canonical), section (4) only
-- ---------------------------------------------------------------------------
-- The chasing tasks read the money: an instalment is chased while something
-- is still owed on it, the task shows what is owed, and it retires once the
-- instalment is settled (a payment also closes it at once as done - 7).

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

  -- (4) instalments falling due, and instalments already past due. Since
  -- 0056 an instalment is owed while it has an OUTSTANDING amount, whatever
  -- its billing status, and the task carries what is still owed.
  for v_row in
    select vi.id, vi.policy_id, vi.sequence, vi.due_date, vi.outstanding, vi.amount,
           vi.invoice_number, p.policy_number, p.currency_code
    from tci.v_premium_instalments vi
    join tci.policies p on p.id = vi.policy_id
    where vi.derived_status <> 'cancelled'
      and vi.outstanding > 0
      and vi.due_date <= current_date + 14
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
        'amount', v_row.outstanding,
        'scheduled', v_row.amount,
        'invoice_number', v_row.invoice_number,
        'currency', v_row.currency_code),
      'commercial_underwriter'::tci.user_role, null,
      v_row.due_date::timestamptz,
      case when v_row.due_date < current_date then 'high' else 'normal' end::tci.task_priority,
      null);
    v_opened := v_opened + 1;
  end loop;

  -- An open task follows what is still owed (a part payment lowers it).
  -- (The owed set is materialised once: the view's allocation is a window
  -- over each policy, which a per-task lookup would recompute.)
  with owed as materialized (
    select vi.id, vi.outstanding from tci.v_premium_instalments vi where vi.outstanding > 0
  )
  update tci.tasks t
     set params = t.params || jsonb_build_object('amount', owed.outstanding)
    from owed
   where t.task_type in ('instalment_due', 'instalment_overdue')
     and t.status = 'open'
     and owed.id = t.object_id
     and (t.params->>'amount')::numeric is distinct from owed.outstanding;

  with chased as materialized (
    select vi.id from tci.v_premium_instalments vi
     where vi.derived_status <> 'cancelled'
       and vi.outstanding > 0
       and vi.due_date <= current_date + 14
  )
  update tci.tasks t
     set status = 'cancelled', completed_at = now()
   where t.task_type in ('instalment_due', 'instalment_overdue')
     and t.status = 'open'
     and not exists (select 1 from chased c where c.id = t.object_id);

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
-- 12. Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_bad   text;
  v_y     int;
  v_m     int;
  v_d     int;
  v_inc   date;
  v_exp   date;
  v_freq  tci.declaration_frequency;
  v_n     int;
  v_due   date[];
  v_step  int;
  i       int;
begin
  -- 0027's own expectations still hold.
  if tci.premium_instalment_count(date '2025-01-01', date '2025-12-31', 'monthly') <> 12
     or tci.premium_instalment_count(date '2025-01-01', date '2025-12-31', 'quarterly') <> 4
     or tci.premium_instalment_count(date '2025-01-01', date '2025-01-20', 'monthly') <> 1
     or tci.premium_instalment_count(date '2025-01-01', date '2025-02-14', 'monthly') <> 2 then
    raise exception '0056: the 0027 schedule expectations no longer hold';
  end if;

  -- The bug itself: TCI-2026-0002's terms.
  if tci.premium_instalment_count(date '2026-05-23', date '2027-05-23', 'quarterly') <> 4 then
    raise exception '0056: an anniversary-to-anniversary quarterly year must bill 4 instalments';
  end if;

  -- Start days 23-31 of every month, in a common year and a leap year, both
  -- expiry conventions: always 12 monthly / 4 quarterly, due dates distinct,
  -- inside the period, and as many as the count.
  foreach v_freq in array array['monthly', 'quarterly']::tci.declaration_frequency[] loop
    v_step := case v_freq when 'monthly' then 1 else 3 end;
    foreach v_y in array array[2023, 2024, 2027, 2028] loop
      for v_m in 1 .. 12 loop
        for v_d in 23 .. 31 loop
          continue when v_d > extract(day from (make_date(v_y, v_m, 1) + interval '1 month - 1 day'));
          v_inc := make_date(v_y, v_m, v_d);
          foreach v_exp in array array[(v_inc + interval '1 year')::date, (v_inc + interval '1 year')::date - 1] loop
            v_n := tci.premium_instalment_count(v_inc, v_exp, v_freq);
            if v_n <> 12 / v_step then
              raise exception '0056: % policy % - % bills % instalments, not %', v_freq, v_inc, v_exp, v_n, 12 / v_step;
            end if;
            -- the generator's due dates (0027/0043): inception + i periods, clamped to the expiry
            v_due := '{}';
            for i in 1 .. v_n loop
              v_due := v_due || least((v_inc + make_interval(months => i * v_step))::date, v_exp);
            end loop;
            if (select count(distinct x) from unnest(v_due) x) <> v_n then
              raise exception '0056: % policy % - % has two instalments on one day: %', v_freq, v_inc, v_exp, v_due;
            end if;
          end loop;
          -- Non-whole periods: a year and a fortnight is one period more; half
          -- a year is 6 / 2; six weeks is 2 monthly / 1 quarterly.
          if tci.premium_instalment_count(v_inc, (v_inc + interval '1 year 15 days')::date, v_freq) <> 12 / v_step + 1
             or tci.premium_instalment_count(v_inc, (v_inc + interval '6 months')::date - 1, v_freq) <> 6 / v_step
             or tci.premium_instalment_count(v_inc, v_inc + 45, v_freq) <> (case v_freq when 'monthly' then 2 else 1 end) then
            raise exception '0056: % part-period count wrong for inception %', v_freq, v_inc;
          end if;
        end loop;
      end loop;
    end loop;
  end loop;

  -- The generator still computes due dates the way the check above assumes,
  -- and still refuses to replace billed instalments.
  if position('make_interval(months => i * 3)' in pg_get_functiondef('tci.generate_premium_instalments(uuid, boolean)'::regprocedure)) = 0
     or position('v_due > v_policy.expiry_date' in pg_get_functiondef('tci.generate_premium_instalments(uuid, boolean)'::regprocedure)) = 0
     or position('this policy already has invoiced or paid instalments' in pg_get_functiondef('tci.generate_premium_instalments(uuid, boolean)'::regprocedure)) = 0 then
    raise exception '0056: generate_premium_instalments is not the schedule this migration was checked against';
  end if;

  -- Every schedule in the database now satisfies the invariants.
  select string_agg(p.policy_number, ', ') into v_bad
    from tci.policies p
   where exists (select 1 from tci.premium_instalments i where i.policy_id = p.id)
     and (
       (select count(*) from tci.premium_instalments i where i.policy_id = p.id and i.status <> 'cancelled')
         <> tci.premium_instalment_count(p.inception_date, p.expiry_date, p.declaration_frequency)
       or (select sum(i.amount) from tci.premium_instalments i where i.policy_id = p.id and i.status <> 'cancelled')
         <> p.minimum_premium
       or exists (select 1 from tci.premium_instalments i where i.policy_id = p.id and i.status <> 'cancelled'
                   group by i.due_date having count(*) > 1)
     );
  if v_bad is not null then
    raise exception '0056: schedules still wrong: %', v_bad;
  end if;

  -- Money moved nowhere: every policy has received exactly what was marked
  -- paid before, and no policy is paid beyond its schedule.
  select string_agg(b.key, ', ') into v_bad
    from jsonb_each_text(current_setting('tci.m0056_paid_before')::jsonb) b
   where b.value::numeric <> coalesce((
           select sum(case pp.kind when 'payment' then pp.amount else -pp.amount end)
             from tci.premium_payments pp where pp.policy_id = b.key::uuid), 0);
  if v_bad is not null then
    raise exception '0056: payments do not equal what was paid before for policies %', v_bad;
  end if;
  if exists (
    select 1 from tci.v_policy_premium v
     where v.payments_total - v.reversals_total > v.instalments_total
  ) then
    raise exception '0056: a policy is paid beyond its schedule';
  end if;
  if exists (select 1 from tci.premium_instalments where status = 'paid') then
    raise exception '0056: a stored paid status survived';
  end if;

  -- Nobody writes payments, bank lines or the schedule directly.
  select string_agg(t || ':' || priv, ', ') into v_bad
    from unnest(array['premium_payments', 'premium_instalments', 'bank_statement_profiles',
                      'bank_statement_imports', 'bank_statement_lines']) t,
         unnest(array['insert', 'update', 'delete']) priv
   where has_table_privilege('authenticated', 'tci.' || t, priv)
      or has_table_privilege('anon', 'tci.' || t, priv);
  if v_bad is not null then
    raise exception '0056: direct writes left open: %', v_bad;
  end if;

  -- Every new SECURITY DEFINER function executable by authenticated opens
  -- with a gate; the integration point is the service role's alone; anon
  -- executes nothing new.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace and p.prosecdef
     and p.proname in ('record_premium_payment', 'reverse_premium_payment', 'invoice_premium_instalment',
                       'save_bank_statement_profile', 'import_bank_statement', 'confirm_bank_lines',
                       'assign_bank_line', 'ignore_bank_line', 'client_premium_instalments')
     and p.prosrc !~ 'tci\.require_role\(|tci\.has_role\(';
  if v_bad is not null then
    raise exception '0056: ungated: %', v_bad;
  end if;
  if has_function_privilege('authenticated', 'tci.record_premium_payment_import(jsonb)', 'execute')
     or not has_function_privilege('service_role', 'tci.record_premium_payment_import(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'tci.record_premium_payment_internal(uuid, tci.premium_payment_kind, numeric, text, date, text, tci.premium_payment_source, text, uuid, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'tci.confirm_statement_line(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'tci.import_statement_lines(uuid, jsonb)', 'execute') then
    raise exception '0056: the internal payment writers or the integration point are reachable by the wrong role';
  end if;
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
   where p.pronamespace = 'tci'::regnamespace and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (select proname from tci.pre_auth_entry_points());
  if v_bad is not null then
    raise exception '0056: anon can execute: %', v_bad;
  end if;

  -- The Agenda reads the money.
  if position('v_premium_instalments' in pg_get_functiondef('tci.refresh_agenda()'::regprocedure)) = 0 then
    raise exception '0056: refresh_agenda does not read v_premium_instalments';
  end if;
end
$$;
