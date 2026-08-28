/** The indemnity calculation, mirrored from tci.calculate_indemnity
 * (0034, replaced by 0037).
 *
 * The database computes and freezes what is actually paid. This module exists
 * so the screen can show a live figure while an assessor is still working, and
 * so the order of operations is asserted in two places instead of one. A
 * contract test locks the step keys and their order to the migration text.
 *
 * Order, and why:
 *   1. covered debt            the effective covered amounts (override or engine)
 *   2. NQL THRESHOLD           covered debt >= nql_amount, or nothing is payable
 *   3. x insured percentage    the policyholder always retains the balance
 *   4. - deductible each loss  this claim only
 *   5. - aggregate first loss  what is LEFT after earlier claims
 *   6. capped at the remaining maximum liability
 *
 * The non-qualifying loss is a DE MINIMIS, not a haircut: it asks whether the
 * loss is big enough to be claimed at all. So it is tested on the covered loss
 * BEFORE the insured percentage - the question is about the loss, not about
 * the insurer's share of it - and it is all or nothing. At or above the
 * threshold the full amount proceeds with no subtraction; below it the claim
 * is not indemnifiable. EQUAL QUALIFIES.
 *
 * Steps 4-5 still come AFTER the percentage: the retained share is a
 * proportion of the loss, the deductibles are amounts of money, and taken
 * first they would be silently scaled down by it. Every step floors at zero.
 */

import type { IndemnityStep, IndemnityTrace } from './types'

export const INDEMNITY_STEP_KEYS = [
  'claims.indemnity.step.coveredDebt',
  'claims.indemnity.step.nqlThreshold',
  'claims.indemnity.step.insuredPercentage',
  'claims.indemnity.step.deductible',
  'claims.indemnity.step.aggregateFirstLoss',
  'claims.indemnity.step.maxLiability',
] as const

/** The i18n key the database returns as `not_indemnifiable_reason`. */
export const BELOW_NQL_REASON = 'claims.indemnity.belowNql'

/** Postgres `round(numeric, 2)` is half away from zero. Every amount here is
 * non-negative, so half-up over the scaled value matches it exactly; the
 * epsilon absorbs the binary representation error that would otherwise turn
 * 0.145 into 0.14. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export interface IndemnityInputs {
  coveredAmount: number
  claimableAmount: number
  disputedAmount?: number
  claimedAmount?: number
  insuredPercentage: number
  nqlAmount: number | null
  deductibleEachLoss: number | null
  aggregateFirstLoss: number | null
  aflAlreadyConsumed: number
  maxLiabilityAmount: number | null
  liabilityAlreadyConsumed: number
  currency: string
}

export function calculateIndemnity(input: IndemnityInputs): IndemnityTrace {
  const steps: IndemnityStep[] = []
  const uncovered = round2(input.claimableAmount - input.coveredAmount)

  const covered = round2(input.coveredAmount)
  let running = covered
  steps.push({
    key: 'claims.indemnity.step.coveredDebt',
    amount: running,
    detail: {
      claimed: input.claimedAmount ?? input.claimableAmount,
      claimable: input.claimableAmount,
      disputed: input.disputedAmount ?? 0,
      uncovered,
    },
  })

  // The threshold: a gate on the loss itself, tested before the percentage.
  // Equal qualifies — the comparison is >=, never >.
  const nql = round2(input.nqlAmount ?? 0)
  const nqlMet = covered >= nql
  if (!nqlMet) running = 0
  steps.push({
    key: 'claims.indemnity.step.nqlThreshold',
    amount: running,
    detail: {
      nql_amount: nql,
      covered_loss: covered,
      met: nqlMet,
      shortfall: nqlMet ? 0 : round2(nql - covered),
    },
  })

  running = round2((running * input.insuredPercentage) / 100)
  steps.push({
    key: 'claims.indemnity.step.insuredPercentage',
    amount: running,
    detail: { insured_percentage: input.insuredPercentage },
  })

  const deductible = Math.min(round2(input.deductibleEachLoss ?? 0), running)
  running = round2(running - deductible)
  steps.push({
    key: 'claims.indemnity.step.deductible',
    amount: running,
    detail: { deductible_each_loss: input.deductibleEachLoss ?? 0, applied: deductible },
  })

  const aflTotal = round2(input.aggregateFirstLoss ?? 0)
  const aflUsed = round2(input.aflAlreadyConsumed)
  const aflAvailable = Math.max(round2(aflTotal - aflUsed), 0)
  const aflApplied = Math.min(aflAvailable, running)
  running = round2(running - aflApplied)
  steps.push({
    key: 'claims.indemnity.step.aggregateFirstLoss',
    amount: running,
    detail: {
      aggregate_first_loss: aflTotal,
      already_consumed: aflUsed,
      available: aflAvailable,
      applied: aflApplied,
    },
  })

  const liabTotal = input.maxLiabilityAmount
  const liabUsed = round2(input.liabilityAlreadyConsumed)
  let liabAvailable: number | null = null
  let payable = running
  if (liabTotal !== null && liabTotal !== undefined) {
    liabAvailable = Math.max(round2(round2(liabTotal) - liabUsed), 0)
    payable = Math.min(running, liabAvailable)
  }
  steps.push({
    key: 'claims.indemnity.step.maxLiability',
    amount: payable,
    detail: {
      max_liability_amount: liabTotal,
      already_consumed: liabUsed,
      available: liabAvailable,
      capped: liabAvailable !== null && running > liabAvailable,
    },
  })

  return {
    claim_id: '',
    currency: input.currency,
    computed_at: '',
    claimed_amount: input.claimedAmount ?? input.claimableAmount,
    claimable_amount: input.claimableAmount,
    disputed_amount: input.disputedAmount ?? 0,
    covered_amount: input.coveredAmount,
    uncovered_amount: uncovered,
    nql_amount: nql,
    nql_met: nqlMet,
    not_indemnifiable_reason: nqlMet ? null : BELOW_NQL_REASON,
    afl_consumed: aflApplied,
    payable,
    fully_covered: uncovered <= 0,
    steps,
  }
}

/**
 * The recovery split, mirrored from tci.record_recovery (0034).
 *
 *   net                = gross - costs
 *   insurer bore       = indemnity paid to date
 *   policyholder bore  = claimable debt - indemnity paid (uncovered lines, the
 *                        retained percentage, the NQL, the deductible, the AFL)
 *   insurer share      = round(net x insurer bore / total bore)
 *   policyholder share = net - insurer share
 *
 * The policyholder takes the REMAINDER rather than a second rounded product,
 * so the two shares always add back to the net exactly.
 */
export function splitRecovery(input: {
  gross: number
  costs: number
  indemnityPaid: number
  claimableAmount: number
}): {
  net: number
  insurerShare: number
  policyholderShare: number
  insurerBorne: number
  policyholderBorne: number
} {
  const insurerBorne = round2(input.indemnityPaid)
  const policyholderBorne = Math.max(round2(input.claimableAmount - input.indemnityPaid), 0)
  const totalBorne = insurerBorne + policyholderBorne
  const net = round2(input.gross - input.costs)
  let insurerShare = 0
  if (totalBorne > 0 && insurerBorne > 0) {
    insurerShare = Math.min(round2((net * insurerBorne) / totalBorne), net)
  }
  return {
    net,
    insurerShare,
    policyholderShare: round2(net - insurerShare),
    insurerBorne,
    policyholderBorne,
  }
}
