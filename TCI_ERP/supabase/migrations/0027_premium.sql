-- What: the premium regime - tci.premium_basis on policies, the instalment
--       schedule (tci.premium_instalments), earned premium per accepted
--       declaration (tci.premium_entries) and tci.v_policy_premium.
-- Why:  Phase 4. A whole-turnover policy is priced twice: a minimum premium
--       paid in instalments through the year, and an adjustment at the end
--       once real turnover is known. Both have to be visible side by side or
--       nobody can tell what a policyholder actually owes.
--
-- Two rules the owner fixed, and they are the whole design:
--
--   * NO REFUND BELOW THE MINIMUM. If declared turnover earns less than the
--     minimum premium, the minimum stands and the adjustment is zero. The
--     insurer never pays money back for a quiet year.
--   * THE RATE IS RECORDED, NEVER RE-DERIVED. Each premium entry stores the
--     rate it used. A mid-term rate change applies to declarations accepted
--     after it, and history keeps the rate it was actually written at.

-- ---------------------------------------------------------------------------
-- 1. Enums and the policy column
-- ---------------------------------------------------------------------------

create type tci.premium_basis as enum (
  -- Instalments of the minimum through the year, then an adjustment upward.
  'minimum_with_adjustment',
  -- The policyholder simply pays what the declarations earn.
  'as_declared'
);

create type tci.premium_instalment_status as enum (
  'pending',    -- scheduled, not yet billed - the only editable state
  'invoiced',   -- billed to the policyholder
  'paid',
  'cancelled'
);

alter table tci.policies
  add column premium_basis tci.premium_basis not null default 'minimum_with_adjustment';

comment on column tci.policies.premium_basis is
  'minimum_with_adjustment: instalments of the minimum, then a top-up if turnover earns more. as_declared: the policyholder pays what the declarations earn.';

-- ---------------------------------------------------------------------------
-- 2. Instalments
-- ---------------------------------------------------------------------------

create table tci.premium_instalments (
  id          uuid primary key default gen_random_uuid(),
  policy_id   uuid not null references tci.policies (id) on delete cascade,
  sequence    int not null check (sequence >= 1),
  due_date    date not null,
  amount      numeric(18,2) not null check (amount >= 0),
  status      tci.premium_instalment_status not null default 'pending',
  paid_at     timestamptz,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint premium_instalments_sequence_uq unique (policy_id, sequence),
  constraint premium_instalments_paid_recorded check (
    (status = 'paid') = (paid_at is not null)
  )
);

create index premium_instalments_policy_idx on tci.premium_instalments (policy_id, sequence);
create index premium_instalments_due_idx on tci.premium_instalments (due_date)
  where status in ('pending', 'invoiced');

comment on table tci.premium_instalments is
  'Schedule of the minimum premium across the policy period. Generated when the policy is created; editable only while pending.';

-- Once an instalment has been billed, its amount and date are part of a
-- document the policyholder holds. Changing them silently would put the two
-- sides out of step, so the database refuses.
create function tci.guard_instalment_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'pending'
     and (new.amount is distinct from old.amount
          or new.due_date is distinct from old.due_date
          or new.sequence is distinct from old.sequence) then
    raise exception
      'an instalment can only be re-dated or re-priced while it is pending (this one is %)',
      old.status using errcode = 'P0001';
  end if;

  if new.status = 'paid' and new.paid_at is null then
    new.paid_at := now();
  elsif new.status <> 'paid' then
    new.paid_at := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger premium_instalments_guard_edit
  before update on tci.premium_instalments
  for each row execute function tci.guard_instalment_edit();

