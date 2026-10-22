/** Data requests and the freshness list (migration 0054). */

export const REQUEST_KINDS = ['new_company', 'statements_update'] as const
export type RequestKind = (typeof REQUEST_KINDS)[number]

/** tci.entity_request_status, in the migration's order. */
export const REQUEST_STATUSES = ['new', 'in_progress', 'created', 'linked', 'updated', 'rejected'] as const
export type RequestStatus = (typeof REQUEST_STATUSES)[number]

/** tci.entity_requests */
export interface EntityRequest {
  id: string
  request_number: string
  kind: RequestKind
  requested_name: string | null
  country_code: string | null
  registration_number: string | null
  entity_id: string | null
  note: string | null
  source: 'search' | 'company_card'
  status: RequestStatus
  requested_by: string
  assigned_to: string | null
  assigned_at: string | null
  resolved_by: string | null
  resolved_at: string | null
  resolution_note: string | null
  created_at: string
  updated_at: string
}

/** What tci.request_entity / tci.request_statements_update return. */
export interface RequestResult {
  result: 'requested' | 'already_requested' | 'exists'
  request_id?: string
  request_number?: string
  entity_id?: string
  assigned_to?: string | null
}

/** tci.v_data_freshness, reasons in the view's order. */
export const FRESHNESS_REASONS = ['no_statements', 'stale_statements', 'missing_registry'] as const
export type FreshnessReason = (typeof FRESHNESS_REASONS)[number]

export interface FreshnessRow {
  entity_id: string
  name: string
  country_code: string
  missing_registration: boolean
  missing_address: boolean
  missing_industry: boolean
  statements_count: number
  latest_period_end: string | null
  latest_entered_at: string | null
  is_policyholder: boolean
  is_buyer: boolean
  open_request_id: string | null
  reason: FreshnessReason
}

/** tci.staff_directory() */
export interface StaffMember {
  user_id: string
  full_name: string | null
  email: string
  roles: string[]
}
