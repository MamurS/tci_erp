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
  // invoices and payments (0056)
  { fragment: 'instalment_already_invoiced', key: 'premium.errors.alreadyInvoiced' },
  { fragment: 'instalment_already_paid', key: 'premium.errors.alreadyPaid' },
  { fragment: 'instalment_cancelled', key: 'premium.errors.instalmentCancelled' },
  { fragment: 'invoice_number_required', key: 'premium.errors.invoiceNumberRequired' },
  { fragment: 'invoice_number_taken', key: 'premium.errors.invoiceNumberTaken' },
  { fragment: 'invoice_number_too_long', key: 'premium.errors.invoiceNumberTooLong' },
  { fragment: 'invoice_date_in_future', key: 'premium.errors.invoiceDateInFuture' },
  { fragment: 'payment_amount_positive', key: 'premium.errors.amountPositive' },
  { fragment: 'payment_currency_mismatch', key: 'premium.errors.currencyMismatch' },
  { fragment: 'payment_date_invalid', key: 'premium.errors.paymentDateInvalid' },
  { fragment: 'payment_exceeds_outstanding', key: 'premium.errors.exceedsOutstanding' },
  { fragment: 'policy_not_billable', key: 'premium.errors.policyNotBillable' },
  { fragment: 'payment_is_reversal', key: 'premium.errors.isReversal' },
  { fragment: 'payment_already_reversed', key: 'premium.errors.alreadyReversed' },
  { fragment: 'reversal_reason_required', key: 'premium.errors.reasonRequired' },
  // bank statements (0056)
  { fragment: 'statement_empty', key: 'premium.bank.errors.statementEmpty' },
  { fragment: 'statement_too_large', key: 'premium.bank.errors.statementTooLarge' },
  { fragment: 'statement_line_invalid', key: 'premium.bank.errors.statementLineInvalid' },
  { fragment: 'statement_line_resolved', key: 'premium.bank.errors.lineResolved' },
  { fragment: 'profile_name_required', key: 'premium.bank.errors.profileNameRequired' },
  { fragment: 'profile_mapping_invalid', key: 'premium.bank.errors.profileMappingInvalid' },
  { fragment: 'ignore_reason_required', key: 'premium.bank.errors.ignoreReasonRequired' },
  // commercial offers (0058)
  { fragment: 'offer_request_status', key: 'offers.errors.requestStatus' },
  { fragment: 'offer_terms_missing', key: 'offers.errors.termsMissing' },
  { fragment: 'offer_exists', key: 'offers.errors.exists' },
  { fragment: 'offer_language', key: 'offers.errors.language' },
  { fragment: 'offer_valid_until_past', key: 'offers.errors.validUntilPast' },
  { fragment: 'offer_texts_invalid', key: 'offers.errors.textsInvalid' },
  { fragment: 'offer_closed', key: 'offers.errors.closed' },
  { fragment: 'offer_version_conflict', key: 'offers.errors.versionConflict' },
  { fragment: 'offer_nothing_new', key: 'offers.errors.nothingNew' },
  { fragment: 'offer_withdraw_reason', key: 'offers.errors.withdrawReason' },
  { fragment: 'offer_not_open', key: 'offers.errors.notOpen' },
  { fragment: 'offer_expired', key: 'offers.errors.expired' },
  { fragment: 'offer_comment_too_long', key: 'offers.errors.commentTooLong' },
  { fragment: 'say what should change', key: 'offers.errors.sayWhatChanges' },
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
  // the Agenda (0055)
  { fragment: 'snooze_in_past', key: 'agenda.errors.snoozeInPast' },
  { fragment: 'snooze_too_far', key: 'agenda.errors.snoozeTooFar' },
  { fragment: 'comment_empty', key: 'agenda.errors.commentEmpty' },
  { fragment: 'comment_too_long', key: 'agenda.errors.commentTooLong' },
  { fragment: 'closes itself when its object moves on', key: 'agenda.completeFailed' },
  { fragment: 'not found or not yours', key: 'agenda.errors.notYours' },
  // limit-decision validation and direct managers (0060)
  { fragment: 'validator_required', key: 'limits.validation.errors.validatorRequired' },
  // 0063: the named validator raised the request or made its credit decision —
  // before the generic 0060 entry, which their text also contains.
  { fragment: 'validator_four_eyes_own_request', key: 'limits.validation.errors.fourEyesOwnRequest' },
  { fragment: 'validator_four_eyes_own_credit_decision', key: 'limits.validation.errors.fourEyesOwnCredit' },
  { fragment: 'validator_four_eyes', key: 'limits.validation.errors.fourEyes' },
  { fragment: 'validator_wrong_department', key: 'limits.validation.errors.wrongDepartment' },
  { fragment: 'validator_lacks_authority', key: 'limits.validation.errors.lacksAuthority' },
  { fragment: 'validation_comment_required', key: 'limits.validation.errors.commentRequired' },
  { fragment: 'limit_validation_pending', key: 'limits.validation.errors.pending' },
  { fragment: 'validation_beyond_authority', key: 'limits.validation.errors.beyondAuthority' },
  { fragment: 'validation_group_limit', key: 'limits.validation.errors.groupLimit' },
  { fragment: 'validation_closed', key: 'limits.validation.errors.closed' },
  { fragment: 'validation_not_for_reduction', key: 'limits.validation.errors.notForReduction' },
  { fragment: 'validation_not_recorded', key: 'limits.validation.errors.notRecorded' },
  { fragment: 'only the assigned validator may answer this validation', key: 'limits.validation.errors.notYours' },
  { fragment: 'manager_is_self', key: 'admin.manager.errors.self' },
  { fragment: 'manager_not_staff', key: 'admin.manager.errors.notStaff' },
  // auto decisions — the buyer's ADT (0061). Before the generic «no UZS rate»
  // below: adt_fx_missing says the same words and is the more precise one.
  { fragment: 'adt_invalid', key: 'limits.adt.errors.invalid' },
  { fragment: 'adt_assessment_mismatch', key: 'limits.adt.errors.assessmentMismatch' },
  { fragment: 'adt_no_rating', key: 'limits.adt.errors.noRating' },
  { fragment: 'adt_fx_missing', key: 'limits.adt.errors.fxMissing' },
  { fragment: 'adt_beyond_authority', key: 'limits.adt.errors.beyondAuthority' },
  { fragment: 'adt_none', key: 'limits.adt.errors.none' },
  { fragment: 'adt_block_reason', key: 'limits.adt.errors.blockReason' },
  // four eyes and the acting role (0063). The four-eyes texts come from
  // tci.limit_four_eyes_refusal, raised as '%' by each function that asks it.
  { fragment: 'four_eyes_own_request', key: 'limits.errors.fourEyesOwnRequest' },
  { fragment: 'four_eyes_own_credit_decision', key: 'limits.errors.fourEyesOwnCredit' },
  { fragment: 'only credit underwriting may take a request into review', key: 'limits.errors.reviewCreditOnly' },
  { fragment: 'only credit underwriting may decide', key: 'limits.errors.decideCreditOnly' },
  // information gathering (0067)
  { fragment: 'limit_not_gathering_information', key: 'limits.information.errors.notGathering' },
  { fragment: 'information_waiver_comment_required', key: 'limits.information.waiveCommentRequired' },
  // admin is a technical role (0065)
  { fragment: 'policy_status_commercial_only', key: 'policies.statusCommercialOnly' },
  { fragment: 'acting_role_not_held', key: 'roles.errors.notHeld' },
  { fragment: 'acting_role_no_session', key: 'roles.errors.noSession' },
  // a portal client holds no other role (0062)
  { fragment: 'client_role_exclusive', key: 'admin.errors.clientRoleExclusive' },
  // a currency with no rate cannot be weighed against an authority (0013)
  { fragment: 'no UZS rate for', key: 'limits.errors.noRate' },
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
