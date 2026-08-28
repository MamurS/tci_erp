/** Overdue notifications — NOA (migration 0028). Not a claim: an NOA that
 * becomes one is marked `escalated_to_claim` and handed to that phase. */

export const NOA_STATUSES = [
  'open',
  'resolved_paid',
  'escalated_to_claim',
  'withdrawn',
] as const
export type NoaStatus = (typeof NOA_STATUSES)[number]

/** tci.v_overdue_notifications — ageing and lateness already derived. */
export interface OverdueNotification {
  id: string
  policy_id: string
  policy_number: string
  policyholder_entity_id: string
  policyholder_name: string
  buyer_entity_id: string
  buyer_name: string
  first_due_date: string
  overdue_amount: number
  currency_code: string
  reported_at: string
  reported_by: string | null
  status: NoaStatus
  resolution_note: string | null
  resolved_at: string | null
  suspension_decision_id: string | null
  limit_suspended: boolean
  max_extension_period_days: number
  noa_window_days: number
  notify_by_date: string
  days_past_due: number
  reported_late: boolean
  days_late: number
  created_at: string
  updated_at: string
}
