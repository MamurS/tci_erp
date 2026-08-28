-- What: coverage verification - tci.limit_in_force_at (point-in-time limit
--       reconstruction), the reason-code catalogue, tci.claim_invoice_verdicts
--       and the recompute/override entry points.
-- Why:  Phase 5. Whether a claim is covered is not a matter of opinion: it is
--       a function of what the policyholder could rely on WHEN THE GOODS
--       SHIPPED. Three properties this migration exists to guarantee:
--
--   * POINT IN TIME, NOT CURRENT STATE. tci.credit_limit_decisions records
--     `lifecycle` but never WHEN a decision was superseded, so the supersede
--     chain cannot be read backwards from lifecycle. The in-force decision is
--     therefore RECONSTRUCTED from the moment each decision became something
--     the policyholder could act on - released_at, or decided_at plus the
--     sales window when silent consent released it - and the latest one at or
--     before the shipment date wins. A limit revoked today does not retract
--     cover for goods shipped last month, and an increase granted today does
--     not retroactively cover them either.
--   * REASONS ARE CODES. Every verdict carries tci.coverage_reason[] plus the
--     numbers behind it in a jsonb detail. No sentence is ever stored: the UI
--     renders the codes in the viewer's language.
--   * AN OVERRIDE NEVER OVERWRITES. The system verdict and the human verdict
--     live in separate columns of the same row. Recomputation rewrites only
--     the system half; the override, its justification and its author survive
--     and stay visible beside what the machine said.

-- ---------------------------------------------------------------------------
-- 1. The point-in-time limit
-- ---------------------------------------------------------------------------

