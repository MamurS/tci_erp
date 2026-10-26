/**
 * The rating scorecard (migration 0079) — pure module.
 *
 * A grade set by a person is built from four PILLARS, after Allianz Trade's
 * underwriting practice: general (soft information), balance sheet (equity
 * and debt), profit and loss (performance) and payment (behaviour and
 * experience). Each pillar carries a grade of the scale — or is not assessed
 * (weight 0) — a weight in per cent and a reason from a fixed list; the
 * weights of the graded pillars sum to 100. The weighted grade is the mean
 * position on the scale (A1 = 1 … D = 7), a half going to the WORSE grade.
 * The overall grade is the weighted one or an adjustment of it, with an
 * overall reason that says which: `consistent_with_subgrades` exactly when it
 * is the weighted grade, an upgrade reason only above it, a downgrade reason
 * only below it.
 *
 * The database decides (tci.rating_scorecard_normalised); this module mirrors
 * it so the form can say what is missing before anything is sent, and
 * `scorecard.test.ts` reads the rules from the migration text.
 */

import type { RatingComponent } from '../../../lib/analytics'
import { GRADE_CODES } from '../../../lib/gradeCatalogue'
import type { GradeBand } from '../../../lib/gradeScale'
import { bandForScore } from '../../../lib/gradeScale'

export const PILLARS = ['general', 'balance_sheet', 'profit_loss', 'payment'] as const
export type Pillar = (typeof PILLARS)[number]

export type PillarPolarity = 'pos' | 'neg' | 'neutral' | 'na'
export type OverallPolarity = 'consistent' | 'up' | 'down' | 'either'

/** tci.rating_scorecard_reasons(), in its order. */
export const PILLAR_REASONS: Record<Pillar, readonly { code: string; polarity: PillarPolarity }[]> = {
  general: [
    { code: 'long_track_record', polarity: 'pos' },
    { code: 'strong_group_support', polarity: 'pos' },
    { code: 'experienced_management', polarity: 'pos' },
    { code: 'strong_market_position', polarity: 'pos' },
    { code: 'diversified_customer_base', polarity: 'pos' },
    { code: 'short_track_record', polarity: 'neg' },
    { code: 'opaque_ownership', polarity: 'neg' },
    { code: 'key_person_dependency', polarity: 'neg' },
    { code: 'weak_market_position', polarity: 'neg' },
    { code: 'customer_concentration', polarity: 'neg' },
    { code: 'adverse_information', polarity: 'neg' },
    { code: 'difficult_sector_or_country', polarity: 'neg' },
    { code: 'limited_information', polarity: 'neutral' },
    { code: 'in_line_with_peers', polarity: 'neutral' },
    { code: 'not_assessed', polarity: 'na' },
  ],
  balance_sheet: [
    { code: 'strong_equity_base', polarity: 'pos' },
    { code: 'low_leverage', polarity: 'pos' },
    { code: 'strong_liquidity', polarity: 'pos' },
    { code: 'sound_working_capital', polarity: 'pos' },
    { code: 'thin_equity', polarity: 'neg' },
    { code: 'negative_equity', polarity: 'neg' },
    { code: 'high_leverage', polarity: 'neg' },
    { code: 'tight_liquidity', polarity: 'neg' },
    { code: 'stretched_working_capital', polarity: 'neg' },
    { code: 'weak_asset_quality', polarity: 'neg' },
    { code: 'outdated_statements', polarity: 'neutral' },
    { code: 'in_line_with_peers', polarity: 'neutral' },
    { code: 'not_assessed', polarity: 'na' },
  ],
  profit_loss: [
    { code: 'revenue_growth', polarity: 'pos' },
    { code: 'solid_profitability', polarity: 'pos' },
    { code: 'strong_interest_cover', polarity: 'pos' },
    { code: 'stable_results', polarity: 'pos' },
    { code: 'revenue_decline', polarity: 'neg' },
    { code: 'margin_pressure', polarity: 'neg' },
    { code: 'loss_making', polarity: 'neg' },
    { code: 'weak_interest_cover', polarity: 'neg' },
    { code: 'volatile_results', polarity: 'neg' },
    { code: 'one_off_items', polarity: 'neutral' },
    { code: 'in_line_with_peers', polarity: 'neutral' },
    { code: 'not_assessed', polarity: 'na' },
  ],
  payment: [
    { code: 'prompt_payment', polarity: 'pos' },
    { code: 'no_negative_experience', polarity: 'pos' },
    { code: 'good_trade_references', polarity: 'pos' },
    { code: 'payment_delays', polarity: 'neg' },
    { code: 'overdue_notifications', polarity: 'neg' },
    { code: 'claims_history', polarity: 'neg' },
    { code: 'collection_or_court_cases', polarity: 'neg' },
    { code: 'limited_payment_experience', polarity: 'neutral' },
    { code: 'not_assessed', polarity: 'na' },
  ],
}

