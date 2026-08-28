/**
 * Dashboard summaries for Phase 4 — pure, so the numbers can be tested
 * without a database and the cards stay dumb.
 *
 * Declaration COMPLIANCE is the question a dashboard should answer: not "how
 * many declarations exist" but "how many periods are still owed to us". That
 * is the difference between a count and a control.
 */

import type { DeclarationStatus } from './types'

export interface DeclarationCompliance {
  /** Waiting on the insurer: submitted, not yet accepted or disputed. */
  awaitingAcceptance: number
  /** Back with the policyholder. */
  disputed: number
  /** Accepted this period — the ones that earned premium. */
  accepted: number
}

export function declarationCompliance(
  declarations: readonly { status: DeclarationStatus }[],
): DeclarationCompliance {
  return {
    awaitingAcceptance: declarations.filter((d) => d.status === 'submitted').length,
    disputed: declarations.filter((d) => d.status === 'disputed').length,
    accepted: declarations.filter((d) => d.status === 'accepted').length,
  }
}

export interface PremiumAccrual {
  earned: number
  minimum: number
  /** greatest(earned - minimum, 0), summed across policies. */
  adjustment: number
  instalmentsOverdue: number
}

export function premiumAccrual(
  policies: readonly {
    earned_premium: number
    minimum_premium: number
    adjustment_amount: number
    instalments_overdue: number
  }[],
): PremiumAccrual {
  return policies.reduce<PremiumAccrual>(
    (acc, p) => ({
      earned: acc.earned + Number(p.earned_premium),
      minimum: acc.minimum + Number(p.minimum_premium),
      adjustment: acc.adjustment + Number(p.adjustment_amount),
      instalmentsOverdue: acc.instalmentsOverdue + Number(p.instalments_overdue),
    }),
    { earned: 0, minimum: 0, adjustment: 0, instalmentsOverdue: 0 },
  )
}
