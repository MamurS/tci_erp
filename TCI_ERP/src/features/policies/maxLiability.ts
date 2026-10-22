/**
 * The maximum liability is ONE term stated on one of two bases: an amount of
 * money, or a multiple of the premium. The database keeps them as two
 * columns (max_liability_amount, max_liability_premium_multiple) and its
 * CHECK only asks that a non-draft policy carry at least one; the forms offer
 * the basis as a choice and save the other column as NULL, so a policy never
 * reads «1,600,000 USD / 20× premium» with nobody knowing which one binds.
 */

export type LiabilityBasis = 'amount' | 'multiple'

export const LIABILITY_BASES: readonly LiabilityBasis[] = ['amount', 'multiple']

/** The basis stored terms are on: the amount when set, else the multiple when
 * set, else the amount (the usual way a cap is written). */
export function liabilityBasis(amount: unknown, multiple: unknown): LiabilityBasis {
  if (amount !== null && amount !== undefined && amount !== '') return 'amount'
  if (multiple !== null && multiple !== undefined && multiple !== '') return 'multiple'
  return 'amount'
}

/** The pair of columns to save: the chosen basis keeps its value, the other is NULL. */
export function liabilityColumns(
  basis: LiabilityBasis,
  value: number | null,
): { max_liability_amount: number | null; max_liability_premium_multiple: number | null } {
  return basis === 'amount'
    ? { max_liability_amount: value, max_liability_premium_multiple: null }
    : { max_liability_amount: null, max_liability_premium_multiple: value }
}
