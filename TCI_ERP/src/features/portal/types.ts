/** Row shapes of the tci.v_client_* views (migration 0025).
 *
 * These deliberately do NOT extend the staff types: the whole point of the
 * views is that a client sees fewer columns, and reusing the staff interface
 * would let a screen reach for a field the database does not return. */

export interface ClientPolicy {
  id: string
  entity_id: string
  entity_name: string
  policy_number: string
  status: string
  product_structure: string | null
  inception_date: string
  expiry_date: string
  currency_code: string
  insured_percentage: number | null
  max_liability_amount: number | null
  max_liability_premium_multiple: number | null
  nql_amount: number | null
  deductible_each_loss: number | null
  aggregate_first_loss: number | null
  premium_rate_pct: number | null
  minimum_premium: number | null
  estimated_annual_turnover: number | null
  discretionary_limit: number | null
  waiting_period_days: number | null
  max_extension_period_days: number | null
  max_payment_terms_days: number | null
  declaration_frequency: string | null
  /** New in 0031: the portal computes the NOA deadline from it. */
  noa_window_days: number | null
}

export interface ClientLimit {
  decision_id: string
  request_id: string
  policy_id: string
  policy_number: string
  buyer_id: string
  buyer_name: string
  buyer_country_code: string | null
  requested_amount: number
  outcome: 'approved' | 'partial' | 'declined' | 'revoked'
  approved_amount: number | null
  currency_code: string
  valid_from: string
  valid_until: string | null
  payment_terms_days: number | null
  decided_at: string
  released_at: string | null
  release_kind: string | null
  conditions_count: number
}

export interface ClientLimitCondition {
  id: string
  decision_id: string
  condition_type: string
  description: string | null
}

export interface ClientLimitHistoryRow {
  decision_id: string
  policy_id: string
  buyer_id: string
  buyer_name: string
  outcome: string
  approved_amount: number | null
  currency_code: string
  valid_from: string
  valid_until: string | null
  payment_terms_days: number | null
  decided_at: string
  released_at: string | null
  lifecycle: string
  superseded: boolean
}

/** A limit the client asked for: either a real request, or a buyer we still
 * have to identify. The `kind` discriminates. */
export interface ClientLimitRequest {
  id: string
  kind: 'request' | 'proposal'
  policy_id: string
  policy_number: string
  buyer_id: string | null
  buyer_name: string | null
  proposed_name: string | null
  requested_amount: number
  currency_code: string
  requested_payment_terms_days: number | null
  justification: string | null
  status: string
  created_at: string
  decided_at: string | null
}

/** Terms are null until the submission reaches client_review — the database
 * nulls them, so the type says so. */
export interface ClientSubmission {
  id: string
  entity_id: string
  entity_name: string
  request_number: string
  status: string
  created_at: string
  submitted_at: string | null
  decided_at: string | null
  bound_policy_id: string | null
  product_structure: string | null
  currency_code: string | null
  insured_percentage: number | null
  premium_rate_pct: number | null
  minimum_premium: number | null
  max_liability_amount: number | null
  max_liability_premium_multiple: number | null
  discretionary_limit: number | null
  nql_amount: number | null
  deductible_each_loss: number | null
  aggregate_first_loss: number | null
  waiting_period_days: number | null
  max_extension_period_days: number | null
  max_payment_terms_days: number | null
  declaration_frequency: string | null
  estimated_annual_turnover: number | null
}

export interface ClientSubmissionBuyer {
  id: string
  request_id: string
  entity_id: string | null
  buyer_name: string | null
  requested_amount: number
  requested_payment_terms_days: number | null
}

export interface ClientSubmissionHistoryRow {
  id: string
  request_id: string
  from_status: string | null
  to_status: string
  changed_at: string
}

/** What tci.client_search_entities returns — four columns, nothing about
 * rating, financials or whether the company is one of our policyholders. */
export interface EntitySearchHit {
  id: string
  name: string
  country_code: string | null
  registration_number: string | null
}

// ---------------------------------------------------------------------------
// Phase 4 (migrations 0026-0030)
// ---------------------------------------------------------------------------

/** tci.v_client_declarations */
export interface ClientDeclaration {
  id: string
  policy_id: string
  policy_number: string
  period_start: string
  period_end: string
  status: 'draft' | 'submitted' | 'accepted' | 'disputed' | 'corrected'
  currency_code: string
  total_insurable_turnover: number
  note: string | null
  submitted_at: string | null
  accepted_at: string | null
  disputed_at: string | null
  /** Addressed to the policyholder: it says what to fix. */
  dispute_note: string | null
  supersedes_id: string | null
  superseded: boolean
  covered_turnover: number | null
  uncovered_excess: number | null
  line_count: number | null
  premium_amount: number | null
  premium_rate_used: number | null
}

/** tci.v_client_declaration_lines */
export interface ClientDeclarationLine {
  id: string
  declaration_id: string
  entity_id: string
  entity_name: string
  insurable_turnover: number
  overdue_amount: number | null
  line_note: string | null
  coverage_basis: 'limit' | 'discretionary' | 'uncovered_excess'
  covered_amount: number
  uncovered_excess: number
  is_frozen: boolean
}

