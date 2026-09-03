/** The Agenda task engine (migration 0024). Rows in tci.tasks are GENERATED
 * from tci.workflow_events — nothing here ever writes one. */

import type { UserRole } from '../../lib/roles'

export const TASK_TYPES = [
  'buyer_needs_entity',
  'buyer_needs_rating',
  'limit_needs_decision',
  'limit_escalated',
  'submission_commercial_review',
  'submission_sales_confirmation',
  'limit_held',
  'submission_accepted',
  'submission_declined',
  'limit_review_due',
  'rating_stale',
  // Phase 4 (migration 0029)
  'declaration_due',
  'declaration_overdue',
  'declaration_awaiting_acceptance',
  'instalment_due',
  'instalment_overdue',
  'noa_credit_review',
  'uncovered_excess_review',
  // Phase 5 (migration 0036)
  'noa_matured_to_claim',
  'claim_ready_to_file',
  'claim_submitted',
  'claim_info_requested',
  'claim_awaiting_payment',
  'claim_limit_reinstatement',
  'claim_declined_review',
  // Phase 6 (migration 0041)
  'group_exposure_near_limit',
  'group_limit_missing',
] as const

export type TaskType = (typeof TASK_TYPES)[number]

export const TASK_PRIORITIES = ['urgent', 'high', 'normal'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export type TaskStatus = 'open' | 'done' | 'cancelled'

/** Object kinds a task can hang off (tci.tasks.object_type). */
export type TaskObjectType =
  | 'insurance_request'
  | 'legal_entity'
  | 'credit_limit_request'
  | 'credit_limit_decision'
  | 'declaration'
  | 'policy'
  | 'premium_instalment'
  | 'overdue_notification'
  | 'claim'

export interface Task {
  id: string
  task_type: TaskType
  object_type: TaskObjectType
  object_id: string
  /** i18n key — the DB never stores rendered text. */
  title_key: string
  params: Record<string, unknown>
  target_role: UserRole | null
  target_user: string | null
  due_at: string | null
  priority: TaskPriority
  status: TaskStatus
  completed_by: string | null
  completed_at: string | null
  source_event_id: string | null
  created_at: string
}
