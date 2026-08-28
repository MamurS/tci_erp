/**
 * Premium arithmetic — pure mirror of tci.v_policy_premium and
 * tci.premium_instalment_count (migration 0027).
 *
 * The rule that matters, and the one the screen must state out loud:
 *
 *   THERE IS NO REFUND BELOW THE MINIMUM. If declared turnover earns less
 *   premium than the minimum, the minimum stands and the adjustment is zero.
 *   A quiet year still costs the minimum premium.
 *
 * The rate is never re-derived either: each premium entry carries the rate it
 * was written at, so a mid-term rate change applies forward and history keeps
 * what it was actually charged.
 */

export const PREMIUM_BASES = ['minimum_with_adjustment', 'as_declared'] as const
export type PremiumBasis = (typeof PREMIUM_BASES)[number]

export const INSTALMENT_STATUSES = ['pending', 'invoiced', 'paid', 'cancelled'] as const
export type InstalmentStatus = (typeof INSTALMENT_STATUSES)[number]

export interface PremiumInstalment {
  id: string
  policy_id: string
  sequence: number
  due_date: string
  amount: number
  status: InstalmentStatus
  paid_at: string | null
  note: string | null
}

export interface PolicyPremium {
  policy_id: string
  policy_number: string
  entity_id: string
  currency_code: string
  premium_basis: PremiumBasis
  premium_rate_pct: number
  minimum_premium: number
  instalments_total: number
  instalments_count: number
  instalments_invoiced: number
  instalments_paid: number
  instalments_overdue: number
  next_due_date: string | null
  earned_premium: number
  premium_entry_count: number
  adjustment_amount: number
  premium_due_total: number
  period_closed: boolean
}

/** greatest(earned - minimum, 0). Never negative: no refund below the minimum. */
export function adjustmentAmount(earned: number, minimum: number): number {
  return Math.max(earned - minimum, 0)
}

/** What the policyholder owes for the period as a whole. */
export function premiumDueTotal(
  basis: PremiumBasis,
  earned: number,
  minimum: number,
): number {
  return basis === 'minimum_with_adjustment' ? Math.max(earned, minimum) : earned
}

/** True when the minimum is carrying the policy — earned premium has not
 * reached it. The screen says so explicitly rather than showing a bare zero
 * adjustment that reads like nothing happened. */
export function isBelowMinimum(earned: number, minimum: number): boolean {
  return earned < minimum
}

/** Premium earned by a declaration: covered turnover x rate. Uncovered excess
 * is excluded — it was never insured. */
export function earnedPremium(coveredTurnover: number, ratePct: number): number {
  return Math.round(coveredTurnover * ratePct) / 100
}

/** An instalment can only be re-dated or re-priced while it is pending; once
 * invoiced it is part of a document the policyholder holds. Mirrors
 * tci.guard_instalment_edit. */
export function isInstalmentEditable(status: InstalmentStatus): boolean {
  return status === 'pending'
}

export function isInstalmentOverdue(
  instalment: Pick<PremiumInstalment, 'status' | 'due_date'>,
  today: string,
): boolean {
  return (
    (instalment.status === 'pending' || instalment.status === 'invoiced') &&
    instalment.due_date < today
  )
}
