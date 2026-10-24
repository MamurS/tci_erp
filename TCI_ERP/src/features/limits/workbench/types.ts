/** Rows of the workbench views (migration 0053). Numerics may arrive as strings. */

import type { GradeBand } from '../../../lib/roles'
import type { GroupLimitStatus } from '../../groups/types'

/** tci.v_limit_request_queue — open requests only. */
export interface QueueRow {
  request_id: string
  status: 'submitted' | 'information_gathering' | 'under_review' | 'escalated'
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
  /** The caller raised it: four eyes, never theirs to review or decide (0063). */
  own_request: boolean
  /** What the buyer still lacks, while the request gathers information (0067). */
  information_gaps: string[] | null
}

/** In the order the view tests them; 'unconfirmed' (0069) only in separate mode. */
export const RATING_REASONS = ['no_statements', 'no_rating', 'new_statement', 'stale', 'unconfirmed'] as const
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
  /** 0069: the engine's grade and when the grade in force was confirmed. */
  engine_grade: string | null
  confirmed_at: string | null
}

/** tci.v_group_limit_status — groups against their caps. The group tab reads
 * the same view, so the row type lives with the groups feature. */
export type GroupLimitRow = GroupLimitStatus
