/** Auto decisions on credit limits — the Auto Decision Threshold (migration
 * 0061), after Allianz Trade / Euler Hermes practice. Pure module: the
 * vocabularies the database speaks, who may see and do what, and the small
 * readings the screens need. Every rule here is a MIRROR — the database
 * decides (tci.try_auto_decision, tci.set_buyer_adt …) and refuses by name;
 * adt.test.ts locks each list to the migration text.
 *
 * Who sees what (the migration header): the ADT parameters, the attempts and
 * the report are for credit underwriting and admin only. An auto decision
 * itself is an ordinary decision row marked `system_reason_key =
 * 'limits.auto.adt'`, and that MARK may be shown to every staff member who
 * already sees the decision. */

import { hasRole } from '../../lib/roles'
import type { GradeBand, UserRole } from '../../lib/roles'

/** tci.adt_status. A live ADT is active or suspended; the others are history. */
export const ADT_STATUSES = ['active', 'suspended', 'replaced', 'disabled'] as const
export type AdtStatus = (typeof ADT_STATUSES)[number]

/** Why a submitted request was NOT decided automatically (i18n keys under
 * `limits.auto.reasons.*`), in the order tci.try_auto_decision tests them. */
export const AUTO_DECISION_REASONS = [
  'no_adt',
  'adt_suspended',
  'adt_exhausted',
  'no_policy',
  'policy_not_active',
  'fx_missing',
  'above_adt_amount',
  'no_rating',
  // 0073: a manual rating carries no recommended limit
  'no_recommended_limit',
  'above_recommended',
  'open_noa',
  'claims',
  'limit_revoked',
  'manual_block',
  'no_financials',
  'stale_financials',
  // 0091: a possible sanctions match not yet reviewed
  'sanctions_match',
  'group_limit',
  // 0085: the buyer's country or sector needs a higher authority rank, or
  // cover is blocked — never decided automatically
  'cover_restricted',
] as const
export type AutoDecisionReason = (typeof AUTO_DECISION_REASONS)[number]

/** The stop factors of tci.adt_buyer_stops, in its order: true of the buyer
 * whatever the request. */
export const ADT_BUYER_STOPS = [
  'open_noa',
  'claims',
  'limit_revoked',
  'manual_block',
  'no_financials',
  'stale_financials',
  // 0091: a possible sanctions match not yet reviewed
  'sanctions_match',
] as const

/** Why a live ADT is suspended (buyer_adt.suspended_reason): a downgrade
 * below the band it was set at, or the first stop factor found. The same
 * keys as the stops, plus `downgrade`. */
export const ADT_SUSPENSION_REASONS = ['downgrade', ...ADT_BUYER_STOPS] as const
export type AdtSuspensionReason = (typeof ADT_SUSPENSION_REASONS)[number]

/** «Пересмотр байера / обновить ADT» (adt_review): used up, or suspended for
 * one of the suspension reasons. Each has its title key
 * `agenda.tasks.adt_review_<reason>`. */
export const ADT_REVIEW_REASONS = ['exhausted', ...ADT_SUSPENSION_REASONS] as const
export type AdtReviewReason = (typeof ADT_REVIEW_REASONS)[number]

/** The system_reason_key of an auto decision — itself an i18n key. */
export const AUTO_DECISION_REASON_KEY = 'limits.auto.adt'

/** The system reasons a decision row can carry (0028, 0034, 0061). Each is
 * an i18n key, rendered as the decision's mark instead of an author. */
export const SYSTEM_REASON_KEYS = [
  'limits.systemReason.noaSuspension',
  'limits.systemReason.claimApproved',
  AUTO_DECISION_REASON_KEY,
] as const

/** The deep-link target of the ADT block on the buyer card. */
export const ADT_FOCUS = 'adt'

/** Bounds of the two settings (the check constraints of 0061). */
export const ADT_SETTINGS_BOUNDS = {
  validityMonths: { min: 1, max: 60 },
  financialsMaxAgeMonths: { min: 3, max: 60 },
} as const

/** Bounds of an ADT's number of auto decisions (buyer_adt.total_count:
 * 0061's 1–1000, capped at five by 0083 — owner, 2026-10-27). */
export const ADT_COUNT_BOUNDS = { min: 1, max: 5 } as const

/** What the form offers: every count from one to five. */
export const ADT_COUNT_CHOICES: readonly number[] = Array.from(
  { length: ADT_COUNT_BOUNDS.max - ADT_COUNT_BOUNDS.min + 1 },
  (_, i) => ADT_COUNT_BOUNDS.min + i,
)

// ---------------------------------------------------------------------------
// Who
// ---------------------------------------------------------------------------

/** The credit desk — credit analysts too since 0073 — and admin READ the
 * ADT block, the attempts and the report (the RLS of 0061, 0073). */
export function canSeeAdt(roles: readonly UserRole[]): boolean {
  return hasRole(roles, 'admin', 'credit_underwriter', 'credit_analyst')
}