/** tci.v_client_premium */
export interface ClientPremium {
  policy_id: string
  policy_number: string
  currency_code: string
  premium_basis: 'minimum_with_adjustment' | 'as_declared'
  premium_rate_pct: number
  minimum_premium: number
  instalments_total: number
  instalments_paid: number
  instalments_overdue: number
  next_due_date: string | null
  earned_premium: number
  adjustment_amount: number
  premium_due_total: number
  period_closed: boolean
}

/** tci.v_client_premium_instalments */
export interface ClientInstalment {
  id: string
  policy_id: string
  sequence: number
  due_date: string
  amount: number
  status: 'pending' | 'invoiced' | 'paid'
  paid_at: string | null
  overdue: boolean
}

/** tci.v_client_overdue_notifications */
export interface ClientOverdueNotification {
  id: string
  policy_id: string
  policy_number: string
  buyer_entity_id: string
  buyer_name: string
  first_due_date: string
  overdue_amount: number
  currency_code: string
  reported_at: string
  status: 'open' | 'resolved_paid' | 'escalated_to_claim' | 'withdrawn'
  resolved_at: string | null
  notify_by_date: string
  days_past_due: number
  reported_late: boolean
  days_late: number
  limit_suspended: boolean
}

/** tci.v_client_declarable_buyers — the buyers this policy holds limits for.
 * NOT a whitelist: any registry company can be declared, it simply leans on
 * the discretionary limit instead. */
export interface ClientDeclarableBuyer {
  policy_id: string
  entity_id: string
  entity_name: string
  approved_amount: number
  currency_code: string
  valid_until: string | null
}

// ---------------------------------------------------------------------------
// Phase 5 — claims
// ---------------------------------------------------------------------------

/** tci.v_client_claims. The decision reason IS exposed: a refusal the
 * policyholder cannot read is not a decision, it is a silence. The assessor's
 * working notes and the status-history comments are not. */
export interface ClientClaim {
  id: string
  claim_number: string
  policy_id: string
  policy_number: string
  buyer_id: string
  buyer_name: string
  overdue_notification_id: string | null
  status:
    | 'draft'
    | 'submitted'
    | 'under_assessment'
    | 'info_requested'
    | 'approved'
    | 'partially_approved'
    | 'declined'
    | 'paid'
    | 'closed'
    | 'withdrawn'
  cause_of_loss: 'protracted_default' | 'insolvency' | 'other'
  insolvency_reference: string | null
  claimed_amount: number
  currency_code: string
  approved_indemnity: number | null
  filed_at: string | null
  assessed_at: string | null
  decision_reason: string | null
  info_requested_at: string | null
  insured_percentage: number
  waiting_period_days: number
  nql_amount: number
  deductible_each_loss: number | null
  created_at: string
  updated_at: string
}

/** tci.v_client_claim_invoices — the verdict and its reason codes, without the
 * underwriting internals behind them. */
export interface ClientClaimInvoice {
  id: string
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
  effective_verdict: 'covered' | 'partial' | 'not_covered' | null
  effective_covered_amount: number | null
  system_reasons: string[] | null
}

/** tci.v_client_claimable — open overdue accounts that can become a claim. */
export interface ClientClaimable {
  noa_id: string
  policy_id: string
  policy_number: string
  buyer_id: string
  buyer_name: string
  first_due_date: string
  overdue_amount: number
  currency_code: string
  waiting_period_days: number
  claimable_from: string
  claimable_now: boolean
  claim_exists: boolean
}

/** tci.v_client_claim_payments */
export interface ClientClaimPayment {
  id: string
  claim_id: string
  amount: number
  currency_code: string
  paid_at: string
  reference: string | null
}

/** tci.v_client_claim_recoveries — only the policyholder's own side of the
 * split; what the insurer kept is not their business. */
export interface ClientRecovery {
  id: string
  claim_id: string
  received_at: string
  gross_amount: number
  recovery_costs: number
  net_amount: number
  policyholder_share: number
  currency_code: string
  note: string | null
}

/** tci.v_client_claim_documents */
export interface ClientClaimDocument {
  id: string
  claim_id: string
  storage_path: string
  document_type: string
  original_filename: string
  size_bytes: number
  content_type: string
  uploaded_at: string
  uploaded_by_me: boolean
}

/** tci.v_client_tasks — the client's own open tasks, addressed to them by
 * user id. Never by role: every policyholder holds `client`. */
export interface ClientTask {
  id: string
  task_type: string
  object_type: string
  object_id: string
  title_key: string
  params: Record<string, unknown>
  due_at: string | null
  priority: 'normal' | 'high' | 'urgent'
  created_at: string
}

/** What tci.client_claim_readiness returns. */
export interface ClientClaimReadiness {
  blockers: string[]
  required_documents: string[]
  missing_documents: string[]
  eligible_from: string | null
}
