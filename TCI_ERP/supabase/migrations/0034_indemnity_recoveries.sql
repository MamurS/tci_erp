-- What: indemnity calculation, claim payments, and subrogation recoveries with
--       their distribution - tci.calculate_indemnity, tci.approve_claim,
--       tci.claim_payments, tci.recoveries, and the position views.
-- Why:  Phase 5. What the insurer owes is arithmetic, and it must be arithmetic
--       anyone can audit. Four rules, all enforced here:
--
--   * THE CALCULATION IS DETERMINISTIC AND TRACED. tci.calculate_indemnity
--     returns every step it took - amount, i18n key, and the inputs that
--     produced it - so the screen can show the derivation line by line the way
--     the rating engine shows its factors. A pure TypeScript mirror
--     (src/features/claims/indemnity.ts) is locked to this file by a contract
--     test.
--   * IT IS FROZEN AT APPROVAL. approved_indemnity, afl_consumed and the trace
--     are snapshotted onto the claim, for the same reason the declaration
--     coverage split is frozen on acceptance: money moves on these numbers, so
--     revoking a limit next month must not restate what was approved today.
--   * CONSUMPTION IS TRACKED, NOT RECOMPUTED. The aggregate first loss and the
--     maximum liability are consumed ACROSS claims. Each approved claim
--     records what it took, and the next claim reads those records rather than
--     re-deriving history.
--   * RECOVERY IS SHARED IN THE RATIO OF WHAT EACH SIDE BORE. Costs come off
--     the top; the rest splits between insurer and policyholder in proportion
--     to the loss each of them actually carried. The policyholder's share is
--     the remainder, so rounding can never leak money.

-- ---------------------------------------------------------------------------
-- 1. What this claim consumed
-- ---------------------------------------------------------------------------

-- tci.claims.afl_consumed is declared in 0032, with the rest of the freeze.
-- This is what gives it its meaning.

comment on column tci.claims.afl_consumed is
  'How much of the policy aggregate first loss this claim absorbed, frozen at approval. The next claim reads it instead of re-deriving the history.';

-- ---------------------------------------------------------------------------
-- 2. The indemnity calculation
-- ---------------------------------------------------------------------------
-- Order of operations, and why each step is where it is:
--
--   1. covered debt          sum of effective_covered_amount over the invoices
--                            (override where a human gave one, else the engine)
--   2. x insured percentage  the policyholder always retains the balance
--   3. - NQL                 the non-qualifying loss the policyholder carries
--   4. - deductible          per loss, this claim only
--   5. - aggregate first loss  what is LEFT of it after earlier claims
--   6. capped at remaining max liability
--
-- Steps 3-5 are applied AFTER the insured percentage, not before: the retained
-- percentage is a share of the loss, the deductibles are amounts of money. A
-- deduction taken before the percentage would be silently scaled down by it.
-- Every step floors at zero - a deduction larger than what is left produces
-- nothing payable, never a negative.

create function tci.claim_covered_totals(p_claim_id uuid)
returns table (
  claimed_amount   numeric,
  claimable_amount numeric,
  disputed_amount  numeric,
  covered_amount   numeric,
  uncovered_amount numeric,
  invoice_count    int,
  overridden_count int
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(i.outstanding_amount), 0),
    coalesce(sum(i.claimable_amount), 0),
    coalesce(sum(i.disputed_amount), 0),
    coalesce(sum(v.effective_covered_amount), 0),
    coalesce(sum(i.claimable_amount), 0) - coalesce(sum(v.effective_covered_amount), 0),
    count(*)::int,
    count(v.override_verdict)::int
  from tci.claim_invoices i
  left join tci.claim_invoice_verdicts v on v.claim_invoice_id = i.id
  where i.claim_id = p_claim_id
$$;

comment on function tci.claim_covered_totals(uuid) is
  'The claim totalled up: claimed, claimable (less disputed), covered after overrides, and the uncovered remainder.';

