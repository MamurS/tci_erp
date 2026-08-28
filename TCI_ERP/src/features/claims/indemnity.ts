/** The indemnity calculation, mirrored from tci.calculate_indemnity (0034).
 *
 * The database computes and freezes what is actually paid. This module exists
 * so the screen can show a live figure while an assessor is still working, and
 * so the order of operations is asserted in two places instead of one. A
 * contract test locks the step keys and their order to the migration text.
 *
 * Order, and why:
 *   1. covered debt            the effective covered amounts (override or engine)
 *   2. x insured percentage    the policyholder always retains the balance
 *   3. - NQL                   the non-qualifying loss they carry
 *   4. - deductible each loss  this claim only
 *   5. - aggregate first loss  what is LEFT after earlier claims
 *   6. capped at the remaining maximum liability
 *
 * Steps 3-5 come AFTER the percentage: the retained share is a proportion of
 * the loss, the deductibles are amounts of money. Taken first they would be
 * silently scaled down by the percentage. Every step floors at zero.
 */

import type { IndemnityStep, IndemnityTrace } from './types'

export const INDEMNITY_STEP_KEYS = [
  'claims.indemnity.step.coveredDebt',
  'claims.indemnity.step.insuredPercentage',
  'claims.indemnity.step.nql',
  'claims.indemnity.step.deductible',
  'claims.indemnity.step.aggregateFirstLoss',
  'claims.indemnity.step.maxLiability',
] as const

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

  let running = round2(input.coveredAmount)
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

  running = round2((running * input.insuredPercentage) / 100)
  steps.push({
    key: 'claims.indemnity.step.insuredPercentage',
    amount: running,
    detail: { insured_percentage: input.insuredPercentage },
  })

  const nql = Math.min(round2(input.nqlAmount ?? 0), running)
  running = round2(running - nql)
  steps.push({
    key: 'claims.indemnity.step.nql',
    amount: running,
    detail: { nql_amount: input.nqlAmount ?? 0, applied: nql },
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
