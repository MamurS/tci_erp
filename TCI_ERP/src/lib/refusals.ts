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
  // sector grades, country risk and sanctions (0085). The company / country
  // pair first: both texts begin «cover_not_available».
  { fragment: 'cover_not_available: company', key: 'risk.errors.coverCompany' },
  { fragment: 'cover_not_available: country', key: 'risk.errors.coverCountry' },
  { fragment: 'sector_analyst_not_analyst', key: 'risk.errors.sectorAnalystNotAnalyst' },
  { fragment: 'sector_review_kind', key: 'risk.errors.sectorReviewKind' },
  { fragment: 'sector_review_factors', key: 'risk.errors.sectorReviewFactors' },
  { fragment: 'sector_review_narrative_required', key: 'risk.errors.sectorReviewNarrative' },
  { fragment: 'sector_review_pending', key: 'risk.errors.sectorReviewPending' },
  { fragment: 'sector_review_decided', key: 'risk.errors.sectorReviewDecided' },
  { fragment: 'four_eyes_own_sector_review', key: 'risk.errors.sectorReviewOwn' },
  { fragment: 'sector_review_reject_reason', key: 'risk.errors.sectorReviewRejectReason' },
  { fragment: 'country_import_incomplete', key: 'risk.errors.importIncomplete' },
  { fragment: 'country_import_empty', key: 'risk.errors.importEmpty' },
  { fragment: 'country_import_unknown', key: 'risk.errors.importUnknown' },
  { fragment: 'country_import_category', key: 'risk.errors.importCategory' },
  { fragment: 'country_import_duplicate', key: 'risk.errors.importDuplicate' },
  { fragment: 'country_override_justification', key: 'risk.errors.overrideJustification' },
  { fragment: 'country_override_pending', key: 'risk.errors.overridePending' },
  { fragment: 'country_override_head_only', key: 'risk.errors.overrideHeadOnly' },
  { fragment: 'country_override_decided', key: 'risk.errors.overrideDecided' },
  { fragment: 'four_eyes_own_country_override', key: 'risk.errors.overrideOwn' },
  { fragment: 'country_override_reject_reason', key: 'risk.errors.overrideRejectReason' },
  { fragment: 'country_override_end_reason', key: 'risk.errors.overrideEndReason' },
  { fragment: 'sanctions_manage_only', key: 'risk.errors.sanctionsManageOnly' },
  { fragment: 'sanctions_lift_reason', key: 'risk.errors.sanctionsLiftReason' },
  { fragment: 'concentration_scope', key: 'risk.errors.concentrationScope' },
  // authority levels and the committee (0071)
  { fragment: 'named_validator_retired', key: 'limits.validation.errors.namedRetired' },
  { fragment: 'authority_level_missing', key: 'limits.validation.errors.levelMissing' },
  { fragment: 'only a member of the authority level this step sits with may answer it', key: 'limits.validation.errors.notLevelMember' },
  { fragment: 'committee_votes_decide', key: 'limits.validation.errors.committeeVotes' },
  { fragment: 'committee_is_last', key: 'limits.validation.errors.committeeIsLast' },
  { fragment: 'not_a_committee_step', key: 'limits.validation.errors.notCommittee' },
  { fragment: 'committee_vote_invalid', key: 'limits.validation.errors.voteInvalid' },
  { fragment: 'committee_already_voted', key: 'limits.validation.errors.alreadyVoted' },
  { fragment: 'committee_not_eligible', key: 'limits.validation.errors.notEligible' },
  { fragment: 'committee_conflict_reason_required', key: 'limits.validation.errors.conflictReason' },
  { fragment: 'committee_chair_closes', key: 'limits.validation.errors.chairCloses' },
  { fragment: 'committee_no_quorum', key: 'limits.validation.errors.noQuorum' },
  { fragment: 'committee_comment_required', key: 'limits.validation.errors.minutesRequired' },
  { fragment: 'committee_unlimited', key: 'admin.levels.errors.committeeUnlimited' },
  { fragment: 'authority_amount_invalid', key: 'admin.levels.errors.amountInvalid' },
  { fragment: 'authority_routing_invalid', key: 'admin.levels.errors.routingInvalid' },
  { fragment: 'level_member_wrong_department', key: 'admin.levels.errors.wrongDepartment' },
  { fragment: 'level_member_one_rank', key: 'admin.levels.errors.oneRank' },
  { fragment: 'level_member_exists', key: 'admin.levels.errors.memberExists' },
  { fragment: 'chair_committee_only', key: 'admin.levels.errors.chairCommitteeOnly' },
  { fragment: 'chair_not_member', key: 'admin.levels.errors.chairNotMember' },
  // credit analysis (0069). Confirming one's own rating names the rating; the
  // same prefix on a decision names the decision.
  { fragment: 'you calculated this rating and cannot confirm it', key: 'rating.confirmation.errors.ownRating' },
  { fragment: 'four_eyes_own_rating', key: 'limits.errors.fourEyesOwnRating' },
  { fragment: 'rating_confirm_not_allowed', key: 'rating.confirmation.errors.notAllowed' },
  { fragment: 'rating_already_confirmed', key: 'rating.confirmation.errors.alreadyConfirmed' },
  { fragment: 'rating_not_latest', key: 'rating.confirmation.errors.notLatest' },
  { fragment: 'rating_override_comment_required', key: 'rating.confirmation.errors.commentRequired' },
  { fragment: 'rating_grade_invalid', key: 'rating.confirmation.errors.gradeInvalid' },
  { fragment: 'rating_immutable', key: 'rating.confirmation.errors.immutable' },
  { fragment: 'credit_analysis_mode_invalid', key: 'admin.creditAnalysis.errors.modeInvalid' },
  // the rating scorecard (0079)
  { fragment: 'rating_scorecard_required', key: 'rating.scorecard.errors.required' },
  { fragment: 'rating_scorecard_invalid', key: 'rating.scorecard.errors.invalid' },
  { fragment: 'rating_scorecard_weights', key: 'rating.scorecard.errors.weights' },
  { fragment: 'rating_scorecard_reason_invalid', key: 'rating.scorecard.errors.reason' },
  { fragment: 'rating_scorecard_grade_invalid', key: 'rating.scorecard.errors.grade' },
  { fragment: 'rating_scorecard_grade_mismatch', key: 'rating.scorecard.errors.grade' },
  { fragment: 'rating_scorecard_empty', key: 'rating.scorecard.errors.empty' },
  { fragment: 'rating_scorecard_adjustment_reason', key: 'rating.scorecard.errors.adjustment' },
  // rating proposals (0073)
  { fragment: 'rating_propose_not_allowed', key: 'rating.proposals.errors.notAllowed' },
  { fragment: 'rating_proposal_reason_required', key: 'rating.proposals.errors.reasonRequired' },
  { fragment: 'rating_proposal_pending', key: 'rating.proposals.errors.pending' },
  { fragment: 'rating_assessment_mismatch', key: 'rating.proposals.errors.assessmentMismatch' },
  { fragment: 'rating_statement_mismatch', key: 'rating.proposals.errors.statementMismatch' },
  { fragment: 'rating_no_colleague', key: 'rating.proposals.errors.noColleague' },
  { fragment: 'rating_colleague_not_eligible', key: 'rating.proposals.errors.colleagueNotEligible' },
  { fragment: 'rating_route_invalid', key: 'rating.proposals.errors.routeInvalid' },
  { fragment: 'rating_level_missing', key: 'rating.proposals.errors.levelMissing' },
  { fragment: 'rating_not_eligible', key: 'rating.proposals.errors.notEligible' },
  { fragment: 'rating_committee_votes', key: 'rating.proposals.errors.committeeVotes' },
  { fragment: 'rating_top_of_chain', key: 'rating.proposals.errors.committeeIsLast' },
  { fragment: 'rating_not_committee', key: 'rating.proposals.errors.notCommittee' },
  { fragment: 'rating_proposal_closed', key: 'rating.proposals.errors.closed' },
  { fragment: 'rating_modified_same', key: 'rating.proposals.errors.modifiedSame' },
  { fragment: 'rating_withdraw_not_yours', key: 'rating.proposals.errors.withdrawNotYours' },
  { fragment: 'rating_manual_direct', key: 'rating.proposals.errors.manualDirect' },
  // group ratings (0074)
  { fragment: 'group_rating_senior_only', key: 'groups.rating.errors.seniorOnly' },
  { fragment: 'group_rating_reason_required', key: 'groups.rating.errors.reasonRequired' },
  { fragment: 'group_rating_none', key: 'groups.rating.errors.none' },
  { fragment: 'rating_above_group_cap', key: 'groups.rating.errors.aboveCap' },
  { fragment: 'rating_group_cap_direct', key: 'groups.rating.errors.capDirect' },
  { fragment: 'senior_requires_analyst', key: 'admin.senior.errors.requiresAnalyst' },
  // information gathering (0067)
  { fragment: 'limit_not_gathering_information', key: 'limits.information.errors.notGathering' },
  { fragment: 'information_waiver_comment_required', key: 'limits.information.waiveCommentRequired' },
  // admin is a technical role (0065)
  { fragment: 'policy_status_commercial_only', key: 'policies.statusCommercialOnly' },
  { fragment: 'acting_role_not_held', key: 'roles.errors.notHeld' },
  { fragment: 'acting_role_no_session', key: 'roles.errors.noSession' },
  // a portal client holds no other role (0062)
  { fragment: 'client_role_exclusive', key: 'admin.errors.clientRoleExclusive' },
  // the policyholder changes or withdraws a limit request (0075)
  { fragment: 'limit_request_in_review', key: 'portal.limits.change.errors.inReview' },
  { fragment: 'limit_request_not_open', key: 'portal.limits.change.errors.notOpen' },
  { fragment: 'amendment_unchanged', key: 'portal.limits.change.errors.unchanged' },
  { fragment: 'amendment_amount_invalid', key: 'portal.limits.amountInvalid' },
  { fragment: 'amendment_terms_invalid', key: 'portal.limits.change.errors.termsInvalid' },
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