-- How many instalments a policy period carries at its declaration frequency,
-- and where they fall. Pure, so the frontend can show the schedule it is
-- about to generate before anyone commits to it.
create function tci.premium_instalment_count(
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
  -- The policy period is INCLUSIVE of the expiry date, so its length is
  -- age(expiry + 1 day, inception). Measuring to the expiry date itself makes
  -- a 1 Jan - 31 Dec policy 11 months and 30 days, and it would bill eleven
  -- monthly instalments for a full year.
  with span as (select age(p_expiry + 1, p_inception) as a)
  select greatest(
    1,
    case p_frequency
      when 'monthly' then
        (extract(year from a) * 12 + extract(month from a))::int
        -- A part month is still a month to bill.
        + case when extract(day from a) > 0 then 1 else 0 end
      when 'quarterly' then
        ceil((
          (extract(year from a) * 12 + extract(month from a))::numeric
          + case when extract(day from a) > 0 then 1 else 0 end
        ) / 3.0)::int
    end
  )
  from span
$$;

comment on function tci.premium_instalment_count(date, date, tci.declaration_frequency) is
  'Instalments in a policy period at its declaration frequency. At least one, so a short policy still bills its minimum once.';

-- Generation. The last instalment absorbs the rounding remainder, so the
-- schedule sums to the minimum premium EXACTLY rather than to within a tiyin.
create function tci.generate_premium_instalments(
  p_policy_id uuid,
  p_replace   boolean default false
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy   tci.policies%rowtype;
  v_count    int;
  v_each     numeric(18,2);
  v_running  numeric(18,2) := 0;
  v_amount   numeric(18,2);
  v_due      date;
  i          int;
begin
  select * into v_policy from tci.policies where id = p_policy_id;
  if not found then
    raise exception 'policy not found' using errcode = 'P0002';
  end if;

  if exists (select 1 from tci.premium_instalments where policy_id = p_policy_id) then
    if not p_replace then
      return 0;
    end if;
    -- Only ever discard what has not been billed. An invoiced or paid
    -- instalment is a fact about money and is never regenerated away.
    if exists (
      select 1 from tci.premium_instalments
       where policy_id = p_policy_id and status in ('invoiced', 'paid')
    ) then
      raise exception 'this policy already has invoiced or paid instalments'
        using errcode = 'P0001';
    end if;
    delete from tci.premium_instalments where policy_id = p_policy_id;
  end if;

  v_count := tci.premium_instalment_count(
    v_policy.inception_date, v_policy.expiry_date, v_policy.declaration_frequency);
  v_each := round(v_policy.minimum_premium / v_count, 2);

  for i in 1 .. v_count loop
    v_due := case v_policy.declaration_frequency
               when 'monthly'   then v_policy.inception_date + make_interval(months => i)
               when 'quarterly' then v_policy.inception_date + make_interval(months => i * 3)
             end;
    -- Never bill past the end of the policy period.
    if v_due > v_policy.expiry_date then
      v_due := v_policy.expiry_date;
    end if;

    if i = v_count then
      v_amount := v_policy.minimum_premium - v_running;
    else
      v_amount := v_each;
    end if;
    v_running := v_running + v_amount;

    insert into tci.premium_instalments (policy_id, sequence, due_date, amount)
    values (p_policy_id, i, v_due, v_amount);
  end loop;

  return v_count;
end;
$$;

-- The schedule belongs to the POLICY, not to the act of binding, so it is
-- generated wherever a policy comes into existence: tci.bind_insurance_request
-- inserts one, and commercial underwriting can create one directly. A trigger
-- covers both without either path having to remember.
create function tci.generate_instalments_on_policy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform tci.generate_premium_instalments(new.id, false);
  return null;
end;
$$;

create trigger policies_generate_instalments
  after insert on tci.policies
  for each row execute function tci.generate_instalments_on_policy();

-- ---------------------------------------------------------------------------
-- 3. Earned premium
-- ---------------------------------------------------------------------------

create table tci.premium_entries (
  id             uuid primary key default gen_random_uuid(),
  declaration_id uuid not null references tci.declarations (id) on delete cascade,
  policy_id      uuid not null references tci.policies (id) on delete cascade,
  -- The premium base, copied from the declaration at acceptance. Not a join:
  -- if a limit is revoked next week the historic base must not move.
  covered_turnover numeric(18,2) not null,
  rate_used      numeric(6,4) not null,
  amount         numeric(18,2) not null,
  currency_code  char(3) not null references tci.currencies (code),
  computed_at    timestamptz not null default now(),

  constraint premium_entries_one_per_declaration unique (declaration_id)
);

create index premium_entries_policy_idx on tci.premium_entries (policy_id, computed_at);

comment on table tci.premium_entries is
  'Premium earned by an accepted declaration: covered turnover x the rate in force at acceptance. Immutable - a rate change never rewrites history.';
comment on column tci.premium_entries.rate_used is
  'The policy premium rate at the moment of acceptance, as a percentage. Recorded so a mid-term rate change cannot restate earlier periods.';

-- Acceptance now also earns the premium. Everything above the marked block is
-- unchanged from 0026; the entry is written from the split this function has
-- just frozen, so the two can never disagree.
create or replace function tci.accept_declaration(p_declaration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dec tci.declarations%rowtype;
  v_policy tci.policies%rowtype;
  v_covered numeric(18,2);
  v_amount numeric(18,2);
begin
  if not tci.has_role('commercial_underwriter', 'admin') then
    raise exception 'only commercial underwriting may accept a declaration'
      using errcode = 'P0004';
  end if;

  select * into v_dec from tci.declarations where id = p_declaration_id;
  if not found then
    raise exception 'declaration not found' using errcode = 'P0002';
  end if;
  if not tci.declaration_transition_allowed(v_dec.status, 'accepted') then
    raise exception 'a declaration cannot go from % to accepted', v_dec.status
      using errcode = 'P0001';
  end if;

  select * into v_policy from tci.policies where id = v_dec.policy_id;

  -- Freeze the split exactly as it stands now.
  -- The classification is computed in a subquery over its OWN alias and then
  -- joined back by id: an UPDATE ... FROM LATERAL cannot reference the row
  -- being updated, which is what a lateral over `l` would need.
  update tci.declaration_lines l
     set coverage_basis   = c.coverage_basis,
         covered_amount   = c.covered_amount,
         uncovered_excess = c.uncovered_excess,
         updated_at       = now()
    from (
      select src.id,
             cl.coverage_basis,
             cl.covered_amount,
             cl.uncovered_excess
        from tci.declaration_lines src
        cross join lateral tci.classify_declaration_line(
               tci.buyer_has_effective_limit(v_dec.policy_id, src.entity_id),
               src.insurable_turnover,
               v_policy.discretionary_limit
             ) cl
       where src.declaration_id = p_declaration_id
    ) c
   where l.id = c.id;

  update tci.declarations
     set status = 'accepted',
         accepted_by = (select auth.uid()),
         accepted_at = now(),
         updated_at = now()
   where id = p_declaration_id
   returning * into v_dec;

  -- ---- new in 0027: earn the premium -------------------------------------
  -- Premium is earned on COVERED turnover only. Uncovered excess was never
  -- insured, so charging for it would be charging for nothing.
  select coalesce(sum(covered_amount), 0) into v_covered
    from tci.declaration_lines where declaration_id = p_declaration_id;

  v_amount := round(v_covered * v_policy.premium_rate_pct / 100.0, 2);

  insert into tci.premium_entries (
    declaration_id, policy_id, covered_turnover, rate_used, amount, currency_code
  ) values (
    p_declaration_id, v_dec.policy_id, v_covered,
    v_policy.premium_rate_pct, v_amount, v_dec.currency_code
  );
  -- ------------------------------------------------------------------------

  perform tci.emit_workflow_event(
    'declaration.accepted', 'declaration', v_dec.id,
    jsonb_build_object(
      'policy_id', v_dec.policy_id,
      'period_start', v_dec.period_start,
      'premium', v_amount),
    'sales'::tci.user_role);

  -- Shipping outside cover is a commercial conversation, so it is reported
  -- as its own event rather than buried in the acceptance.
  if exists (
    select 1 from tci.v_declaration_lines v
     where v.declaration_id = p_declaration_id
       and v.coverage_basis = 'uncovered_excess'
  ) then
    perform tci.emit_workflow_event(
      'declaration.uncovered_excess', 'declaration', v_dec.id,
      jsonb_build_object(
        'policy_id', v_dec.policy_id,
        'uncovered_excess', (select uncovered_excess from tci.v_declaration_totals
                              where declaration_id = p_declaration_id)),
      'commercial_underwriter'::tci.user_role);
  end if;

  return jsonb_build_object(
    'result', 'accepted', 'declaration_id', v_dec.id, 'premium', v_amount);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The policy premium picture
-- ---------------------------------------------------------------------------

create view tci.v_policy_premium
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
  -- The adjustment rule, in one place. earned - minimum when positive; zero
  -- otherwise. There is NO refund below the minimum: a quiet year still costs
  -- the minimum premium, and the insurer never pays money back.
  greatest(coalesce(e.earned_premium, 0) - p.minimum_premium, 0) as adjustment_amount,
  -- What the policyholder owes for the period as a whole.
  case p.premium_basis
    when 'minimum_with_adjustment'
      then greatest(coalesce(e.earned_premium, 0), p.minimum_premium)
    when 'as_declared'
      then coalesce(e.earned_premium, 0)
  end as premium_due_total,
  -- True once the period is over and the adjustment can be billed.
  (p.expiry_date < current_date) as period_closed
from tci.policies p
left join lateral (
  select
    sum(pi.amount) filter (where pi.status <> 'cancelled')                as instalment_total,
    count(*) filter (where pi.status <> 'cancelled')::int                 as instalment_count,
    sum(pi.amount) filter (where pi.status = 'invoiced')                  as invoiced_total,
    sum(pi.amount) filter (where pi.status = 'paid')                      as paid_total,
    sum(pi.amount) filter (
      where pi.status in ('pending', 'invoiced') and pi.due_date < current_date) as overdue_total,
    min(pi.due_date) filter (where pi.status in ('pending', 'invoiced'))  as next_due_date
  from tci.premium_instalments pi
  where pi.policy_id = p.id
) i on true
left join lateral (
  select sum(pe.amount) as earned_premium, count(*)::int as entry_count
  from tci.premium_entries pe
  where pe.policy_id = p.id
) e on true;

comment on view tci.v_policy_premium is
  'Per policy: the minimum and its instalments, cumulative earned premium, and the end-of-period adjustment. adjustment_amount is greatest(earned - minimum, 0) - there is no refund below the minimum premium.';

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------

alter table tci.premium_instalments enable row level security;
alter table tci.premium_entries enable row level security;

create policy "premium_instalments: staff read"
  on tci.premium_instalments for select to authenticated
  using (tci.is_staff());

create policy "premium_instalments: commercial writes"
  on tci.premium_instalments for insert to authenticated
  with check (tci.has_role('commercial_underwriter', 'admin'));

create policy "premium_instalments: commercial updates"
  on tci.premium_instalments for update to authenticated
  using (tci.has_role('commercial_underwriter', 'admin'))
  with check (tci.has_role('commercial_underwriter', 'admin'));

create policy "premium_instalments: commercial deletes"
  on tci.premium_instalments for delete to authenticated
  using (tci.has_role('commercial_underwriter', 'admin'));

-- Premium entries are written by tci.accept_declaration and by nothing else.
-- There is deliberately no insert or update policy: earned premium is a
-- consequence of an accepted declaration, never something typed in.
create policy "premium_entries: staff read"
  on tci.premium_entries for select to authenticated
  using (tci.is_staff());

grant select, insert, update, delete on tci.premium_instalments to authenticated;
grant select on tci.premium_entries to authenticated;
grant select on tci.v_policy_premium to authenticated;
grant all on tci.premium_instalments, tci.premium_entries to service_role;

grant execute on function tci.premium_instalment_count(date, date, tci.declaration_frequency) to authenticated;
grant execute on function tci.generate_premium_instalments(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Assertions
-- ---------------------------------------------------------------------------

do $$
begin
  -- The real shape of a one-year policy: inception 1 Jan, expiry 31 Dec.
  if tci.premium_instalment_count(date '2025-01-01', date '2025-12-31', 'monthly') <> 12 then
    raise exception 'a one-year monthly policy must bill 12 instalments, got %',
      tci.premium_instalment_count(date '2025-01-01', date '2025-12-31', 'monthly');
  end if;
  if tci.premium_instalment_count(date '2025-01-01', date '2025-12-31', 'quarterly') <> 4 then
    raise exception 'a one-year quarterly policy must bill 4 instalments, got %',
      tci.premium_instalment_count(date '2025-01-01', date '2025-12-31', 'quarterly');
  end if;
  -- A policy shorter than one period still bills its minimum once.
  if tci.premium_instalment_count(date '2025-01-01', date '2025-01-20', 'monthly') <> 1 then
    raise exception 'a sub-monthly policy must still bill once, got %',
      tci.premium_instalment_count(date '2025-01-01', date '2025-01-20', 'monthly');
  end if;
  -- A part month is still a month to bill.
  if tci.premium_instalment_count(date '2025-01-01', date '2025-02-14', 'monthly') <> 2 then
    raise exception 'a six-week policy must bill twice, got %',
      tci.premium_instalment_count(date '2025-01-01', date '2025-02-14', 'monthly');
  end if;
end
$$;
