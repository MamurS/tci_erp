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
