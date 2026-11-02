/**
 * Demo data (migrations 0096–0097): a world of its own. Every business table
 * carries `is_demo`; a person sees and writes ONE world — the demo world while
 * their demo mode is on (`user_profiles.ui_demo_mode`) or they are a demo
 * account (`is_demo_user`), the real world otherwise. The database decides
 * (`tci.demo_mode()`, a restrictive policy per table); this module only
 * groups the counts and names the rules the screens repeat.
 */

/** The 67 tables of `tci.demo_world_tables()`, grouped for the admin screen. */
export const DEMO_AREAS = {
  companies: [
    'legal_entities',
    'financial_statements',
    'balance_sheets',
    'income_statements',
    'local_statement_values',
    'entity_relationships',
    'entity_relationship_suggestions',
    'entity_beneficial_owners',
    'entity_agency_ratings',
    'entity_requests',
    'group_limits',
    'group_ratings',
    'policyholder_tier_overrides',
    'policyholder_users',
    'client_buyer_proposals',
  ],
  credit: [
    'credit_assessments',
    'credit_limit_requests',
    'credit_limit_decisions',
    'decision_conditions',
    'limit_validations',
    'committee_votes',
    'committee_conflicts',
    'limit_information_waivers',
    'limit_request_amendments',
    'rating_proposals',
    'rating_proposal_steps',
    'rating_votes',
    'rating_conflicts',
    'buyer_adt',
    'buyer_adt_blocks',
    'auto_decision_attempts',
    'sector_reviews',
    'country_risk_overrides',
    'sanction_flags',
    'sanctions_screenings',
    'sanctions_matches',
  ],
  policies: [
    'policies',
    'policy_status_history',
    'policy_documents',
    'premium_instalments',
    'premium_entries',
    'premium_payments',
    'bank_statement_imports',
    'bank_statement_lines',
    'declarations',
    'declaration_lines',
    'insurance_requests',
    'insurance_request_buyers',
    'insurance_request_history',
    'commercial_offers',
    'commercial_offer_versions',
    'contract_drafts',
    'contract_versions',
    'contract_draft_comments',
    'contract_draft_status_history',
  ],
  claims: [
    'overdue_notifications',
    'claims',
    'claim_invoices',
    'claim_invoice_verdicts',
    'claim_payments',
    'claim_status_history',
    'claim_documents',
    'recoveries',
  ],
  agenda: ['tasks', 'task_comments', 'task_transfers', 'workflow_events'],
} as const

export type DemoArea = keyof typeof DEMO_AREAS
export const DEMO_AREA_KEYS = Object.keys(DEMO_AREAS) as DemoArea[]

/** What `tci.demo_data_counts()` answers. */
export interface DemoCounts {
  tables: Record<string, number>
  demo_users: number
  loaded: boolean
  loaded_at: string | null
  loaded_by: string | null
  new_users_demo_mode: boolean
}

/** What `tci.delete_demo_data()` answers. */
export interface DemoUnloadResult {
  before: DemoCounts
  after: DemoCounts
  demo_users_removed: number
  demo_users_kept_banned: string[]
}

export interface AreaCount {
  area: DemoArea
  rows: number
}

/** Rows per area, in the fixed order; a table the answer lacks counts 0. */
export function areaCounts(counts: Pick<DemoCounts, 'tables'> | null | undefined): AreaCount[] {
  return DEMO_AREA_KEYS.map((area) => ({
    area,
    rows: DEMO_AREAS[area].reduce((sum, table) => sum + (counts?.tables[table] ?? 0), 0),
  }))
}

export function totalRows(counts: Pick<DemoCounts, 'tables'> | null | undefined): number {
  return Object.values(counts?.tables ?? {}).reduce((sum, n) => sum + n, 0)
}

/** The demo accounts' password, when admin sets one (`seed_demo_data`). */
export const DEMO_PASSWORD_MIN = 12

/** null = acceptable (empty keeps the accounts sign-in-less / unchanged). */
export function demoPasswordProblem(password: string): 'tooShort' | null {
  if (password === '') return null
  return password.length < DEMO_PASSWORD_MIN ? 'tooShort' : null
}

/**
 * The word typed to confirm the unload. Deliberately the same in every
 * language: it is what the reader must recognise, not translate.
 */
export const DEMO_UNLOAD_WORD = 'DEMO'

/** The prefix the database puts on demo companies (and «DEMO-» on policy numbers). */
export const DEMO_NAME_PREFIX = 'DEMO '

/** The person's demo state (their own `user_profiles` row). */
export interface DemoState {
  /** an account that exists only for demonstrations: always in the demo world */
  isDemoUser: boolean
  /** a real person who chose the demo world */
  demoMode: boolean
}

export function inDemoWorld(state: DemoState | null | undefined): boolean {
  return Boolean(state && (state.isDemoUser || state.demoMode))
}

/** A demo account cannot leave the demo world — there is no real one for it. */
export function mayToggleDemo(state: DemoState | null | undefined): boolean {
  return Boolean(state && !state.isDemoUser)
}
