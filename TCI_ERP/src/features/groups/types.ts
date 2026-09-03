/** Corporate groups and group exposure (migrations 0038-0041).
 *
 * A group has no record of its own: its identity IS its ultimate parent
 * entity. Everything here is keyed by that.
 */

export const RELATIONSHIP_TYPES = [
  'ownership',
  'control',
  'common_owner',
  'affiliate',
] as const
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number]

export const RELATIONSHIP_SOURCES = ['manual', 'external', 'suggested_accepted'] as const
export type RelationshipSource = (typeof RELATIONSHIP_SOURCES)[number]

export const SUGGESTION_STATUSES = ['open', 'accepted', 'rejected'] as const
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number]

/** The signals a suggestion can be built from, in the order they are shown. */
export const SUGGESTION_SIGNALS = [
  'email_domain',
  'address',
  'contact_person',
  'name_similarity',
  'registration_prefix',
] as const
export type SuggestionSignal = (typeof SUGGESTION_SIGNALS)[number]

/** tci.v_entity_relationships */
export interface EntityRelationship {
  id: string
  parent_entity_id: string
  parent_name: string
  child_entity_id: string
  child_name: string
  relationship_type: RelationshipType
  ownership_pct: number | null
  valid_from: string
  valid_to: string | null
  is_live: boolean
  source: RelationshipSource
  source_note: string | null
  created_by: string
  created_at: string
  updated_at: string
}

/** tci.v_entity_group, one row per group member. */
export interface GroupMembership {
  entity_id: string
  member_id: string
  depth: number
  ultimate_parent_id: string
  member_is_ultimate_parent: boolean
  group_size: number
}

/** tci.v_group_exposure */
export interface GroupExposure {
  ultimate_parent_id: string
  ultimate_parent_name: string
  limits_count: number
  members_with_limits: number
  policies_count: number
  policyholders_count: number
  exposure_uzs: number
  missing_rates: number
}

/** tci.v_group_exposure_lines — one in-force member limit. */
export interface GroupExposureLine {
  ultimate_parent_id: string
  member_id: string
  member_name: string
  policy_id: string
  policy_number: string
  policyholder_id: string
  policyholder_name: string
  decision_id: string
  request_id: string
  scope_id: string
  approved_amount: number
  currency_code: string
  amount_uzs: number | null
  rate_missing: boolean
  valid_until: string | null
}

/** tci.group_limits */
export interface GroupLimit {
  id: string
  ultimate_parent_entity_id: string
  max_amount: number
  currency_code: string
  valid_from: string
  valid_to: string | null
  set_by: string
  comment: string | null
  created_at: string
}

/** What tci.group_exposure_preflight returns — the SAME function the SQL
 * enforcement calls, so the screen cannot disagree with the rule. */
export interface GroupPreflight {
  ultimate_parent_id: string
  group_size: number
  has_group_limit: boolean
  group_limit_id: string | null
  group_limit_amount: number | null
  group_limit_currency: string | null
  group_limit_uzs: number | null
  exposure_uzs: number
  replaced_uzs: number
  added_uzs: number
  exposure_after_uzs: number
  headroom_uzs: number | null
  over_limit: boolean
  utilisation_pct: number | null
  missing_rates: number
}

/** tci.v_entity_suggestions */
export interface RelationshipSuggestion {
  id: string
  entity_a: string
  entity_a_name: string
  entity_b: string
  entity_b_name: string
  signals: Partial<Record<SuggestionSignal, { score: number; value: string }>>
  score: number
  status: SuggestionStatus
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

/** tci.v_group_member_financials — each member's LATEST statement. */
export interface GroupMemberFinancials {
  member_id: string
  member_name: string
  statement_id: string
  fiscal_year: number
  period_end_date: string | null
  currency_code: string
  report_type: string | null
  revenue: number | null
  net_profit: number | null
  total_assets: number | null
  total_equity: number | null
  total_non_current_assets: number | null
  gross_debt: number | null
}

/** tci.v_group_financials — a SIMPLE SUM, not a consolidation. */
export interface GroupFinancials {
  ultimate_parent_id: string
  members_total: number
  members_with_statements: number
  members_missing_statements: number
  currencies: number
  revenue: number | null
  net_profit: number | null
  total_assets: number | null
  total_equity: number | null
  long_term_assets: number | null
  gross_debt: number | null
}