create function tci.decision_effective_from(
  p_released_at timestamptz,
  p_decided_at  timestamptz,
  p_held        boolean
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when p_released_at is not null then p_released_at
    -- Held and never released: the policyholder was never told, so it never
    -- became something they could rely on.
    when p_held then null
    else p_decided_at + make_interval(hours => tci.sales_window_hours())
  end
$$;

comment on function tci.decision_effective_from(timestamptz, timestamptz, boolean) is
  'When a decision became relied-upon by the policyholder: its release, or silent consent at decided_at + the sales window. NULL while it is held.';

create function tci.limit_in_force_at(
  p_policy_id uuid,
  p_entity_id uuid,
  p_on        date
)
returns table (
  decision_id       uuid,
  request_id        uuid,
  outcome           tci.decision_outcome,
  approved_amount   numeric,
  currency_code     char(3),
  payment_terms_days int,
  stage             tci.decision_stage,
  effective_from    timestamptz,
  valid_from        date,
  valid_until       date,
  system_generated  boolean,
  system_reason_key text,
  within_validity   boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.id, d.request_id, d.outcome, d.approved_amount, d.currency_code,
    d.payment_terms_days, d.stage,
    tci.decision_effective_from(d.released_at, d.decided_at, d.held),
    d.valid_from, d.valid_until, d.system_generated, d.system_reason_key,
    (d.valid_from <= p_on and (d.valid_until is null or d.valid_until >= p_on))
  from tci.credit_limit_decisions d
  join tci.credit_limit_requests r on r.id = d.request_id
  where r.entity_id = p_entity_id
    and r.policy_id = p_policy_id
    and tci.decision_effective_from(d.released_at, d.decided_at, d.held) is not null
    and tci.decision_effective_from(d.released_at, d.decided_at, d.held)::date <= p_on
  -- The last thing said before that date wins. The commercial tiebreak mirrors
  -- v_effective_limits: a commercial adjustment made at the same instant as
  -- its credit parent is the one that reached the client.
  order by tci.decision_effective_from(d.released_at, d.decided_at, d.held) desc,
           (d.stage = 'commercial') desc,
           d.decided_at desc
  limit 1
$$;

comment on function tci.limit_in_force_at(uuid, uuid, date) is
  'The credit decision the policyholder could rely on for this buyer under this policy on this date, reconstructed from the decision history. Ignores lifecycle, which records no supersede time.';

revoke execute on function tci.limit_in_force_at(uuid, uuid, date) from public, anon;
grant execute on function tci.limit_in_force_at(uuid, uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Verdicts and reason codes
-- ---------------------------------------------------------------------------

create type tci.coverage_verdict as enum ('covered', 'partial', 'not_covered');

create type tci.coverage_reason as enum (
  -- Positive
  'covered_by_limit',        -- an approved limit was in force and sufficient
  'covered_by_dl',           -- no approved limit; inside the discretionary limit
  -- Quantitative shortfalls (produce `partial`)
  'limit_exceeded',          -- cumulative balance ran past the limit in force
  'dl_exceeded',             -- cumulative balance ran past the discretionary limit
  -- The limit itself
  'no_limit_in_force',       -- nothing in force on the shipment date, and no DL cover
  'limit_declined',          -- the decision in force refused the buyer
  'limit_revoked',           -- revoked or suspended before the goods shipped
  'limit_not_yet_valid',     -- a decision existed but its validity began later
  'limit_expired',           -- its validity had ended by the shipment date
  -- Policy conditions
  'payment_terms_exceeded',  -- credit period longer than max_payment_terms_days
  'shipment_before_inception',
  'shipment_after_expiry',
  -- Reporting duties
  'noa_late',                -- the overdue account was notified past the deadline
  'noa_missing',             -- no overdue notification at all
  -- Nothing to claim
  'nothing_outstanding'
);

comment on type tci.coverage_reason is
  'Machine-readable coverage reason codes. Stored on the verdict with the numbers in system_detail; rendered by the UI in three languages, never stored as text.';

create table tci.claim_invoice_verdicts (
  id               uuid primary key default gen_random_uuid(),
  claim_invoice_id uuid not null unique references tci.claim_invoices (id) on delete cascade,
  claim_id         uuid not null references tci.claims (id) on delete cascade,

  -- What the engine decided. Rewritten on every recompute.
  system_verdict        tci.coverage_verdict not null,
  system_covered_amount numeric(18,2) not null check (system_covered_amount >= 0),
  system_reasons        tci.coverage_reason[] not null default '{}',
  -- The numbers the codes stand on: limit in force, decision id, balance
  -- before this invoice, the granted credit period, and so on.
  system_detail         jsonb not null default '{}'::jsonb,
  computed_at           timestamptz not null default now(),

  -- What a human decided instead. Never touched by a recompute.
  override_verdict        tci.coverage_verdict,
  override_covered_amount numeric(18,2) check (override_covered_amount >= 0),
  override_justification  text,
  overridden_by           uuid references auth.users (id),
  overridden_at           timestamptz,

  -- What actually counts.
  effective_verdict tci.coverage_verdict
    generated always as (coalesce(override_verdict, system_verdict)) stored,
  effective_covered_amount numeric(18,2)
    generated always as (coalesce(override_covered_amount, system_covered_amount)) stored,

  constraint verdicts_override_justified check (
    override_verdict is null
    or (coalesce(trim(override_justification), '') <> ''
        and overridden_by is not null and overridden_at is not null)
  )
);

comment on table tci.claim_invoice_verdicts is
  'One row per claim invoice. The system verdict and any human override sit side by side; recomputation rewrites only the system half, so an override is never silently lost.';
comment on column tci.claim_invoice_verdicts.effective_covered_amount is
  'The amount the indemnity calculation uses: the override when there is one, otherwise what the engine computed.';

create index claim_invoice_verdicts_claim_idx on tci.claim_invoice_verdicts (claim_id);

-- ---------------------------------------------------------------------------
-- 3. The engine
-- ---------------------------------------------------------------------------
-- Recomputes the SYSTEM half for every invoice of a claim. Invoices are walked
-- in shipment order with a running balance, because a credit limit caps the
-- OUTSTANDING BALANCE, not each invoice on its own: the third shipment is the
-- one that breaks a limit two shipments have already half-filled.

create function tci.verify_claim_coverage(p_claim_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim   tci.claims%rowtype;
  v_policy  tci.policies%rowtype;
  v_noa     record;
  v_inv     record;
  v_lim     record;
  v_balance numeric(18,2) := 0;      -- cumulative claimable debt before this invoice
  v_cap     numeric(18,2);           -- the ceiling that applies to this invoice
  v_headroom numeric(18,2);
  v_covered numeric(18,2);
  v_reasons tci.coverage_reason[];
  v_verdict tci.coverage_verdict;
  v_detail  jsonb;
  v_basis   text;
  v_noa_late boolean := false;
  v_noa_missing boolean := false;
begin
  select * into v_claim from tci.claims where id = p_claim_id;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  select * into v_policy from tci.policies where id = v_claim.policy_id;

  -- Reporting duty, judged once for the whole claim and stamped on every line
  -- so a verdict is readable on its own.
  if v_claim.overdue_notification_id is null then
    v_noa_missing := (v_claim.cause_of_loss = 'protracted_default');
  else
    select reported_late into v_noa_late
      from tci.v_overdue_notifications where id = v_claim.overdue_notification_id;
    v_noa_late := coalesce(v_noa_late, false);
  end if;

  for v_inv in
    select * from tci.claim_invoices
     where claim_id = p_claim_id
     order by shipment_date, due_date, invoice_number
  loop
    v_reasons := '{}';
    v_basis   := null;
    v_covered := 0;
    v_cap     := null;

    select * into v_lim
      from tci.limit_in_force_at(v_claim.policy_id, v_claim.entity_id, v_inv.shipment_date);

    if coalesce(v_inv.claimable_amount, 0) <= 0 then
      v_reasons := v_reasons || 'nothing_outstanding'::tci.coverage_reason;
    else
      -- Which ceiling applies, and is there a ceiling at all?
      if v_lim.decision_id is null then
        v_basis := 'discretionary';
        v_cap   := coalesce(v_policy.discretionary_limit, 0);
      elsif v_lim.outcome = 'revoked' then
        v_reasons := v_reasons || 'limit_revoked'::tci.coverage_reason;
        v_basis := 'none'; v_cap := 0;
      elsif v_lim.outcome = 'declined' then
        v_reasons := v_reasons || 'limit_declined'::tci.coverage_reason;
        -- A refused buyer falls back to the discretionary limit only if the
        -- policyholder could still have self-assessed - they could not, they
        -- had been told no. Cover stops.
        v_basis := 'none'; v_cap := 0;
      elsif not v_lim.within_validity then
        if v_inv.shipment_date < v_lim.valid_from then
          v_reasons := v_reasons || 'limit_not_yet_valid'::tci.coverage_reason;
        else
          v_reasons := v_reasons || 'limit_expired'::tci.coverage_reason;
        end if;
        -- An expired limit leaves the buyer where an unassessed buyer stands.
        v_basis := 'discretionary';
        v_cap   := coalesce(v_policy.discretionary_limit, 0);
      else
        v_basis := 'limit';
        v_cap   := coalesce(v_lim.approved_amount, 0);
      end if;

      v_headroom := greatest(v_cap - v_balance, 0);
      v_covered  := least(v_inv.claimable_amount, v_headroom);

      if v_basis = 'limit' then
        if v_covered >= v_inv.claimable_amount then
          v_reasons := v_reasons || 'covered_by_limit'::tci.coverage_reason;
        else
          v_reasons := v_reasons || 'limit_exceeded'::tci.coverage_reason;
        end if;
      elsif v_basis = 'discretionary' then
        if v_cap <= 0 then
          v_reasons := v_reasons || 'no_limit_in_force'::tci.coverage_reason;
        elsif v_covered >= v_inv.claimable_amount then
          v_reasons := v_reasons || 'covered_by_dl'::tci.coverage_reason;
        else
          v_reasons := v_reasons || 'dl_exceeded'::tci.coverage_reason;
        end if;
      end if;

      -- Hard policy conditions. Each of these takes cover away entirely: they
      -- are breaches of the contract, not shortfalls of amount.
      if v_inv.payment_terms_days > v_policy.max_payment_terms_days then
        v_reasons := v_reasons || 'payment_terms_exceeded'::tci.coverage_reason;
        v_covered := 0;
      end if;
      if v_inv.shipment_date < v_policy.inception_date then
        v_reasons := v_reasons || 'shipment_before_inception'::tci.coverage_reason;
        v_covered := 0;
      end if;
      if v_inv.shipment_date > v_policy.expiry_date then
        v_reasons := v_reasons || 'shipment_after_expiry'::tci.coverage_reason;
        v_covered := 0;
      end if;
    end if;

    -- Reporting duty. Flagged on every line, and prejudicial: an unreported or
    -- late-reported overdue account is a breach of the notification condition.
    if v_noa_missing then
      v_reasons := v_reasons || 'noa_missing'::tci.coverage_reason;
      v_covered := 0;
    elsif v_noa_late then
      v_reasons := v_reasons || 'noa_late'::tci.coverage_reason;
      v_covered := 0;
    end if;

    v_verdict := case
      when v_covered <= 0 then 'not_covered'::tci.coverage_verdict
      when v_covered >= v_inv.claimable_amount then 'covered'::tci.coverage_verdict
      else 'partial'::tci.coverage_verdict
    end;

    v_detail := jsonb_build_object(
      'basis', v_basis,
      'cap', v_cap,
      'balance_before', v_balance,
      'headroom', v_headroom,
      'claimable_amount', v_inv.claimable_amount,
      'payment_terms_days', v_inv.payment_terms_days,
      'max_payment_terms_days', v_policy.max_payment_terms_days,
      'shipment_date', v_inv.shipment_date,
      'policy_inception', v_policy.inception_date,
      'policy_expiry', v_policy.expiry_date,
      'discretionary_limit', v_policy.discretionary_limit,
      'decision_id', v_lim.decision_id,
      'decision_outcome', v_lim.outcome,
      'decision_amount', v_lim.approved_amount,
      'decision_effective_from', v_lim.effective_from,
      'decision_valid_from', v_lim.valid_from,
      'decision_valid_until', v_lim.valid_until,
      'decision_system_generated', v_lim.system_generated,
      'decision_system_reason_key', v_lim.system_reason_key);

    insert into tci.claim_invoice_verdicts as v (
      claim_invoice_id, claim_id, system_verdict, system_covered_amount,
      system_reasons, system_detail, computed_at
    ) values (
      v_inv.id, p_claim_id, v_verdict, v_covered, v_reasons, v_detail, now()
    )
    on conflict (claim_invoice_id) do update
      set system_verdict = excluded.system_verdict,
          system_covered_amount = excluded.system_covered_amount,
          system_reasons = excluded.system_reasons,
          system_detail = excluded.system_detail,
          computed_at = excluded.computed_at;
          -- The override columns are deliberately absent from this list.

    -- The balance is the DEBT, not the covered part: an uninsured shipment
    -- still fills the buyer's limit.
    v_balance := v_balance + greatest(coalesce(v_inv.claimable_amount, 0), 0);
  end loop;

  -- Verdicts for invoices that have since been deleted have no meaning.
  delete from tci.claim_invoice_verdicts v
   where v.claim_id = p_claim_id
     and not exists (select 1 from tci.claim_invoices i where i.id = v.claim_invoice_id);
end;
$$;

comment on function tci.verify_claim_coverage(uuid) is
  'Recomputes the SYSTEM verdict for every invoice of a claim, walking them in shipment order against the limit in force at each shipment date. Never touches an override.';

revoke execute on function tci.verify_claim_coverage(uuid) from public, anon;
grant execute on function tci.verify_claim_coverage(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Overriding
-- ---------------------------------------------------------------------------

create function tci.override_claim_verdict(
  p_claim_invoice_id uuid,
  p_verdict          tci.coverage_verdict,
  p_covered_amount   numeric,
  p_justification    text
)
returns tci.claim_invoice_verdicts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row tci.claim_invoice_verdicts%rowtype;
  v_inv tci.claim_invoices%rowtype;
  v_claim tci.claims%rowtype;
begin
  if not tci.has_role('claims', 'admin') then
    raise exception 'only the claims department may override a coverage verdict'
      using errcode = 'P0004';
  end if;
  if coalesce(trim(coalesce(p_justification, '')), '') = '' then
    raise exception 'an override needs a justification on the record'
      using errcode = 'P0001';
  end if;

  select * into v_inv from tci.claim_invoices where id = p_claim_invoice_id;
  if not found then
    raise exception 'claim invoice not found' using errcode = 'P0002';
  end if;
  select * into v_claim from tci.claims where id = v_inv.claim_id;
  if v_claim.status in ('paid', 'closed', 'withdrawn') then
    raise exception 'this claim is % and can no longer be reassessed', v_claim.status
      using errcode = 'P0001';
  end if;
  if coalesce(p_covered_amount, 0) > coalesce(v_inv.claimable_amount, 0) then
    raise exception 'the covered amount cannot exceed what is claimable on the invoice'
      using errcode = 'P0001';
  end if;
  if p_verdict = 'not_covered' and coalesce(p_covered_amount, 0) <> 0 then
    raise exception 'a not_covered verdict covers nothing' using errcode = 'P0001';
  end if;

  update tci.claim_invoice_verdicts
     set override_verdict = p_verdict,
         override_covered_amount = coalesce(p_covered_amount, 0),
         override_justification = trim(p_justification),
         overridden_by = (select auth.uid()),
         overridden_at = now()
   where claim_invoice_id = p_claim_invoice_id
   returning * into v_row;
  if not found then
    raise exception 'this invoice has no verdict yet - verify the claim first'
      using errcode = 'P0001';
  end if;

  perform tci.emit_workflow_event(
    'claim.verdict_overridden', 'claim', v_inv.claim_id,
    jsonb_build_object(
      'claim_invoice_id', p_claim_invoice_id,
      'invoice_number', v_inv.invoice_number,
      'system_verdict', v_row.system_verdict,
      'system_covered_amount', v_row.system_covered_amount,
      'override_verdict', p_verdict,
      'override_covered_amount', coalesce(p_covered_amount, 0)),
    'claims'::tci.user_role);

  return v_row;
end;
$$;

create function tci.clear_claim_verdict_override(p_claim_invoice_id uuid)
returns tci.claim_invoice_verdicts
language plpgsql
security definer
set search_path = ''
as $$
declare v_row tci.claim_invoice_verdicts%rowtype;
begin
  if not tci.has_role('claims', 'admin') then
    raise exception 'only the claims department may clear an override'
      using errcode = 'P0004';
  end if;
  update tci.claim_invoice_verdicts
     set override_verdict = null, override_covered_amount = null,
         override_justification = null, overridden_by = null, overridden_at = null
   where claim_invoice_id = p_claim_invoice_id
   returning * into v_row;
  if not found then
    raise exception 'verdict not found' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke execute on function tci.override_claim_verdict(uuid, tci.coverage_verdict, numeric, text) from public, anon;
grant execute on function tci.override_claim_verdict(uuid, tci.coverage_verdict, numeric, text) to authenticated, service_role;
revoke execute on function tci.clear_claim_verdict_override(uuid) from public, anon;
grant execute on function tci.clear_claim_verdict_override(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The view the assessment screen reads
-- ---------------------------------------------------------------------------

create view tci.v_claim_invoice_coverage
with (security_invoker = true) as
select
  i.id                as claim_invoice_id,
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
  v.id                as verdict_id,
  v.system_verdict,
  v.system_covered_amount,
  v.system_reasons,
  v.system_detail,
  v.computed_at,
  v.override_verdict,
  v.override_covered_amount,
  v.override_justification,
  v.overridden_by,
  v.overridden_at,
  v.effective_verdict,
  v.effective_covered_amount,
  (v.override_verdict is not null) as is_overridden
from tci.claim_invoices i
left join tci.claim_invoice_verdicts v on v.claim_invoice_id = i.id;

comment on view tci.v_claim_invoice_coverage is
  'Claim invoices with their coverage verdicts. system_* is what the engine said, override_* what a human said instead, effective_* what the indemnity uses.';

grant select on tci.v_claim_invoice_coverage to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------

alter table tci.claim_invoice_verdicts enable row level security;

create policy "claim_invoice_verdicts: staff read"
  on tci.claim_invoice_verdicts for select to authenticated using (tci.is_staff());
-- Written only through tci.verify_claim_coverage and the override functions.
create policy "claim_invoice_verdicts: claims write"
  on tci.claim_invoice_verdicts for all to authenticated
  using (tci.has_role('claims', 'admin'))
  with check (tci.has_role('claims', 'admin'));

grant select, insert, update, delete on tci.claim_invoice_verdicts to authenticated;
grant all on tci.claim_invoice_verdicts to service_role;

-- ---------------------------------------------------------------------------
-- 7. Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_cols int; v_src text;
begin
  select prosrc into v_src
    from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
   where n.nspname = 'tci' and pr.proname = 'verify_claim_coverage';

  -- The recompute must never list an override column in its update set. The
  -- comment saying so is the marker; if someone rewrites the upsert they have
  -- to decide, consciously, what happens to the human's verdict.
  if v_src not like '%override columns are deliberately absent%' then
    raise exception 'verify_claim_coverage must document why it leaves overrides alone';
  end if;
  if v_src like '%set override_verdict%' then
    raise exception 'verify_claim_coverage must not write override columns';
  end if;

  select count(*) into v_cols
    from information_schema.columns
   where table_schema = 'tci' and table_name = 'claim_invoice_verdicts'
     and column_name in ('system_verdict', 'override_verdict',
                         'effective_verdict', 'effective_covered_amount');
  if v_cols <> 4 then
    raise exception 'the verdict table must keep system, override and effective side by side';
  end if;
end;
$$;