export const OVERALL_REASONS: readonly { code: string; polarity: OverallPolarity }[] = [
  { code: 'consistent_with_subgrades', polarity: 'consistent' },
  { code: 'group_support', polarity: 'up' },
  { code: 'positive_recent_developments', polarity: 'up' },
  { code: 'group_weakness', polarity: 'down' },
  { code: 'country_or_sector_risk', polarity: 'down' },
  { code: 'negative_recent_developments', polarity: 'down' },
  { code: 'limited_information', polarity: 'down' },
  { code: 'payment_behaviour', polarity: 'down' },
  { code: 'analyst_judgement', polarity: 'either' },
]

export type Weights = Record<Pillar, number>

/** workflow_settings.rating_pillar_weights' default (admin may change it). */
export const DEFAULT_WEIGHTS: Weights = { general: 25, balance_sheet: 30, profit_loss: 25, payment: 20 }

export interface PillarInput {
  pillar: Pillar
  /** null = not assessed. */
  grade: string | null
  weight: number
  reason: string | null
  comment: string
}

/** What the database stores (rating_proposals.scorecard). */
export interface StoredScorecard {
  version: number
  pillars: { pillar: Pillar; grade: string | null; weight: number; reason: string; comment: string | null }[]
  weighted_value: number
  weighted_grade: string
  grade: string
  reason: string
}

/** tci.rating_scorecard_of: the scorecard plus the proposal it came with. */
export type ScorecardOf = StoredScorecard & {
  proposal_id: string
  proposed_grade: string
  justification: string
  proposed_at: string
}

const position = (grade: string) => (GRADE_CODES as readonly string[]).indexOf(grade) + 1

/** The weighted grade of the graded pillars: the mean position, a half to
 * the worse grade. null while nothing is graded or the weights are not 100. */
export function weightedGrade(pillars: readonly PillarInput[]): { value: number; grade: string } | null {
  const graded = pillars.filter((p) => p.grade !== null && position(p.grade) > 0 && p.weight > 0)
  const sum = graded.reduce((s, p) => s + p.weight, 0)
  if (graded.length === 0 || sum !== 100) return null
  const value = graded.reduce((s, p) => s + p.weight * position(p.grade as string), 0) / sum
  const at = Math.min(Math.max(Math.floor(value + 0.5), 1), GRADE_CODES.length)
  return { value: Math.round(value * 100) / 100, grade: GRADE_CODES[at - 1] }
}

/** The weights of the graded pillars added up. */
export function weightSum(pillars: readonly PillarInput[]): number {
  return pillars.filter((p) => p.grade !== null).reduce((s, p) => s + p.weight, 0)
}

/** The defaults spread over the graded pillars only, in whole per cents that
 * add up to 100 (largest remainder; ties to the earlier pillar). */
export function rebalance(defaults: Weights, graded: readonly Pillar[]): Weights {
  const out: Weights = { general: 0, balance_sheet: 0, profit_loss: 0, payment: 0 }
  if (graded.length === 0) return out
  const base = graded.reduce((s, p) => s + defaults[p], 0)
  const share = (p: Pillar) => (base > 0 ? (defaults[p] * 100) / base : 100 / graded.length)
  let left = 100
  for (const p of graded) {
    out[p] = Math.floor(share(p))
    left -= out[p]
  }
  const order = [...graded].sort((a, b) => share(b) - Math.floor(share(b)) - (share(a) - Math.floor(share(a))))
  for (let i = 0; left > 0; i = (i + 1) % order.length, left--) out[order[i]] += 1
  return out
}

/** The overall reasons the database accepts for this grade against the
 * weighted one. */
