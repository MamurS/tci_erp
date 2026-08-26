/** Row types mirroring the `tci` schema (migration 0013). */

export const LIMIT_REQUEST_STATUSES = [
  'draft', 'submitted', 'under_review', 'escalated', 'decided', 'withdrawn',
] as const
export type LimitRequestStatus = (typeof LIMIT_REQUEST_STATUSES)[number]

export const DECISION_OUTCOMES = ['approved', 'partial', 'declined', 'revoked'] as const
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number]

export const DECISION_LIFECYCLES = ['effective', 'superseded', 'expired', 'revoked_lc'] as const
export type DecisionLifecycle = (typeof DECISION_LIFECYCLES)[number]

export const CONDITION_TYPES = [
  'security', 'appraisal', 'reporting', 'payment_terms', 'other',
] as const
export type ConditionType = (typeof CONDITION_TYPES)[number]

export interface CreditLimitRequest {
  id: string
  policy_id: string
  buyer_id: string
  requested_amount: number
  currency_code: string
  requested_payment_terms_days: number | null
  justification: string | null
  status: LimitRequestStatus
  requested_by: string
  submitted_at: string | null
  decided_at: string | null
  withdrawn_at: string | null
  withdraw_comment: string | null
  created_at: string
  updated_at: string
}

export interface LimitRequestWithRefs extends CreditLimitRequest {
  buyers: { name: string } | null
  policies: {
    policy_number: string
    currency_code: string
    policyholder_id: string
    policyholders: { name: string } | null
  } | null
}

export interface DecisionCondition {
  id: string
  decision_id: string
  condition_type: ConditionType
  description: string
}

export interface CreditLimitDecision {
  id: string
  request_id: string
  outcome: DecisionOutcome
  approved_amount: number | null
  currency_code: string
  valid_from: string
  valid_until: string | null
  based_on_assessment_id: string | null
  comment: string | null
  decided_by: string
  decided_at: string
  lifecycle: DecisionLifecycle
}

export interface DecisionWithConditions extends CreditLimitDecision {
  decision_conditions: DecisionCondition[]
}

/** tci.v_effective_limits row. */
export interface EffectiveLimit {
  decision_id: string
  policy_id: string
  buyer_id: string
  request_id: string
  requested_amount: number
  outcome: DecisionOutcome
  approved_amount: number | null
  currency_code: string
  valid_from: string
  valid_until: string | null
  based_on_assessment_id: string | null
  comment: string | null
  decided_by: string
  decided_at: string
  conditions_count: number
}

/** tci.v_buyer_exposure row. */
export interface BuyerExposure {
  buyer_id: string
  policies_count: number
  exposure_uzs: number | null
  missing_rates: number
}

export interface UnderwritingAuthority {
  id: string
  user_id: string
  max_amount: number
  currency_code: string
  valid_from: string
  valid_to: string | null
}

export interface ConditionInput {
  condition_type: ConditionType
  description: string
}
