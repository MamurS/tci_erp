/** Rows of the workbench views (migration 0053). Numerics may arrive as strings. */

import type { GradeBand } from '../../../lib/roles'

/** tci.v_limit_request_queue — open requests only. */
export interface QueueRow {
  request_id: string
  status: 'submitted' | 'under_review' | 'escalated'
  buyer_entity_id: string
  buyer_name: string
  buyer_country: string | null
  policy_id: string | null
  insurance_request_id: string | null
  requested_amount: number | string
  currency_code: string
  submitted_at: string | null
  assessment_id: string | null
  grade: string | null
  band: GradeBand
  amount_uzs: number | string | null
  rate_missing: boolean
  my_authority_uzs: number | string
  decide_alone: boolean
}

export const RATING_REASONS = ['no_statements', 'no_rating', 'new_statement', 'stale'] as const
export type RatingReason = (typeof RATING_REASONS)[number]

/** tci.v_rating_worklist — buyers whose rating needs work. */
export interface RatingWorkRow {
  entity_id: string
  buyer_name: string
  buyer_country: string | null
  assessment_id: string | null
  grade: string | null
  rated_at: string | null
  rated_period_end: string | null
  statements_count: number
  latest_period_end: string | null
  latest_fiscal_year: number | null
  open_requests: number
  limits_in_force: number
  band: GradeBand
  reason: RatingReason
}

/** tci.v_group_limit_status — groups against their caps. */
export interface GroupLimitRow {
  ultimate_parent_id: string
  ultimate_parent_name: string
  ultimate_parent_country: string | null
  members_count: number
  members_with_limits: number
  limits_count: number
  policyholders_count: number
  exposure_uzs: number | string
  missing_rates: number
  group_limit_id: string | null
  limit_amount: number | string | null
  limit_currency: string | null
  limit_valid_from: string | null
  limit_valid_to: string | null
  limit_uzs: number | string | null
  utilisation_pct: number | string | null
  over_limit: boolean
}
