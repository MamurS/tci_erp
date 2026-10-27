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
  // Data management (migration 0054)
  'entity_requested',
  'statements_requested',
  'entity_request_resolved',
  // Agenda redesign (migration 0055)
  'rating_new_statements',
  // Premium payments (migration 0056)
  'premium_payment_unmatched',
  // Contract drafts (migration 0057)
  'contract_review',
  // Commercial offers (migration 0058)
  'offer_viewed',
  'offer_expiring',
  'offer_expired',
  // Limit validation (migration 0060)
  'limit_validation',
  'limit_validation_result',
  // Auto decisions (migration 0061)
  'adt_review',
  // Information gathering before a limit decision (migration 0067)
  'limit_information_needed',
  // Authority levels (migration 0071): a rank the direct routing skipped is
  // told, for information
  'limit_validation_fyi',
  // Rating proposals (migrations 0072–0073): a suggested grade waits for a
  // colleague or a level; the proposer hears how it ended
  'rating_proposal',
  'rating_proposal_result',
  // Sector grades, country risk and sanctions (migrations 0084–0085): the
  // responsible analyst's quarterly review, a second analyst's approval
  // (four eyes, when on), credit underwriting's look at the buyers of a
  // sector downgraded to C/D, an in-force limit on a newly sanctioned party
  // (urgent), and the head of credit analysis approving an internal country
  // grade
  'sector_review_due',
  'sector_review_approval',
  'sector_downgrade_review',
  'sanctions_limit_review',
  'country_override_approval',
  // Keeping the OECD list current (migrations 0086–0087): admin is reminded
  // to check for a newer list; credit underwriting looks at the buyers in
  // countries a new list made worse
  'oecd_review_due',
  'country_downgrade_review',
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
  // a buyer a client proposed from the portal (0025)
  | 'client_buyer_proposal'
  // a request for a company or for statements (0054)
  | 'entity_request'
  // a bank statement (or accounting feed) with payments to resolve (0056)
  | 'bank_statement_import'
  // a contract draft under review (0057)
  | 'contract_draft'
  // a commercial offer out with the client (0058)
  | 'commercial_offer'
  // a limit decision waiting for (or answered by) a validator (0060)
  | 'limit_validation'
  // a rating proposal waiting for (or answered by) a colleague or a level (0073)
  | 'rating_proposal_step'
  // a sector (one per industry) and its reviews (0085)
  | 'sector'
  // an internal country grade waiting for the head of credit analysis (0085)
  | 'country_risk_override'
  // the OECD list in use (the nil uuid when there is none) — the reminder (0087)
  | 'country_risk_list'
  // an imported OECD list that made countries worse (0087)
  | 'country_risk_import'

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
  /** Out of sight until this moment (0055); null when not snoozed. Per task:
   * a department task snoozed by one person is snoozed for the department. */
  snoozed_until: string | null
  snoozed_by: string | null
}

/** A comment on a task (tci.task_comments, 0055). Append-only. */
export interface TaskComment {
  id: string
  task_id: string
  author_id: string
  body: string
  created_at: string
}
