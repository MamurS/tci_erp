/** Presentation helpers for coverage verdicts (migration 0033).
 *
 * No coverage is DECIDED here - tci.verify_claim_coverage is the only engine.
 * This module turns its output into something a screen can render: tone, the
 * reason ordering, and whether a reason is a shortfall of amount or a breach of
 * the contract.
 */

import type { CoverageReason, CoverageVerdict } from './types'
import { COVERAGE_REASONS } from './types'

export type BadgeTone = 'neutral' | 'accent' | 'pos' | 'neg' | 'negStrong' | 'warn'

export function verdictTone(verdict: CoverageVerdict | null): BadgeTone {
  switch (verdict) {
    case 'covered':
      return 'pos'
    case 'partial':
      return 'warn'
    case 'not_covered':
      return 'neg'
    default:
      return 'neutral'
  }
}

/** Reasons that say "there was cover". */
export const POSITIVE_REASONS: readonly CoverageReason[] = ['covered_by_limit', 'covered_by_dl']

/** Reasons that cap an amount without breaching anything: the limit was simply
 * used up. They produce a PARTIAL verdict, never a refusal. */
export const SHORTFALL_REASONS: readonly CoverageReason[] = ['limit_exceeded', 'dl_exceeded']

/** Reasons that take cover away entirely, because a condition of the policy was
 * not met. These are the ones an assessor has to look at. */
export const BREACH_REASONS: readonly CoverageReason[] = [
  'no_limit_in_force',
  'limit_declined',
  'limit_revoked',
  'limit_not_yet_valid',
  'limit_expired',
  'payment_terms_exceeded',
  'shipment_before_inception',
  'shipment_after_expiry',
  'noa_late',
  'noa_missing',
]

export function reasonTone(reason: CoverageReason): BadgeTone {
  if (POSITIVE_REASONS.includes(reason)) return 'pos'
  if (SHORTFALL_REASONS.includes(reason)) return 'warn'
  if (reason === 'nothing_outstanding') return 'neutral'
  return 'neg'
}

/** Breaches first, then shortfalls, then the positives - an assessor reads the
 * problem before the reassurance. */
export function sortReasons(reasons: readonly CoverageReason[]): CoverageReason[] {
  const rank = (r: CoverageReason) =>
    BREACH_REASONS.includes(r) ? 0 : SHORTFALL_REASONS.includes(r) ? 1 : 2
  return [...reasons].sort(
    (a, b) => rank(a) - rank(b) || COVERAGE_REASONS.indexOf(a) - COVERAGE_REASONS.indexOf(b),
  )
}

/** A claim-level warning: the notification duty was not met, which prejudices
 * cover on every line. Shown at the top of the claim, not buried per invoice. */
export function noaWarning(claim: {
  cause_of_loss: string
  overdue_notification_id: string | null
  noa_reported_late: boolean | null
  noa_days_late: number | null
}): { key: 'missing' | 'late'; days: number } | null {
  if (claim.overdue_notification_id === null) {
    return claim.cause_of_loss === 'protracted_default' ? { key: 'missing', days: 0 } : null
  }
  if (claim.noa_reported_late) return { key: 'late', days: claim.noa_days_late ?? 0 }
  return null
}

/** Totals for the coverage tab. Uses the EFFECTIVE amounts, so an override is
 * already reflected. */
export function coverageTotals(
  lines: readonly {
    claimable_amount: number
    effective_covered_amount: number | null
    is_overridden: boolean
  }[],
): { claimable: number; covered: number; uncovered: number; overridden: number } {
  const claimable = lines.reduce((s, l) => s + Number(l.claimable_amount), 0)
  const covered = lines.reduce((s, l) => s + Number(l.effective_covered_amount ?? 0), 0)
  return {
    claimable,
    covered,
    uncovered: claimable - covered,
    overridden: lines.filter((l) => l.is_overridden).length,
  }
}
