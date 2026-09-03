-- What: the non-qualifying loss becomes a THRESHOLD test, not a deduction -
--       tci.calculate_indemnity and tci.approve_claim replaced.
-- Why:  Allianz Trade practice, per the owner. 0034 subtracted nql_amount from
--       the indemnity after the insured percentage. That is one reading of an
--       NQL and it is the wrong one for this book: the non-qualifying loss is
--       a DE MINIMIS, the size below which a loss does not qualify to be
--       claimed at all. It is a gate, not a haircut.
--
-- The consequences are not cosmetic:
--
--   * WHERE IT IS TESTED MOVES. The test is on the CONFIRMED COVERED LOSS, per
--     buyer, BEFORE the insured percentage - because the threshold asks "is
--     this loss big enough to be worth claiming", which is a question about
--     the loss, not about the insurer's share of it. A claim is already per
--     buyer (one live claim per policy+buyer), so the claim's covered debt IS
--     the per-buyer figure.
--   * IT IS ALL OR NOTHING. Below the threshold the claim is not indemnifiable
--     and nothing is payable - not "payable less the NQL". At or above it, the
--     FULL covered loss proceeds with no subtraction at all. EQUAL IS PAYABLE:
--     the comparison is >=, and the boundary case is asserted in the smoke and
--     in the TypeScript contract test.
--   * THE REFUSAL HAS TO SAY SO. tci.approve_claim distinguishes "nothing was
--     covered" from "the covered loss is below the non-qualifying threshold",
--     because they are different facts and the policyholder is owed the second
--     one plainly.
--
-- Everything else is untouched: the deductible each loss, the aggregate first
-- loss and the maximum liability cap keep their meaning, their order and their
-- arithmetic. So does the recovery split in 0034.

-- ---------------------------------------------------------------------------
-- The calculation
-- ---------------------------------------------------------------------------
-- Order of operations, restated in full:
--
--   1. covered debt              sum of effective_covered_amount over invoices
--   2. NQL THRESHOLD TEST        covered debt >= nql_amount, or nothing is payable
--   3. x insured percentage      the policyholder always retains the balance
--   4. - deductible each loss    this claim only
--   5. - aggregate first loss    what is LEFT of it after earlier claims
--   6. capped at remaining max liability
--
-- Steps 4-5 still come AFTER the percentage: the retained percentage is a
-- share of the loss, the deductibles are amounts of money, and a deduction
-- taken first would be silently scaled down by it. The threshold is different
-- and comes BEFORE, because it is a test on the loss itself.

create or replace function tci.calculate_indemnity(p_claim_id uuid)
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
  v_covered numeric(18,2);
  v_nql     numeric(18,2);
  v_nql_met boolean;
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
  v_covered := round(coalesce(v_tot.covered_amount, 0), 2);
  v_running := v_covered;
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

  -- 2. The non-qualifying loss threshold. A gate, not a haircut: at or above
  --    it the full covered loss goes forward untouched; below it nothing is
  --    payable at all. Equal qualifies.
  v_nql     := round(coalesce(v_policy.nql_amount, 0), 2);
  v_nql_met := (v_covered >= v_nql);
  if not v_nql_met then
    v_running := 0;
  end if;
  v_steps := v_steps || jsonb_build_object(
    'key', 'claims.indemnity.step.nqlThreshold',
    'amount', v_running,
    'detail', jsonb_build_object(
      'nql_amount', v_nql,
      'covered_loss', v_covered,
      'met', v_nql_met,
      'shortfall', case when v_nql_met then 0 else round(v_nql - v_covered, 2) end));

  -- 3. Insured percentage
  v_running := round(v_running * v_policy.insured_percentage / 100.0, 2);
  v_steps := v_steps || jsonb_build_object(
    'key', 'claims.indemnity.step.insuredPercentage',
    'amount', v_running,
    'detail', jsonb_build_object('insured_percentage', v_policy.insured_percentage));

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
    'nql_amount', v_nql,
    'nql_met', v_nql_met,
    -- An i18n KEY, never rendered text: the UI owns the wording in three
    -- languages. Null when the claim is indemnifiable.
    'not_indemnifiable_reason',
      case when v_nql_met then null else 'claims.indemnity.belowNql' end,
    'afl_consumed', v_afl_applied,
    'payable', v_capped,
    'fully_covered', (coalesce(v_tot.uncovered_amount, 0) <= 0),
    'steps', v_steps);
end;
$$;

comment on function tci.calculate_indemnity(uuid) is
  'Deterministic indemnity with the full step trace. The non-qualifying loss is a THRESHOLD on the covered loss before the insured percentage - at or above it the full amount proceeds, below it nothing is payable - then the percentage, the deductible, the remaining aggregate first loss and the maximum liability cap. Mirrored in src/features/claims/indemnity.ts.';

-- ---------------------------------------------------------------------------
-- Approving
-- ---------------------------------------------------------------------------
-- Same as 0034 except that a below-threshold claim is refused by NAME. "This
-- claim computes to nothing payable" would be true but useless: the assessor
-- and the policyholder are owed the actual reason.

create or replace function tci.approve_claim(p_claim_id uuid, p_comment text default null)
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

  -- Nothing covered at all, and a covered loss too small to qualify, are
  -- different facts. Say which.
  if coalesce((v_calc ->> 'covered_amount')::numeric, 0) <= 0 then
    raise exception 'this claim computes to nothing payable - decline it with a reason instead'
      using errcode = 'P0001';
  end if;
  if not (v_calc ->> 'nql_met')::boolean then
    raise exception 'the covered loss (%) is below the non-qualifying loss threshold (%) - this claim is not indemnifiable',
      (v_calc ->> 'covered_amount'), (v_calc ->> 'nql_amount')
      using errcode = 'P0001', detail = 'claims.indemnity.belowNql';
  end if;
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
  'Recomputes coverage, freezes the indemnity and its trace onto the claim, suspends the buyer''s limit and moves the claim. Refuses a covered loss below the non-qualifying threshold by name, separately from a claim with nothing covered at all.';

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_src text;
begin
  select prosrc into v_src from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
   where n.nspname = 'tci' and pr.proname = 'calculate_indemnity';

  -- The threshold must be tested BEFORE the insured percentage, and the old
  -- deduction step must be gone entirely.
  if position('claims.indemnity.step.nqlThreshold' in v_src) = 0 then
    raise exception 'the NQL threshold step is missing';
  end if;
  if position('claims.indemnity.step.nqlThreshold' in v_src)
     > position('claims.indemnity.step.insuredPercentage' in v_src) then
    raise exception 'the NQL threshold must be tested before the insured percentage';
  end if;
  if v_src like '%v_running - v_nql%' then
    raise exception 'the NQL must not be subtracted - it is a threshold, not a deduction';
  end if;

  -- The remaining order is unchanged.
  if position('claims.indemnity.step.deductible' in v_src)
       < position('claims.indemnity.step.insuredPercentage' in v_src)
     or position('claims.indemnity.step.aggregateFirstLoss' in v_src)
       < position('claims.indemnity.step.deductible' in v_src)
     or position('claims.indemnity.step.maxLiability' in v_src)
       < position('claims.indemnity.step.aggregateFirstLoss' in v_src)
  then
    raise exception 'the indemnity steps after the threshold must keep their order';
  end if;

  -- Equal must qualify: the comparison is >=, never >.
  if v_src not like '%v_nql_met := (v_covered >= v_nql);%' then
    raise exception 'a loss exactly equal to the threshold must qualify (>=, not >)';
  end if;
end;
$$;
