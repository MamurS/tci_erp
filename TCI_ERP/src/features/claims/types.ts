/** Claims, coverage verdicts, indemnity, payments and recoveries
 * (migrations 0032-0036).
 *
 * The database is the authority for every rule mirrored here; these types are
 * the shape it hands back. Enum orders match the SQL enums so a `switch` over
 * them is exhaustive in both places.
 */

export const CLAIM_STATUSES = [
  'draft',
  'submitted',
  'under_assessment',
  'info_requested',
  'approved',
  'partially_approved',
  'declined',
  'paid',
  'closed',
  'withdrawn',
] as const
export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

export const CAUSES_OF_LOSS = ['protracted_default', 'insolvency', 'other'] as const
export type CauseOfLoss = (typeof CAUSES_OF_LOSS)[number]

export const COVERAGE_VERDICTS = ['covered', 'partial', 'not_covered'] as const
export type CoverageVerdict = (typeof COVERAGE_VERDICTS)[number]

/** tci.coverage_reason — the machine-readable catalogue. Rendered from
 * `claims.reasons.<code>`; nothing here is ever stored as a sentence. */
export const COVERAGE_REASONS = [
  'covered_by_limit',
  'covered_by_dl',
  'limit_exceeded',
  'dl_exceeded',
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
  'nothing_outstanding',
] as const
export type CoverageReason = (typeof COVERAGE_REASONS)[number]

export const CLAIM_DOCUMENT_TYPES = [
  'invoice',
  'shipping',
  'contract',
  'order',
  'dunning',
  'insolvency_evidence',
  'other',
] as const
export type ClaimDocumentType = (typeof CLAIM_DOCUMENT_TYPES)[number]

/** tci.v_claims */
export interface Claim {
  id: string
  claim_number: string
  policy_id: string
  policy_number: string
  policyholder_entity_id: string
  policyholder_name: string
  buyer_entity_id: string
  buyer_name: string
  overdue_notification_id: string | null
  status: ClaimStatus
  cause_of_loss: CauseOfLoss
  insolvency_reference: string | null
  claimed_amount: number
  currency_code: string
  approved_indemnity: number | null
  /** The trace frozen at approval; null until the claim is approved. */
  indemnity_trace: IndemnityTrace | null
  afl_consumed: number | null
  filed_by: string | null
  filed_at: string | null
  assessed_by: string | null
  assessed_at: string | null
  decision_reason: string | null
  info_requested_at: string | null
  insured_percentage: number
  waiting_period_days: number
  max_extension_period_days: number
  noa_window_days: number
  max_payment_terms_days: number
  discretionary_limit: number
  nql_amount: number
  deductible_each_loss: number | null
  aggregate_first_loss: number | null
  max_liability_amount: number | null
  inception_date: string
  expiry_date: string
  eligible_from: string | null
  invoice_count: number
  assessment_age_days: number | null
  noa_reported_late: boolean | null
  noa_days_late: number | null
  noa_first_due_date: string | null
  created_by: string
  created_at: string
  updated_at: string
}

/** tci.v_claim_invoice_coverage */
export interface ClaimInvoiceCoverage {
  claim_invoice_id: string
  claim_id: string
  invoice_number: string
  invoice_date: string
  shipment_date: string
  due_date: string
  amount: number
  paid_amount: number
  disputed_amount: number
  outstanding_amount: number
  claimable_amount: number
  payment_terms_days: number
  currency_code: string
  note: string | null
  verdict_id: string | null
  system_verdict: CoverageVerdict | null
  system_covered_amount: number | null
  system_reasons: CoverageReason[] | null
  system_detail: CoverageDetail | null
  computed_at: string | null
  override_verdict: CoverageVerdict | null
  override_covered_amount: number | null
  override_justification: string | null
  overridden_by: string | null
  overridden_at: string | null
  effective_verdict: CoverageVerdict | null
  effective_covered_amount: number | null
  is_overridden: boolean
}

/** The numbers behind the reason codes (`system_detail`). */
export interface CoverageDetail {
  basis: 'limit' | 'discretionary' | 'none' | null
  cap: number | null
  balance_before: number | null
  headroom: number | null
  claimable_amount: number | null
  payment_terms_days: number | null
  max_payment_terms_days: number | null
  shipment_date: string | null
  policy_inception: string | null
  policy_expiry: string | null
  discretionary_limit: number | null
  decision_id: string | null
  decision_outcome: string | null
  decision_amount: number | null
  decision_effective_from: string | null
  decision_valid_from: string | null
  decision_valid_until: string | null
  decision_system_generated: boolean | null
  decision_system_reason_key: string | null
}

/** One line of the indemnity trace returned by tci.calculate_indemnity. */
export interface IndemnityStep {
  key: string
  amount: number
  detail: Record<string, unknown>
}

export interface IndemnityTrace {
  claim_id: string
  currency: string
  computed_at: string
  claimed_amount: number
  claimable_amount: number
  disputed_amount: number
  covered_amount: number
  uncovered_amount: number
  /** The threshold that was tested, and whether the covered loss met it. */
  nql_amount: number
  nql_met: boolean
  /** i18n key when the claim is not indemnifiable, else null. */
  not_indemnifiable_reason: string | null
  afl_consumed: number
  payable: number
  fully_covered: boolean
  steps: IndemnityStep[]
}

export interface ClaimDocument {
  id: string
  claim_id: string
  storage_path: string
  document_type: ClaimDocumentType
  original_filename: string
  size_bytes: number
  content_type: string
  uploaded_by: string
  uploaded_at: string
  note: string | null
}

export interface ClaimPayment {
  id: string
  claim_id: string
  amount: number
  currency_code: string
  paid_at: string
  reference: string | null
  created_by: string
  created_at: string
}

export interface Recovery {
  id: string
  claim_id: string
  received_at: string
  gross_amount: number
  recovery_costs: number
  net_amount: number
  insurer_share: number
  policyholder_share: number
  insurer_borne: number
  policyholder_borne: number
  currency_code: string
  note: string | null
  created_by: string
  created_at: string
}

/** tci.v_claim_position — the cumulative money position. */
export interface ClaimPosition {
  claim_id: string
  claim_number: string
  policy_id: string
  entity_id: string
  status: ClaimStatus
  currency_code: string
  claimed_amount: number
  claimable_amount: number
  disputed_amount: number
  covered_amount: number
  uncovered_amount: number
  approved_indemnity: number | null
  afl_consumed: number | null
  paid_total: number
  outstanding_indemnity: number
  recovery_gross: number
  recovery_costs: number
  recovery_insurer: number
  recovery_policyholder: number
  insurer_net_position: number
  policyholder_net_position: number
}

/** tci.v_policy_liability */
export interface PolicyLiability {
  policy_id: string
  policy_number: string
  currency_code: string
  max_liability_amount: number | null
  liability_consumed: number
  liability_remaining: number | null
  aggregate_first_loss: number | null
  afl_consumed: number
  afl_remaining: number | null
  open_claims: number
  claimed_total: number
}

export interface ClaimStatusHistoryRow {
  id: string
  claim_id: string
  from_status: ClaimStatus
  to_status: ClaimStatus
  changed_by: string
  changed_at: string
  comment: string | null
}
