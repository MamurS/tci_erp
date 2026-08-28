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