create function tci.policy_liability_consumed(p_policy_id uuid, p_except_claim uuid default null)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(c.approved_indemnity), 0)
    from tci.claims c
   where c.policy_id = p_policy_id
     and c.approved_indemnity is not null
     and (p_except_claim is null or c.id <> p_except_claim)
     -- A withdrawn claim never consumed anything; a declined one has no
     -- approved indemnity to consume with.
     and c.status not in ('withdrawn', 'declined')
$$;

create function tci.policy_afl_consumed(p_policy_id uuid, p_except_claim uuid default null)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(c.afl_consumed), 0)
    from tci.claims c
   where c.policy_id = p_policy_id
     and c.afl_consumed is not null
     and (p_except_claim is null or c.id <> p_except_claim)
     and c.status not in ('withdrawn', 'declined')
$$;

create function tci.calculate_indemnity(p_claim_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claim   tci.claims%rowtype;
  v_policy  tci.policies%rowtype;
  v_tot     record;
  v_steps   jsonb := '[]'::jsonb;
  v_running numeric(18,2);
  v_nql     numeric(18,2);
  v_ded     numeric(18,2);
  v_afl_total     numeric(18,2);
  v_afl_used      numeric(18,2);
  v_afl_available numeric(18,2);
  v_afl_applied   numeric(18,2);
  v_liab_total    numeric(18,2);
  v_liab_used     numeric(18,2);
  v_liab_available numeric(18,2);
  v_capped  numeric(18,2);
begin
  select * into v_claim from tci.claims where id = p_claim_id;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  select * into v_policy from tci.policies where id = v_claim.policy_id;
  select * into v_tot from tci.claim_covered_totals(p_claim_id);

  -- 1. Covered debt
  v_running := round(coalesce(v_tot.covered_amount, 0), 2);
  v_steps := v_steps || jsonb_build_object(
    'key', 'claims.indemnity.step.coveredDebt',
    'amount', v_running,
    'detail', jsonb_build_object(
      'claimed', v_tot.claimed_amount,
      'claimable', v_tot.claimable_amount,
      'disputed', v_tot.disputed_amount,
      'uncovered', v_tot.uncovered_amount,
      'invoices', v_tot.invoice_count,
      'overridden', v_tot.overridden_count));

  -- 2. Insured percentage
  v_running := round(v_running * v_policy.insured_percentage / 100.0, 2);
  v_steps := v_steps || jsonb_build_object(
    'key', 'claims.indemnity.step.insuredPercentage',
    'amount', v_running,
    'detail', jsonb_build_object('insured_percentage', v_policy.insured_percentage));

  -- 3. Non-qualifying loss
  v_nql := least(round(coalesce(v_policy.nql_amount, 0), 2), v_running);
  v_running := round(v_running - v_nql, 2);
  v_steps := v_steps || jsonb_build_object(
    'key', 'claims.indemnity.step.nql',
    'amount', v_running,
    'detail', jsonb_build_object(
      'nql_amount', coalesce(v_policy.nql_amount, 0), 'applied', v_nql));

  -- 4. Deductible for this loss
  v_ded := least(round(coalesce(v_policy.deductible_each_loss, 0), 2), v_running);
  v_running := round(v_running - v_ded, 2);
  v_steps := v_steps || jsonb_build_object(
    'key', 'claims.indemnity.step.deductible',
    'amount', v_running,
    'detail', jsonb_build_object(
      'deductible_each_loss', coalesce(v_policy.deductible_each_loss, 0), 'applied', v_ded));

  -- 5. Aggregate first loss, what is left of it
  v_afl_total     := round(coalesce(v_policy.aggregate_first_loss, 0), 2);
  v_afl_used      := round(tci.policy_afl_consumed(v_claim.policy_id, p_claim_id), 2);
  v_afl_available := greatest(v_afl_total - v_afl_used, 0);
  v_afl_applied   := least(v_afl_available, v_running);
  v_running := round(v_running - v_afl_applied, 2);
  v_steps := v_steps || jsonb_build_object(
    'key', 'claims.indemnity.step.aggregateFirstLoss',
    'amount', v_running,
    'detail', jsonb_build_object(
      'aggregate_first_loss', v_afl_total,
      'already_consumed', v_afl_used,
      'available', v_afl_available,
      'applied', v_afl_applied));

  -- 6. Remaining maximum liability
  v_liab_total := v_policy.max_liability_amount;
  v_liab_used  := round(tci.policy_liability_consumed(v_claim.policy_id, p_claim_id), 2);
  if v_liab_total is null then
    -- No cap agreed on this policy: nothing to apply, and saying so explicitly
    -- is better than a step that silently changes nothing.
    v_liab_available := null;
    v_capped := v_running;
  else
    v_liab_available := greatest(round(v_liab_total, 2) - v_liab_used, 0);
    v_capped := least(v_running, v_liab_available);
  end if;
  v_steps := v_steps || jsonb_build_object(
    'key', 'claims.indemnity.step.maxLiability',
    'amount', v_capped,
    'detail', jsonb_build_object(
      'max_liability_amount', v_liab_total,
      'already_consumed', v_liab_used,
      'available', v_liab_available,
      'capped', (v_liab_available is not null and v_running > v_liab_available)));

  return jsonb_build_object(
    'claim_id', p_claim_id,
    'currency', v_claim.currency_code,
    'computed_at', now(),
    'claimed_amount', v_tot.claimed_amount,
    'claimable_amount', v_tot.claimable_amount,
    'disputed_amount', v_tot.disputed_amount,
    'covered_amount', v_tot.covered_amount,
    'uncovered_amount', v_tot.uncovered_amount,
    'afl_consumed', v_afl_applied,
    'payable', v_capped,
    'fully_covered', (coalesce(v_tot.uncovered_amount, 0) <= 0),
    'steps', v_steps);
end;
$$;

comment on function tci.calculate_indemnity(uuid) is
  'Deterministic indemnity for a claim, with the full step trace. Covered debt x insured percentage, less NQL, deductible and the remaining aggregate first loss, capped at the remaining maximum liability. Mirrored in src/features/claims/indemnity.ts.';

revoke execute on function tci.calculate_indemnity(uuid) from public, anon;
grant execute on function tci.calculate_indemnity(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Approving
-- ---------------------------------------------------------------------------
-- Freezes the calculation, keeps the buyer's limit suspended, and moves the
-- claim. Whether it is `approved` or `partially_approved` is not a matter of
-- taste: a claim with any uncovered debt is partial, by definition.

create function tci.suspend_limit_for_claim(p_claim_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim    tci.claims%rowtype;
  v_limit    record;
  v_decision tci.credit_limit_decisions%rowtype;
begin
  select * into v_claim from tci.claims where id = p_claim_id;

  select * into v_limit
    from tci.v_effective_limits v
   where v.policy_id = v_claim.policy_id
     and v.entity_id = v_claim.entity_id
     and v.outcome in ('approved', 'partial')
   limit 1;
  -- Already suspended (usually by the NOA that preceded this claim), or the
  -- buyer traded on the discretionary limit. Nothing to do, not an error.
  if not found then
    return null;
  end if;

  insert into tci.credit_limit_decisions (
    request_id, outcome, approved_amount, currency_code,
    valid_from, comment, decided_by, system_generated, system_reason_key, stage
  ) values (
    v_limit.request_id, 'revoked', 0, v_limit.currency_code,
    current_date, null, null, true, 'limits.systemReason.claimApproved', 'credit'
  ) returning * into v_decision;

  -- Supersede the prior effective decisions for the scope, exactly as
  -- tci.decide_limit_request and tci.suspend_limit_for_noa do. Without it
  -- v_effective_limits keeps serving the old limit as live.
  update tci.credit_limit_decisions d
     set lifecycle = 'superseded'
    from tci.credit_limit_requests r, tci.credit_limit_requests nr
   where r.id = d.request_id
     and nr.id = v_decision.request_id
     and d.id <> v_decision.id
     and d.lifecycle = 'effective'
     and tci.limit_scope(r.policy_id, r.insurance_request_id)
         = tci.limit_scope(nr.policy_id, nr.insurance_request_id)
     and r.entity_id = nr.entity_id;

  return v_decision.id;
end;
$$;

comment on function tci.suspend_limit_for_claim(uuid) is
  'Revokes the buyer''s limit when a claim is approved. Returns null when there was nothing left to suspend - the usual case, because the NOA already did it.';

create function tci.approve_claim(p_claim_id uuid, p_comment text default null)
returns tci.claims
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim  tci.claims%rowtype;
  v_calc   jsonb;
  v_payable numeric(18,2);
  v_to     tci.claim_status;
  v_suspension uuid;
begin
  if not tci.has_role('claims', 'admin') then
    raise exception 'only the claims department may approve a claim' using errcode = 'P0004';
  end if;
  select * into v_claim from tci.claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  if v_claim.status not in ('submitted', 'under_assessment', 'info_requested') then
    raise exception 'a % claim cannot be approved', v_claim.status using errcode = 'P0001';
  end if;

  -- Always assess against fresh verdicts: an invoice added or edited since the
  -- last recompute must not be approved on stale coverage.
  perform tci.verify_claim_coverage(p_claim_id);
  v_calc := tci.calculate_indemnity(p_claim_id);
  v_payable := (v_calc ->> 'payable')::numeric;

  if coalesce(v_payable, 0) <= 0 then
    raise exception 'this claim computes to nothing payable - decline it with a reason instead'
      using errcode = 'P0001';
  end if;

  v_to := case when (v_calc ->> 'fully_covered')::boolean
               then 'approved'::tci.claim_status
               else 'partially_approved'::tci.claim_status end;

  update tci.claims
     set approved_indemnity = v_payable,
         afl_consumed = (v_calc ->> 'afl_consumed')::numeric,
         indemnity_trace = v_calc,
         updated_at = now()
   where id = p_claim_id;

  -- An approved claim means the buyer did not pay. The limit stays down;
  -- reinstating it is a fresh credit decision, and 0036 raises the task for it.
  v_suspension := tci.suspend_limit_for_claim(p_claim_id);

  v_claim := tci.change_claim_status(p_claim_id, v_to, p_comment);

  perform tci.emit_workflow_event(
    'claim.approved', 'claim', p_claim_id,
    jsonb_build_object(
      'claim_number', v_claim.claim_number,
      'policy_id', v_claim.policy_id,
      'entity_id', v_claim.entity_id,
      'status', v_to,
      'indemnity', v_payable,
      'currency', v_claim.currency_code,
      'suspension_decision_id', v_suspension),
    'credit_underwriter'::tci.user_role);

  return v_claim;
end;
$$;

comment on function tci.approve_claim(uuid, text) is
  'Recomputes coverage, freezes the indemnity and its trace onto the claim, suspends the buyer''s limit and moves the claim to approved or partially_approved. Partial is derived from uncovered debt, not chosen.';

revoke execute on function tci.approve_claim(uuid, text) from public, anon;
grant execute on function tci.approve_claim(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Payments
-- ---------------------------------------------------------------------------

create table tci.claim_payments (
  id            uuid primary key default gen_random_uuid(),
  claim_id      uuid not null references tci.claims (id) on delete cascade,
  amount        numeric(18,2) not null check (amount > 0),
  currency_code char(3) not null references tci.currencies (code),
  paid_at       date not null default current_date,
  reference     text,
  created_by    uuid not null references auth.users (id) default auth.uid(),
  created_at    timestamptz not null default now()
);

create index claim_payments_claim_idx on tci.claim_payments (claim_id, paid_at);

comment on table tci.claim_payments is
  'Indemnity actually paid out. Cumulative payments may never exceed the frozen approved_indemnity; reaching it moves the claim to paid.';

create function tci.record_claim_payment(
  p_claim_id  uuid,
  p_amount    numeric,
  p_paid_at   date default current_date,
  p_reference text default null
)
returns tci.claim_payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim tci.claims%rowtype;
  v_paid  numeric(18,2);
  v_row   tci.claim_payments%rowtype;
begin
  if not tci.has_role('claims', 'admin') then
    raise exception 'only the claims department may record an indemnity payment'
      using errcode = 'P0004';
  end if;
  select * into v_claim from tci.claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  if v_claim.status not in ('approved', 'partially_approved', 'paid') then
    raise exception 'nothing has been approved on this claim yet' using errcode = 'P0001';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'a payment needs a positive amount' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount), 0) into v_paid
    from tci.claim_payments where claim_id = p_claim_id;
  if v_paid + p_amount > v_claim.approved_indemnity + 0.005 then
    raise exception 'this payment would exceed the approved indemnity (% already paid of %)',
      v_paid, v_claim.approved_indemnity using errcode = 'P0001';
  end if;

  insert into tci.claim_payments (claim_id, amount, currency_code, paid_at, reference)
  values (p_claim_id, p_amount, v_claim.currency_code, coalesce(p_paid_at, current_date), p_reference)
  returning * into v_row;

  -- Settled in full: the claim moves itself, so `paid` can never disagree with
  -- the payments behind it.
  if v_paid + p_amount >= v_claim.approved_indemnity - 0.005
     and v_claim.status <> 'paid' then
    perform tci.change_claim_status(p_claim_id, 'paid', null);
  end if;

  return v_row;
end;
$$;

revoke execute on function tci.record_claim_payment(uuid, numeric, date, text) from public, anon;
grant execute on function tci.record_claim_payment(uuid, numeric, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Recoveries (subrogation)
-- ---------------------------------------------------------------------------
-- Money collected from the buyer after the claim was paid. The rule, once:
--
--   net            = gross - recovery costs
--   insurer bore   = indemnity paid to date
--   policyholder bore = claimable debt - indemnity paid
--                       (uncovered lines, the retained percentage, the NQL,
--                        the deductible and the aggregate first loss - all of
--                        it is loss the policyholder carried)
--   insurer share  = round(net x insurer bore / total bore)
--   policyholder share = net - insurer share
--
-- The policyholder takes the REMAINDER, not a second rounded product, so the
-- two shares always add back to the net to the last tiyin.

create table tci.recoveries (
  id             uuid primary key default gen_random_uuid(),
  claim_id       uuid not null references tci.claims (id) on delete cascade,
  received_at    date not null default current_date,
  gross_amount   numeric(18,2) not null check (gross_amount > 0),
  recovery_costs numeric(18,2) not null default 0 check (recovery_costs >= 0),
  net_amount     numeric(18,2) generated always as (gross_amount - recovery_costs) stored,
  -- The split as computed WHEN the money arrived. Stored, not derived: the
  -- borne shares move as more indemnity is paid, and a distribution already
  -- made must not change afterwards.
  insurer_share      numeric(18,2) not null check (insurer_share >= 0),
  policyholder_share numeric(18,2) not null check (policyholder_share >= 0),
  insurer_borne      numeric(18,2) not null,
  policyholder_borne numeric(18,2) not null,
  currency_code  char(3) not null references tci.currencies (code),
  note           text,
  created_by     uuid not null references auth.users (id) default auth.uid(),
  created_at     timestamptz not null default now(),

  constraint recoveries_costs_within_gross check (recovery_costs <= gross_amount),
  constraint recoveries_shares_sum check (
    insurer_share + policyholder_share = gross_amount - recovery_costs
  )
);

create index recoveries_claim_idx on tci.recoveries (claim_id, received_at);

comment on table tci.recoveries is
  'Subrogation receipts. Costs come off the top; the net splits between insurer and policyholder in the ratio of the loss each bore, frozen at the moment of receipt.';

create function tci.record_recovery(
  p_claim_id  uuid,
  p_gross     numeric,
  p_costs     numeric default 0,
  p_received_at date default current_date,
  p_note      text default null
)
returns tci.recoveries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim   tci.claims%rowtype;
  v_tot     record;
  v_paid    numeric(18,2);
  v_ins_borne numeric(18,2);
  v_ph_borne  numeric(18,2);
  v_total_borne numeric(18,2);
  v_net     numeric(18,2);
  v_ins     numeric(18,2);
  v_row     tci.recoveries%rowtype;
begin
  if not tci.has_role('claims', 'admin') then
    raise exception 'only the claims department may record a recovery' using errcode = 'P0004';
  end if;
  select * into v_claim from tci.claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = 'P0002';
  end if;
  if coalesce(p_gross, 0) <= 0 then
    raise exception 'a recovery needs a positive gross amount' using errcode = 'P0001';
  end if;
  if coalesce(p_costs, 0) < 0 or coalesce(p_costs, 0) > p_gross then
    raise exception 'recovery costs must be between zero and the gross amount'
      using errcode = 'P0001';
  end if;

  select coalesce(sum(amount), 0) into v_paid
    from tci.claim_payments where claim_id = p_claim_id;
  select * into v_tot from tci.claim_covered_totals(p_claim_id);

  v_ins_borne   := round(v_paid, 2);
  v_ph_borne    := greatest(round(coalesce(v_tot.claimable_amount, 0) - v_paid, 2), 0);
  v_total_borne := v_ins_borne + v_ph_borne;
  v_net := round(p_gross - coalesce(p_costs, 0), 2);

  if v_total_borne <= 0 or v_ins_borne <= 0 then
    -- The insurer carried none of this loss - it paid nothing - so it takes
    -- none of the recovery.
    v_ins := 0;
  else
    v_ins := round(v_net * v_ins_borne / v_total_borne, 2);
    v_ins := least(v_ins, v_net);
  end if;

  insert into tci.recoveries (
    claim_id, received_at, gross_amount, recovery_costs,
    insurer_share, policyholder_share, insurer_borne, policyholder_borne,
    currency_code, note
  ) values (
    p_claim_id, coalesce(p_received_at, current_date), p_gross, coalesce(p_costs, 0),
    v_ins, v_net - v_ins, v_ins_borne, v_ph_borne,
    v_claim.currency_code, p_note
  ) returning * into v_row;

  perform tci.emit_workflow_event(
    'claim.recovery_recorded', 'claim', p_claim_id,
    jsonb_build_object(
      'claim_number', v_claim.claim_number,
      'gross', p_gross, 'costs', coalesce(p_costs, 0), 'net', v_net,
      'insurer_share', v_ins, 'policyholder_share', v_net - v_ins,
      'currency', v_claim.currency_code),
    'claims'::tci.user_role);

  return v_row;
end;
$$;

revoke execute on function tci.record_recovery(uuid, numeric, numeric, date, text) from public, anon;
grant execute on function tci.record_recovery(uuid, numeric, numeric, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Position views
-- ---------------------------------------------------------------------------

create view tci.v_claim_position
with (security_invoker = true) as
select
  c.id                as claim_id,
  c.claim_number,
  c.policy_id,
  c.entity_id,
  c.status,
  c.currency_code,
  c.claimed_amount,
  t.claimable_amount,
  t.disputed_amount,
  t.covered_amount,
  t.uncovered_amount,
  c.approved_indemnity,
  c.afl_consumed,
  coalesce(pay.paid_total, 0)            as paid_total,
  greatest(coalesce(c.approved_indemnity, 0) - coalesce(pay.paid_total, 0), 0)
                                          as outstanding_indemnity,
  coalesce(rec.gross_total, 0)           as recovery_gross,
  coalesce(rec.cost_total, 0)            as recovery_costs,
  coalesce(rec.insurer_total, 0)         as recovery_insurer,
  coalesce(rec.policyholder_total, 0)    as recovery_policyholder,
  -- What the insurer is out of pocket after subrogation, and what the
  -- policyholder still carries.
  coalesce(pay.paid_total, 0) - coalesce(rec.insurer_total, 0)
                                          as insurer_net_position,
  greatest(coalesce(t.claimable_amount, 0) - coalesce(pay.paid_total, 0), 0)
    - coalesce(rec.policyholder_total, 0) as policyholder_net_position
from tci.claims c
cross join lateral tci.claim_covered_totals(c.id) t
left join lateral (
  select sum(amount) as paid_total from tci.claim_payments p where p.claim_id = c.id
) pay on true
left join lateral (
  select sum(gross_amount) as gross_total, sum(recovery_costs) as cost_total,
         sum(insurer_share) as insurer_total, sum(policyholder_share) as policyholder_total
    from tci.recoveries r where r.claim_id = c.id
) rec on true;

comment on view tci.v_claim_position is
  'Cumulative money position per claim: what was claimed, covered, approved, paid, recovered and how the recovery split - and what each side is left carrying.';

create view tci.v_policy_liability
with (security_invoker = true) as
select
  p.id                      as policy_id,
  p.policy_number,
  p.currency_code,
  p.max_liability_amount,
  tci.policy_liability_consumed(p.id, null) as liability_consumed,
  case when p.max_liability_amount is null then null
       else greatest(p.max_liability_amount - tci.policy_liability_consumed(p.id, null), 0)
  end                       as liability_remaining,
  p.aggregate_first_loss,
  tci.policy_afl_consumed(p.id, null)       as afl_consumed,
  case when p.aggregate_first_loss is null then null
       else greatest(p.aggregate_first_loss - tci.policy_afl_consumed(p.id, null), 0)
  end                       as afl_remaining,
  (select count(*) from tci.claims c
    where c.policy_id = p.id and c.status not in ('withdrawn', 'closed'))::int
                            as open_claims,
  (select coalesce(sum(c.claimed_amount), 0) from tci.claims c
    where c.policy_id = p.id and c.status not in ('withdrawn', 'declined'))
                            as claimed_total
from tci.policies p;

comment on view tci.v_policy_liability is
  'How much of a policy''s maximum liability and aggregate first loss the claims already approved have consumed, and what is left for the next one.';

grant select on tci.v_claim_position, tci.v_policy_liability to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------

alter table tci.claim_payments enable row level security;
alter table tci.recoveries enable row level security;

create policy "claim_payments: staff read"
  on tci.claim_payments for select to authenticated using (tci.is_staff());
create policy "claim_payments: claims write"
  on tci.claim_payments for all to authenticated
  using (tci.has_role('claims', 'admin'))
  with check (tci.has_role('claims', 'admin'));

create policy "recoveries: staff read"
  on tci.recoveries for select to authenticated using (tci.is_staff());
create policy "recoveries: claims write"
  on tci.recoveries for all to authenticated
  using (tci.has_role('claims', 'admin'))
  with check (tci.has_role('claims', 'admin'));

grant select, insert, update, delete on tci.claim_payments, tci.recoveries to authenticated;
grant all on tci.claim_payments, tci.recoveries to service_role;

-- ---------------------------------------------------------------------------
-- 8. Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
   where n.nspname = 'tci' and pr.proname = 'calculate_indemnity';
  -- The order of operations is the contract. If someone reorders the steps the
  -- TypeScript mirror and its contract test must be reordered with them.
  if position('claims.indemnity.step.coveredDebt' in v_src) = 0
     or position('claims.indemnity.step.insuredPercentage' in v_src)
        < position('claims.indemnity.step.coveredDebt' in v_src)
     or position('claims.indemnity.step.nql' in v_src)
        < position('claims.indemnity.step.insuredPercentage' in v_src)
     or position('claims.indemnity.step.deductible' in v_src)
        < position('claims.indemnity.step.nql' in v_src)
     or position('claims.indemnity.step.aggregateFirstLoss' in v_src)
        < position('claims.indemnity.step.deductible' in v_src)
     or position('claims.indemnity.step.maxLiability' in v_src)
        < position('claims.indemnity.step.aggregateFirstLoss' in v_src)
  then
    raise exception 'the indemnity steps must stay in their contractual order';
  end if;
end;
$$;
