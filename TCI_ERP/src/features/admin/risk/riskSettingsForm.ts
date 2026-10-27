/**
 * Admin › Риски — the bounds of the adjustment table and the risk settings,
 * and who maintains sanctions. Every bound restates a check of migration
 * 0085 (risk_adjustment_settings, workflow_settings, may_manage_sanctions);
 * riskSettingsForm.test.ts locks each one to the migration text. The
 * database still refuses what it must — these only grey out and explain.
 */

import type { RiskAdjustment, SanctionScope } from '../../risk/rules'
import type { RiskSettings } from '../../risk/api'

export interface Bounds {
  min: number
  max: number
}

export const RISK_BOUNDS = {
  /** A rating notch: + is better, − worse. */
  notch: { min: -6, max: 6 },
  /** The authority rank a country's category needs (5 = the committee). */
  rankFloor: { min: 0, max: 5 },
  /** Ranks a sector grade adds. */
  rankAdd: { min: 0, max: 4 },
  /** The informational premium loading, per cent (two decimals). */
  premiumLoading: { min: 0, max: 500 },
  /** The day of the quarter by which the quarterly sector review is due. */
  sectorReviewDueDay: { min: 1, max: 90 },
  /** How old the OECD list may be before it is called stale. */
  oecdStaleMonths: { min: 1, max: 36 },
  /** The concentration warning threshold, per cent. */
  concentrationWarnPct: { min: 1, max: 100 },
} as const satisfies Record<string, Bounds>

/** The grades a line may cap a rating at (none = no cap). */
export const CAP_GRADES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D'] as const
export const COVER_STATES = ['available', 'restricted'] as const

/** Whole number within the bounds. */
export function wholeWithin(value: number | null | undefined, b: Bounds): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= b.min && value <= b.max
}

/** A number of at most two decimals within the bounds (numeric(…,2)). */
export function centsWithin(value: number | null | undefined, b: Bounds): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= b.min &&
    value <= b.max &&
    Math.abs(Math.round(value * 100) - value * 100) < 1e-6
  )
}

export type AdjustmentField = 'notch' | 'cap_grade' | 'cover' | 'rank_floor' | 'rank_add' | 'premium_loading_pct'

/** The fields of a line the database would refuse. */
export function adjustmentProblems(a: RiskAdjustment): AdjustmentField[] {
  const out: AdjustmentField[] = []
  if (!wholeWithin(a.notch, RISK_BOUNDS.notch)) out.push('notch')
  if (a.cap_grade !== null && !(CAP_GRADES as readonly string[]).includes(a.cap_grade)) out.push('cap_grade')
  if (!(COVER_STATES as readonly string[]).includes(a.cover)) out.push('cover')
  if (!wholeWithin(a.rank_floor, RISK_BOUNDS.rankFloor)) out.push('rank_floor')
  if (!wholeWithin(a.rank_add, RISK_BOUNDS.rankAdd)) out.push('rank_add')
  if (!centsWithin(a.premium_loading_pct, RISK_BOUNDS.premiumLoading)) out.push('premium_loading_pct')
  return out
}

export function sameAdjustment(a: RiskAdjustment, b: RiskAdjustment): boolean {
  return (
    a.notch === b.notch &&
    (a.cap_grade ?? null) === (b.cap_grade ?? null) &&
    a.cover === b.cover &&
    a.rank_floor === b.rank_floor &&
    a.rank_add === b.rank_add &&
    Number(a.premium_loading_pct) === Number(b.premium_loading_pct)
  )
}

/** Which rank column a line uses: a country sets the floor, a sector adds
 * (tci.cover_required_rank_internal reads nothing else). */
export function rankColumn(a: Pick<RiskAdjustment, 'dimension'>): 'rank_floor' | 'rank_add' {
  return a.dimension === 'country' ? 'rank_floor' : 'rank_add'
}

export type GeneralSettings = Omit<RiskSettings, 'adjustments'>
export type SettingsField = 'sector_review_due_day' | 'oecd_stale_months' | 'concentration_warn_pct'

export function settingsProblems(s: {
  sector_review_due_day: number | null
  oecd_stale_months: number | null
  concentration_warn_pct: number | null
}): SettingsField[] {
  const out: SettingsField[] = []
  if (!wholeWithin(s.sector_review_due_day, RISK_BOUNDS.sectorReviewDueDay)) out.push('sector_review_due_day')
  if (!wholeWithin(s.oecd_stale_months, RISK_BOUNDS.oecdStaleMonths)) out.push('oecd_stale_months')
  if (!centsWithin(s.concentration_warn_pct, RISK_BOUNDS.concentrationWarnPct)) out.push('concentration_warn_pct')
  return out
}

export function sameSettings(a: GeneralSettings, b: GeneralSettings): boolean {
  return (
    a.sector_review_due_day === b.sector_review_due_day &&
    a.sector_review_four_eyes === b.sector_review_four_eyes &&
    a.oecd_stale_months === b.oecd_stale_months &&
    Number(a.concentration_warn_pct) === Number(b.concentration_warn_pct) &&
    a.client_show_oecd === b.client_show_oecd
  )
}

// ---------------------------------------------------------------------------
// Sanctions
// ---------------------------------------------------------------------------

/**
 * Who maintains sanctions flags — the mirror of tci.may_manage_sanctions:
 * credit analysts since 0091 (admin reads). A compliance role is added HERE
 * and in that one SQL function, nowhere else.
 */
export function mayManageSanctions(roles: readonly string[]): boolean {
  return roles.includes('credit_analyst')
}

/** A flag as the list shows it: in force, set for a later date, or lifted. */
export type FlagState = 'live' | 'scheduled' | 'lifted'

export function flagState(f: { lifted_at: string | null; effective_from: string }, today: string): FlagState {
  if (f.lifted_at) return 'lifted'
  return f.effective_from > today ? 'scheduled' : 'live'
}

export type SanctionFormField = 'target' | 'source' | 'effective_from'

/** What a new flag lacks before it can be sent. */
export function sanctionFormProblems(input: {
  scope: SanctionScope
  countryCode: string | null
  entityId: string | null
  source: string
  effectiveFrom: string
}): SanctionFormField[] {
  const out: SanctionFormField[] = []
  if (input.scope === 'country' ? !input.countryCode : !input.entityId) out.push('target')
  if (!input.source.trim()) out.push('source')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) out.push('effective_from')
  return out
}
