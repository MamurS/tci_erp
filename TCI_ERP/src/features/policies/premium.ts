/**
 * Premium arithmetic — pure mirror of tci.v_policy_premium (0027) and of the
 * payment model of migration 0056 (tci.v_premium_instalments).
 *
 * The rules that matter, and the ones the screen must state out loud:
 *
 *   THERE IS NO REFUND BELOW THE MINIMUM. If declared turnover earns less
 *   premium than the minimum, the minimum stands and the adjustment is zero.
 *   A quiet year still costs the minimum premium.
 *
 *   MONEY IS A LIST OF PAYMENTS. A policy's net payments (payments less
 *   reversals) fill its instalments OLDEST FIRST; «paid», «partially paid»
 *   and «overdue» are derived from that and from the date, never set by hand.
 *   A payment larger than what is still owed is refused; a correction is a
 *   reversal, never an edit.
 *
 * The rate is never re-derived either: each premium entry carries the rate it
 * was written at, so a mid-term rate change applies forward and history keeps
 * what it was actually charged.
 */

export const PREMIUM_BASES = ['minimum_with_adjustment', 'as_declared'] as const
export type PremiumBasis = (typeof PREMIUM_BASES)[number]

/** The STORED billing state (0056: 'paid' is derived, no longer stored). */
export const INSTALMENT_STATUSES = ['pending', 'invoiced', 'paid', 'cancelled'] as const
export type InstalmentStatus = (typeof INSTALMENT_STATUSES)[number]

/** What the screen shows, in the order of precedence of the SQL CASE:
 * cancelled > paid > overdue > partially_paid > invoiced > pending. */
export const DERIVED_STATUSES = ['cancelled', 'paid', 'overdue', 'partially_paid', 'invoiced', 'pending'] as const
export type DerivedStatus = (typeof DERIVED_STATUSES)[number]

export const PAYMENT_SOURCES = ['manual', 'bank_import', 'accounting_import'] as const
export type PaymentSource = (typeof PAYMENT_SOURCES)[number]

/** A row of tci.v_premium_instalments. */
export interface PremiumInstalment {
  id: string
  policy_id: string
  sequence: number
  due_date: string
  amount: number
  status: InstalmentStatus
  invoiced_at: string | null
  invoice_number: string | null
  invoice_date: string | null
  invoiced_by: string | null
  invoice_note: string | null
  note: string | null
  paid_amount: number
  outstanding: number
  derived_status: DerivedStatus
  days_overdue: number | null
  settled_on: string | null
}

/** A row of tci.premium_payments — append-only. */
export interface PremiumPayment {
  id: string
  policy_id: string
  kind: 'payment' | 'reversal'
  amount: number
  currency_code: string
  payment_date: string
  reference: string | null
  source: PaymentSource
  note: string | null
  reverses_id: string | null
  bank_line_id: string | null
  external_id: string | null
  recorded_by: string | null
  recorded_at: string
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
  /** Billed and not yet paid. */
  instalments_invoiced: number
  /** Premium actually received against the schedule. */
  instalments_paid: number
  /** Owed and past due. */
  instalments_overdue: number
  next_due_date: string | null
  earned_premium: number
  premium_entry_count: number
  adjustment_amount: number
  premium_due_total: number
  period_closed: boolean
  // 0056
  instalments_outstanding: number
  instalments_overdue_count: number
  payments_total: number
  reversals_total: number
  last_payment_date: string | null
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

/** Money in tiyin/cents, so sums are exact. */
const cents = (v: number) => Math.round(Number(v) * 100)

/** Payments less reversals. */
export function netPaid(payments: readonly Pick<PremiumPayment, 'kind' | 'amount'>[]): number {
  return payments.reduce((sum, p) => sum + (p.kind === 'payment' ? cents(p.amount) : -cents(p.amount)), 0) / 100
}

/** The derived status of one instalment (the SQL CASE, in its order). */
export function deriveStatus(
  i: Pick<PremiumInstalment, 'status' | 'amount' | 'due_date' | 'invoiced_at'>,
  paid: number,
  today: string,
): DerivedStatus {
  if (i.status === 'cancelled') return 'cancelled'
  if (cents(i.amount) - cents(paid) <= 0) return 'paid'
  if (i.due_date < today) return 'overdue'
  if (cents(paid) > 0) return 'partially_paid'
  if (i.invoiced_at !== null) return 'invoiced'
  return 'pending'
}

/**
 * Mirror of tci.v_premium_instalments: the policy's net payments fill its
 * instalments oldest first (due date, then sequence); a cancelled instalment
 * takes nothing. Used to paint a payment before the server has answered —
 * the server's answer then replaces it.
 */
export function allocate<T extends Pick<PremiumInstalment, 'sequence' | 'due_date' | 'amount' | 'status' | 'invoiced_at'>>(
  rows: readonly T[],
  net: number,
  today: string,
): (T & Pick<PremiumInstalment, 'paid_amount' | 'outstanding' | 'derived_status'>)[] {
  const order = [...rows].sort((a, b) => (a.due_date === b.due_date ? a.sequence - b.sequence : a.due_date < b.due_date ? -1 : 1))
  let left = cents(net)
  const byRow = new Map<T, { paid: number; outstanding: number }>()
  for (const row of order) {
    if (row.status === 'cancelled') {
      byRow.set(row, { paid: 0, outstanding: 0 })
      continue
    }
    const paid = Math.min(cents(row.amount), Math.max(left, 0))
    left -= cents(row.amount)
    byRow.set(row, { paid, outstanding: cents(row.amount) - paid })
  }
  return rows.map((row) => {
    const { paid, outstanding } = byRow.get(row)!
    return {
      ...row,
      paid_amount: paid / 100,
      outstanding: outstanding / 100,
      derived_status: deriveStatus(row, paid / 100, today),
    }
  })
}

/** What is still owed on the schedule. */
export function outstandingTotal(rows: readonly Pick<PremiumInstalment, 'outstanding'>[]): number {
  return rows.reduce((sum, r) => sum + cents(r.outstanding), 0) / 100
}

export type InstalmentAction = 'invoice' | 'recordPayment'

/** The actions an instalment offers, mirroring what the database accepts:
 * invoice while it is not yet billed and something is owed; record a
 * payment while something is owed. */
export function instalmentActions(
  i: Pick<PremiumInstalment, 'status' | 'invoiced_at' | 'outstanding'>,
): InstalmentAction[] {
  if (i.status === 'cancelled' || i.outstanding <= 0) return []
  return i.invoiced_at === null ? ['invoice', 'recordPayment'] : ['recordPayment']
}

/** The one action that is the obvious next step — the button on the row; the
 * rest live in its ⋯ menu. A bill comes before its payment. */
export function primaryAction(
  i: Pick<PremiumInstalment, 'status' | 'invoiced_at' | 'outstanding'>,
): InstalmentAction | null {
  return instalmentActions(i)[0] ?? null
}

/** A payment can be reversed once; a reversal never. */
export function isReversible(payment: Pick<PremiumPayment, 'id' | 'kind'>, all: readonly Pick<PremiumPayment, 'reverses_id'>[]): boolean {
  return payment.kind === 'payment' && !all.some((p) => p.reverses_id === payment.id)
}