export function overallReasonsFor(final: string, weighted: string): typeof OVERALL_REASONS {
  const f = position(final)
  const w = position(weighted)
  return OVERALL_REASONS.filter((r) =>
    f === w ? r.polarity === 'consistent' : r.polarity === 'either' || r.polarity === (f < w ? 'up' : 'down'),
  )
}

export type ScorecardProblem =
  | 'nothingGraded'
  | 'weights'
  | 'pillarReason'
  | 'overallReason'
  | 'finalGrade'
  | 'commentTooLong'

/** What still keeps the scorecard from being sent, in the database's order. */
export function scorecardProblems(
  pillars: readonly PillarInput[],
  final: string,
  overallReason: string,
): ScorecardProblem[] {
  const out: ScorecardProblem[] = []
  if (pillars.some((p) => p.comment.trim().length > 500)) out.push('commentTooLong')
  if (!pillars.some((p) => p.grade !== null)) {
    out.push('nothingGraded')
    return out
  }
  if (
    weightSum(pillars) !== 100 ||
    pillars.some((p) => (p.grade === null ? p.weight !== 0 : p.weight <= 0 || !Number.isInteger(p.weight)))
  ) {
    out.push('weights')
  }
  if (pillars.some((p) => p.grade !== null && !PILLAR_REASONS[p.pillar].some((r) => r.code === p.reason && r.polarity !== 'na'))) {
    out.push('pillarReason')
  }
  const weighted = weightedGrade(pillars)
  if (!(GRADE_CODES as readonly string[]).includes(final)) out.push('finalGrade')
  else if (weighted && !overallReasonsFor(final, weighted.grade).some((r) => r.code === overallReason)) {
    out.push('overallReason')
  }
  return out
}

/** The payload of tci.submit_rating_scorecard. */
export function scorecardPayload(pillars: readonly PillarInput[], final: string, overallReason: string) {
  return {
    grade: final,
    reason: overallReason,
    pillars: pillars.map((p) => ({
      pillar: p.pillar,
      grade: p.grade,
      weight: p.grade === null ? 0 : p.weight,
      reason: p.grade === null ? null : p.reason,
      comment: p.comment.trim() || null,
    })),
  }
}

/** The pillar each engine factor speaks to. Size and age are soft facts. */
export const FACTOR_PILLAR: Record<string, Pillar> = {
  revenue_usd: 'general',
  age_years: 'general',
  equity_ratio: 'balance_sheet',
  debt_to_assets: 'balance_sheet',
  debt_to_equity: 'balance_sheet',
  current_ratio: 'balance_sheet',
  cash_conversion_cycle: 'balance_sheet',
  total_assets_dynamic: 'balance_sheet',
  debt_to_ebit: 'balance_sheet',
  net_profitability: 'profit_loss',
  interest_coverage: 'profit_loss',
  interest_coverage_dynamic: 'profit_loss',
  revenue_dynamic: 'profit_loss',
}

/** The engine's view of each pillar: the weighted score of its scored
 * factors, read on the served scale (null without one — zone boundaries are
 * never hardcoded). The payment pillar has no engine factor. */
export function engineSuggestions(
  components: readonly RatingComponent[] | undefined,
  bands: GradeBand[] | undefined,
): Partial<Record<Pillar, string>> {
  if (!components?.length || !bands?.length) return {}
  const acc: Partial<Record<Pillar, { w: number; s: number }>> = {}
  for (const c of components) {
    const pillar = FACTOR_PILLAR[c.factor]
    if (!pillar || c.score === null || !(c.weight > 0)) continue
    const a = (acc[pillar] ??= { w: 0, s: 0 })
    a.w += c.weight
    a.s += c.weight * c.score
  }
  const out: Partial<Record<Pillar, string>> = {}
  for (const pillar of PILLARS) {
    const a = acc[pillar]
    const band = a && a.w > 0 ? bandForScore(bands, a.s / a.w) : null
    if (band) out[pillar] = band.code
  }
  return out
}

/** The form's starting point: the engine's suggestions graded, everything
 * else not assessed, the defaults spread over what is graded. */
export function initialPillars(defaults: Weights, suggestions: Partial<Record<Pillar, string>>): PillarInput[] {
  const graded = PILLARS.filter((p) => suggestions[p] !== undefined)
  const weights = rebalance(defaults, graded)
  return PILLARS.map((pillar) => ({
    pillar,
    grade: suggestions[pillar] ?? null,
    weight: weights[pillar],
    reason: null,
    comment: '',
  }))
}
