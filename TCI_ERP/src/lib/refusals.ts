/** Readable messages for the operations screens' deliberate refusals
 * (declarations, premium, overdue notifications).
 *
 * The same rule as `features/claims/errors.ts`: a refusal the database makes
 * on purpose never reaches the screen as raw server text. Each entry pairs a
 * stable fragment of a `raise exception` with an i18n key, and a contract
 * test asserts the fragment still exists in the migrations. What no entry
 * matches falls back by SQLSTATE - a permission refusal (42501) or a missing
 * row (P0002) still says what happened - and only a truly unknown failure is
 * "something went wrong".
 */

export const OPERATIONS_REFUSALS: readonly { fragment: string; key: string }[] = [
  // declarations (0026, 0029)
  { fragment: 'a declaration cannot be submitted with no lines', key: 'declarations.errors.noLines' },
  { fragment: 'a declaration cannot go from', key: 'declarations.errors.invalidTransition' },
  { fragment: 'a dispute needs a reason the policyholder can act on', key: 'declarations.errors.disputeReason' },
  { fragment: 'only an accepted or disputed declaration can be corrected', key: 'declarations.errors.correctOnlyFinal' },
  { fragment: 'only commercial underwriting may accept a declaration', key: 'declarations.errors.acceptCommercialOnly' },
  { fragment: 'a declaration can only be edited while it is a draft', key: 'declarations.errors.draftOnly' },
  { fragment: 'declarations are made under an active policy', key: 'declarations.errors.policyNotActive' },
  { fragment: 'the declaration for this period is already', key: 'declarations.errors.periodTaken' },
  { fragment: 'turnover cannot be negative', key: 'declarations.errors.negativeTurnover' },
  // premium (0027)
  { fragment: 'this policy already has invoiced or paid instalments', key: 'premium.errors.scheduleLocked' },
  // overdue notifications (0028)
  { fragment: 'an overdue notification needs a positive amount', key: 'overdues.errors.amountPositive' },
  { fragment: 'overdue accounts can only be notified under an active policy', key: 'overdues.errors.policyNotActive' },
  { fragment: 'the first due date must be in the past', key: 'overdues.errors.dueInFuture' },
  { fragment: 'this buyer already has an open overdue notification on this policy', key: 'overdues.errors.alreadyOpen' },
  { fragment: 'this notification is already', key: 'overdues.errors.alreadyResolved' },
  // data requests (0054)
  { fragment: 'a company name is required', key: 'data.errors.nameRequired' },
  { fragment: 'unknown country', key: 'data.errors.unknownCountry' },
  { fragment: 'this data request is already', key: 'data.errors.alreadyClosed' },
  { fragment: 'the assignee must hold the information_manager role', key: 'data.errors.notInformationManager' },
  { fragment: 'a rejected request needs a reason', key: 'data.errors.reasonRequired' },
  { fragment: 'name the company the request was resolved with', key: 'data.errors.companyRequired' },
]

/** The i18n key for a refused operation. Never returns raw server text. */
export function refusalKey(error: unknown): string {
  const e = error as { message?: unknown; code?: unknown } | null
  const message = typeof e?.message === 'string' ? e.message.toLowerCase() : ''
  const hit = OPERATIONS_REFUSALS.find((r) => message.includes(r.fragment.toLowerCase()))
  if (hit) return hit.key
  if (e?.code === '42501') return 'common.notPermitted'
  if (e?.code === 'P0002') return 'common.recordNotFound'
  return 'common.somethingWentWrong'
}
