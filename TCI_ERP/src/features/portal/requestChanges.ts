/** What a policyholder may still do with a limit request (migration 0075).
 *
 * The view answers per row (`may_amend`, `may_withdraw`); this mirror names
 * the same statuses so the «Ждут нашего решения» list and the dialogs agree
 * with `tci.client_request_open` / `tci.client_request_amendable`, and a
 * contract test reads them from the migration. Amend only before
 * underwriting has the request; after that a change is a replacement — the
 * old request withdrawn and a new one sent, in one transaction. */

export const CLIENT_OPEN_STATUSES = [
  'submitted',
  'information_gathering',
  'under_review',
  'escalated',
  'pending_entity',
] as const

export const CLIENT_AMENDABLE_STATUSES = ['submitted', 'information_gathering', 'pending_entity'] as const

export function clientRequestOpen(status: string): boolean {
  return (CLIENT_OPEN_STATUSES as readonly string[]).includes(status)
}

export function clientRequestAmendable(status: string): boolean {
  return (CLIENT_AMENDABLE_STATUSES as readonly string[]).includes(status)
}

/** How a change is made: in place, or by replacing the request. */
export function changeMode(row: { may_amend: boolean; may_withdraw: boolean }): 'amend' | 'replace' | null {
  if (row.may_amend) return 'amend'
  if (row.may_withdraw) return 'replace'
  return null
}

export interface ChangeValues {
  amount: number
  paymentTermsDays: number | null
  justification: string | null
}

/** Mirrors the database's `amendment_unchanged`: the same three values,
 * with an empty justification read as none. */
export function isUnchanged(
  row: { requested_amount: number; requested_payment_terms_days: number | null; justification: string | null },
  next: ChangeValues,
): boolean {
  const just = (s: string | null) => (s ?? '').trim() || null
  return (
    Number(row.requested_amount) === next.amount &&
    (row.requested_payment_terms_days ?? null) === next.paymentTermsDays &&
    just(row.justification) === just(next.justification)
  )
}
