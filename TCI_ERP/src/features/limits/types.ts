/** Row types mirroring the `tci` schema (migrations 0013, 0017). */

import type { AuthorityScope, GradeBand } from '../../lib/roles'

export const LIMIT_REQUEST_STATUSES = [
  'draft', 'submitted', 'under_review', 'escalated', 'decided', 'withdrawn',
] as const
export type LimitRequestStatus = (typeof LIMIT_REQUEST_STATUSES)[number]

export const DECISION_OUTCOMES = ['approved', 'partial', 'declined', 'revoked'] as const
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number]

export const DECISION_LIFECYCLES = ['effective', 'superseded', 'expired', 'revoked_lc'] as const
export type DecisionLifecycle = (typeof DECISION_LIFECYCLES)[number]

/** Two-stage decisions (migration 0020): credit underwriting owns the risk
 * view; commercial underwriting may re-shape ONLY amount and payment terms. */
export const DECISION_STAGES = ['credit', 'commercial'] as const
export type DecisionStage = (typeof DECISION_STAGES)[number]

export const RELEASE_KINDS = ['sales_confirmed', 'silent_consent', 'immediate'] as const
export type ReleaseKindValue = (typeof RELEASE_KINDS)[number]

export const CONDITION_TYPES = [
  'security', 'appraisal', 'reporting', 'payment_terms', 'other',
] as const
export type ConditionType = (typeof CONDITION_TYPES)[number]

export interface CreditLimitRequest {
  id: string
  policy_id: string
  entity_id: string
  requested_amount: number
  currency_code: string
  requested_payment_terms_days: number | null
  justification: string | null
  status: LimitRequestStatus
  /** Set when the request was raised inside an insurance submission
   * (migration 0019); null for standalone in-force requests. */
  insurance_request_id: string | null
  requested_by: string
  submitted_at: string | null
  decided_at: string | null
  withdrawn_at: string | null
  withdraw_comment: string | null
  created_at: string
  updated_at: string
}

export interface LimitRequestWithRefs extends CreditLimitRequest {
  legal_entities: { name: string } | null
  policies: {
    policy_number: string
    currency_code: string
    entity_id: string
    legal_entities: { name: string } | null
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
  // Stage + release (migration 0020)
  stage: DecisionStage
  adjusts_decision_id: string | null
  payment_terms_days: number | null
  released_at: string | null
  release_kind: ReleaseKindValue | null
  held: boolean
  hold_comment: string | null
}

export interface DecisionWithConditions extends CreditLimitDecision {
  decision_conditions: DecisionCondition[]
}

/** tci.v_effective_limits row. */
export interface EffectiveLimit {
  decision_id: string
  policy_id: string
  entity_id: string
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
  insurance_request_id: string | null
  // Stage precedence + release state (migration 0020)
  stage: DecisionStage
  payment_terms_days: number | null
  credit_decision_id: string
  credit_amount: number | null
  commercially_adjusted: boolean
  released_at: string | null
  release_kind: ReleaseKindValue | null
  held: boolean
  hold_comment: string | null
  client_visible: boolean
}

/** tci.v_buyer_exposure row. */
export interface BuyerExposure {
  entity_id: string
  policies_count: number
  exposure_uzs: number | null
  missing_rates: number
}

/** tci.authority_grants row - the 2D authority matrix (migration 0017). */
export interface AuthorityGrant {
  id: string
  user_id: string
  applies_to: AuthorityScope
  grade_band: GradeBand
  max_amount: number
  currency_code: string
  valid_from: string
  valid_to: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface ConditionInput {
  condition_type: ConditionType
  description: string
}