/** Credit underwriting and, since 0073, credit analysts set, disable or ban
 * an ADT, within their own authority grants for the buyer's band — admin
 * makes no business decisions (tci.require_role('credit_underwriter',
 * 'credit_analyst')). */
export function canSetAdt(roles: readonly UserRole[]): boolean {
  return hasRole(roles, 'credit_underwriter', 'credit_analyst')
}

/** Only admin switches auto decisions on or off (set_auto_decision_settings). */
export function canManageAutoDecisions(roles: readonly UserRole[]): boolean {
  return hasRole(roles, 'admin')
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface AutoDecisionSettings {
  enabled: boolean
  validity_months: number
  financials_max_age_months: number
}

export interface AdtLive {
  id: string
  status: Extract<AdtStatus, 'active' | 'suspended'>
  max_amount: number
  currency: string
  total: number
  used: number
  remaining: number
  grade_band: GradeBand
  suspended_reason: string | null
  suspended_at: string | null
  comment: string | null
  set_by: string
  set_by_name: string | null
  set_at: string
}

export interface AdtBlock {
  blocked: boolean
  reason: string | null
  set_at: string
  set_by_name: string | null
}

export interface AdtHistoryRow {
  id: string
  status: AdtStatus
  max_amount: number
  currency: string
  total: number
  used: number
  grade_band: GradeBand
  set_by_name: string | null
  set_at: string
  ended_at: string | null
  suspended_reason: string | null
  comment: string | null
}

/** tci.buyer_adt_state(p_entity_id). */
export interface AdtState {
  enabled: boolean
  live: AdtLive | null
  block: AdtBlock | null
  history: AdtHistoryRow[]
}

/** tci.auto_decision_attempts.snapshot — what the rule saw. */
export interface AttemptSnapshot {
  rating_grade?: string | null
  rating_score?: number | string | null
  grade_band?: GradeBand | null
  assessment_id?: string | null
  recommended_limit?: number | string | null
  recommended_currency?: string | null
  requested_amount?: number | string | null
  requested_currency?: string | null
  adt_id?: string | null
  adt_max_amount?: number | string | null
  adt_currency?: string | null
  adt_total?: number | null
  adt_used_before?: number | null
  adt_remaining_before?: number | null
  /** Only on a decided attempt. */
  adt_remaining_after?: number | null
}

export interface AutoDecisionAttempt {
  id: string
  request_id: string
  entity_id: string
  policy_id: string | null
  adt_id: string | null
  decided: boolean
  decision_id: string | null
  reasons: string[]
  snapshot: AttemptSnapshot
  attempted_at: string
}

/** tci.v_auto_decisions row. */
export interface AutoDecisionRow {
  attempt_id: string
  decided_at: string
  request_id: string
  decision_id: string
  buyer_id: string
  buyer_name: string
  policy_id: string | null
  policy_number: string | null
  policyholder_id: string | null
  policyholder_name: string | null
  amount: number | string
  currency_code: string
  lifecycle: string
  valid_until: string | null
  adt_id: string | null
  adt_max_amount: number | string | null
  adt_currency: string | null
  adt_total: number | null
  adt_status: AdtStatus | null
  adt_remaining_now: number | null
  snapshot: AttemptSnapshot
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Reads buyer_adt_state's jsonb: numerics arrive as strings or numbers. An
 * answer that is not the object the function returns reads as nothing. */
export function parseAdtState(raw: unknown): AdtState | null {
  if (!isObject(raw) || !('enabled' in raw)) return null
  const live = isObject(raw.live) ? (raw.live as unknown as AdtLive) : null
  const block = isObject(raw.block) ? (raw.block as unknown as AdtBlock) : null
  const history = Array.isArray(raw.history) ? (raw.history as AdtHistoryRow[]) : []
  return {
    enabled: raw.enabled === true,
    live: live && {
      ...live,
      max_amount: num(live.max_amount) ?? 0,
      total: num(live.total) ?? 0,
      used: num(live.used) ?? 0,
      remaining: num(live.remaining) ?? 0,
    },
    block,
    history: history.map((h) => ({
      ...h,
      max_amount: num(h.max_amount) ?? 0,
      total: num(h.total) ?? 0,
      used: num(h.used) ?? 0,
    })),
  }
}

/** Reads auto_decision_settings()' jsonb. */
export function parseSettings(raw: unknown): AutoDecisionSettings | null {
  if (!isObject(raw) || !('enabled' in raw)) return null
  return {
    enabled: raw.enabled === true,
    validity_months: num(raw.validity_months) ?? 12,
    financials_max_age_months: num(raw.financials_max_age_months) ?? 15,
  }
}

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

export function adtStatusTone(status: AdtStatus): 'pos' | 'warn' | 'neutral' {
  if (status === 'active') return 'pos'
  if (status === 'suspended') return 'warn'
  return 'neutral'
}

/** A reason key the screens can name; anything else is shown as «—». */
export function isKnownReason(key: string | null | undefined): key is AutoDecisionReason | 'downgrade' {
  return (
    typeof key === 'string' &&
    ((AUTO_DECISION_REASONS as readonly string[]).includes(key) || key === 'downgrade')
  )
}

/** The mark a decision carries instead of an author: the i18n key of its
 * system reason (an auto decision, an NOA or claim suspension), or null for
 * a decision a person made. */
export function decisionMarkKey(d: {
  system_reason_key?: string | null
  system_generated?: boolean | null
}): string | null {
  const key = d.system_reason_key ?? null
  return key && (SYSTEM_REASON_KEYS as readonly string[]).includes(key) ? key : null
}

export function isAutoDecision(d: { system_reason_key?: string | null }): boolean {
  return d.system_reason_key === AUTO_DECISION_REASON_KEY
}

/** Mirror of set_buyer_adt's authority test: nobody may set an ADT whose
 * amount in UZS is above their authority for the band of the buyer's latest
 * rating (since 0063 admin is not exempt). Null when it cannot be told here (no rate, or
 * the authority not loaded) — the database says. A HINT only. */
export function adtWithinAuthority(input: {
  amountUzs: number | null
  authorityUzs: number | null
}): boolean | null {
  if (input.amountUzs === null || input.authorityUzs === null) return null
  return input.amountUzs <= input.authorityUzs
}

/** What the set form will accept before the database is asked. */
export function adtFormValid(input: { amount: number | null; count: number | null; currency: string }): boolean {
  return (
    input.amount !== null &&
    input.amount > 0 &&
    input.count !== null &&
    Number.isInteger(input.count) &&
    input.count >= ADT_COUNT_BOUNDS.min &&
    input.count <= ADT_COUNT_BOUNDS.max &&
    input.currency.length === 3
  )
}

/** A ban needs a reason (set_buyer_adt_block's adt_block_reason). */
export function banNeedsReason(blocked: boolean, reason: string): boolean {
  return blocked && reason.trim() === ''
}

export function settingsValid(input: { validityMonths: number | null; financialsMaxAgeMonths: number | null }): boolean {
  const { validityMonths: v, financialsMaxAgeMonths: f } = input
  const within = (n: number | null, b: { min: number; max: number }) =>
    n !== null && Number.isInteger(n) && n >= b.min && n <= b.max
  return within(v, ADT_SETTINGS_BOUNDS.validityMonths) && within(f, ADT_SETTINGS_BOUNDS.financialsMaxAgeMonths)
}

/** The latest attempt for a request (attempts are append-only). */
export function latestAttempt<T extends { attempted_at: string }>(attempts: readonly T[]): T | null {
  return attempts.reduce<T | null>((best, a) => (best === null || a.attempted_at > best.attempted_at ? a : best), null)
}

/** The distinct buyers of the report, by name, for its filter. */
export function reportBuyers(rows: readonly Pick<AutoDecisionRow, 'buyer_id' | 'buyer_name'>[]): { id: string; name: string }[] {
  const seen = new Map<string, string>()
  for (const r of rows) if (!seen.has(r.buyer_id)) seen.set(r.buyer_id, r.buyer_name)
  return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

export function filterReport<T extends Pick<AutoDecisionRow, 'buyer_id'>>(rows: readonly T[], buyerId: string): T[] {
  return buyerId ? rows.filter((r) => r.buyer_id === buyerId) : [...rows]
}

// ---------------------------------------------------------------------------
// Optimistic paints: only what the function is CERTAIN to do
// ---------------------------------------------------------------------------

/** set_buyer_adt_block: the ban (or its lifting) is recorded as asked, and a
 * ban suspends an ACTIVE live ADT for `manual_block` (an already suspended
 * one keeps its first reason — suspend_buyer_adt is idempotent). Lifting the
 * ban does not reinstate anything: that is a new ADT. */
export function withBlock(state: AdtState, blocked: boolean, reason: string | null, nowIso: string): AdtState {
  const trimmed = reason?.trim() ? reason.trim() : null
  const live =
    blocked && state.live?.status === 'active'
      ? { ...state.live, status: 'suspended' as const, suspended_reason: 'manual_block', suspended_at: nowIso }
      : state.live
  return {
    ...state,
    live,
    block: { blocked, reason: trimmed, set_at: nowIso, set_by_name: state.block?.set_by_name ?? null },
    history: live && live !== state.live ? state.history.map((h) => (h.id === live.id ? { ...h, status: 'suspended', suspended_reason: 'manual_block' } : h)) : state.history,
  }
}

/** disable_buyer_adt: the live ADT ends as `disabled`; history keeps it. */
export function withoutLive(state: AdtState, nowIso: string): AdtState {
  const id = state.live?.id
  return {
    ...state,
    live: null,
    history: state.history.map((h) =>
      h.id === id ? { ...h, status: 'disabled', ended_at: nowIso, suspended_reason: null } : h,
    ),
  }
}

export { num as adtNumber }
