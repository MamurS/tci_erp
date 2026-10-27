/**
 * Sector grades, country risk and sanctions (Prompt 31, migration 0085) — the
 * pure rules the screens mirror. The database decides every one of them; the
 * screens use these to grey out, warn and explain before anything is sent.
 * rules.test.ts locks each list and rule to the text of 0085.
 */

/** A sector grade, better to worse (tci.sector_reviews.grade). */
export const SECTOR_GRADES = ['A', 'B', 'C', 'D'] as const
export type SectorGrade = (typeof SECTOR_GRADES)[number]

export const OUTLOOKS = ['positive', 'stable', 'negative'] as const
export type Outlook = (typeof OUTLOOKS)[number]

/** The seven factors of a sector review, in tci.sector_factor_keys() order. */
export const SECTOR_FACTORS = [
  'demand',
  'prices_margins',
  'payment_insolvency',
  'financing',
  'regulation',
  'technology',
  'import_fx',
] as const
export type SectorFactor = (typeof SECTOR_FACTORS)[number]

export const FACTOR_SCORES = ['favourable', 'neutral', 'adverse'] as const
export type FactorScore = (typeof FACTOR_SCORES)[number]

export type SectorFactors = Record<SectorFactor, { score: FactorScore; note: string }>

export const REVIEW_KINDS = ['quarterly', 'ad_hoc'] as const
export type ReviewKind = (typeof REVIEW_KINDS)[number]

/** OECD Country Risk Classification, 0 (lowest risk) … 7. */
export const COUNTRY_CATEGORIES = [0, 1, 2, 3, 4, 5, 6, 7] as const
/** The keys of the cover matrix: a category, or not classified (never 0). */
export const COUNTRY_KEYS = ['0', '1', '2', '3', '4', '5', '6', '7', 'unclassified'] as const
export type CountryKey = (typeof COUNTRY_KEYS)[number]

export const SANCTION_REGIMES = ['UN', 'OFAC', 'EU', 'UK', 'national', 'other'] as const
export type SanctionRegime = (typeof SANCTION_REGIMES)[number]

export const SANCTION_SCOPES = ['country', 'entity'] as const
export type SanctionScope = (typeof SANCTION_SCOPES)[number]

/** Why cover is not available (tci.cover_block): the company itself, or its
 * country. The words never name a regime — they may reach a client. */
export type CoverBlock = 'company' | 'country'

/** One row of tci.risk_adjustment_settings. */
export interface RiskAdjustment {
  dimension: 'sector' | 'country'
  key: string
  notch: number
  cap_grade: string | null
  cover: 'available' | 'restricted'
  rank_floor: number
  rank_add: number
  premium_loading_pct: number
}

/** The defaults 0085 seeds (the owner may change them on Admin). */
export const DEFAULT_ADJUSTMENTS: readonly RiskAdjustment[] = [
  { dimension: 'sector', key: 'A', notch: 1, cap_grade: null, cover: 'available', rank_floor: 0, rank_add: 0, premium_loading_pct: 0 },
  { dimension: 'sector', key: 'B', notch: 0, cap_grade: null, cover: 'available', rank_floor: 0, rank_add: 0, premium_loading_pct: 0 },
  { dimension: 'sector', key: 'C', notch: -1, cap_grade: null, cover: 'available', rank_floor: 0, rank_add: 0, premium_loading_pct: 10 },
  { dimension: 'sector', key: 'D', notch: -2, cap_grade: null, cover: 'available', rank_floor: 0, rank_add: 1, premium_loading_pct: 25 },
  { dimension: 'country', key: '0', notch: 0, cap_grade: null, cover: 'available', rank_floor: 0, rank_add: 0, premium_loading_pct: 0 },
  { dimension: 'country', key: '1', notch: 0, cap_grade: null, cover: 'available', rank_floor: 0, rank_add: 0, premium_loading_pct: 0 },
  { dimension: 'country', key: '2', notch: 0, cap_grade: null, cover: 'available', rank_floor: 0, rank_add: 0, premium_loading_pct: 0 },
  { dimension: 'country', key: '3', notch: 0, cap_grade: null, cover: 'available', rank_floor: 0, rank_add: 0, premium_loading_pct: 0 },
  { dimension: 'country', key: '4', notch: 0, cap_grade: null, cover: 'available', rank_floor: 3, rank_add: 0, premium_loading_pct: 5 },
  { dimension: 'country', key: '5', notch: 0, cap_grade: null, cover: 'available', rank_floor: 3, rank_add: 0, premium_loading_pct: 10 },
  { dimension: 'country', key: '6', notch: 0, cap_grade: 'C1', cover: 'restricted', rank_floor: 4, rank_add: 0, premium_loading_pct: 20 },
  { dimension: 'country', key: '7', notch: 0, cap_grade: 'C1', cover: 'restricted', rank_floor: 5, rank_add: 0, premium_loading_pct: 30 },
  { dimension: 'country', key: 'unclassified', notch: 0, cap_grade: null, cover: 'restricted', rank_floor: 5, rank_add: 0, premium_loading_pct: 30 },
]

/** A country category's badge tone: neutral to 3, amber 4–5, red 6–7;
 * not classified is neutral and said in words. */
export function countryTone(category: number | null): 'neutral' | 'warn' | 'neg' {
  if (category === null) return 'neutral'
  if (category >= 6) return 'neg'
  if (category >= 4) return 'warn'
  return 'neutral'
}

/** The committee is rank 5 (0071). */
export const COMMITTEE_RANK = 5

/** The country key a category gives: null ⇒ not classified. */
export function countryKey(category: number | null | undefined): CountryKey {
  return category === null || category === undefined ? 'unclassified' : (String(category) as CountryKey)
}

/**
 * The authority rank a decision granting cover needs — the mirror of
 * tci.cover_required_rank_internal: the country's floor (inactive while no
 * OECD list has been imported and the country has no approved internal
 * category), plus the sector grade's addition, at most the committee.
 */
export function requiredRank(input: {
  countryCategory: number | null
  oecdImported: boolean
  hasOverride: boolean
  sectorGrade: string | null
  adjustments: readonly RiskAdjustment[]
}): number {
  const countryActive = input.oecdImported || input.hasOverride
  const key = countryActive ? countryKey(input.countryCategory) : null
  const floor = key ? (input.adjustments.find((a) => a.dimension === 'country' && a.key === key)?.rank_floor ?? 0) : 0
  const add = input.sectorGrade
    ? (input.adjustments.find((a) => a.dimension === 'sector' && a.key === input.sectorGrade)?.rank_add ?? 0)
    : 0
  return Math.min(COMMITTEE_RANK, floor + add)
}

/** What tci.buyer_risk_context answers for a decision screen. */
export interface BuyerRiskContext {
  sector_id: string | null
  industry_code: string | null
  sector_grade: SectorGrade | null
  sector_outlook: Outlook | null
  sector_reviewed_at: string | null
  sector_stale: boolean
  country_code: string | null
  country_category: number | null
  country_source: 'oecd' | 'internal' | null
  oecd_category: number | null
  internal_category: number | null
  cover_block: CoverBlock | null
  sanctions: { scope: SanctionScope; regime: SanctionRegime; source: string; reference: string | null; effective_from: string }[]
  required_rank: number | null
  my_rank: number | null
}

export type RiskWarning =
  | { kind: 'sector_grade'; grade: SectorGrade }
  | { kind: 'sector_outlook' }
  | { kind: 'sector_stale' }
  | { kind: 'country_category'; category: number }
  | { kind: 'country_unclassified' }
  | { kind: 'rank'; required: number; mine: number }

/**
 * The non-blocking warnings a decision screen shows (amber): a sector graded
 * C or D, a negative outlook, a stale review, a country in category 5–7 or
 * not classified once a list exists, and a decision that needs a higher
 * authority rank than the decider holds. A sanctions block is not a warning —
 * it is a hard stop (`cover_block`).
 */
export function decisionWarnings(ctx: BuyerRiskContext, oecdImported: boolean): RiskWarning[] {
  const out: RiskWarning[] = []
  if (ctx.sector_grade === 'C' || ctx.sector_grade === 'D') out.push({ kind: 'sector_grade', grade: ctx.sector_grade })
  if (ctx.sector_outlook === 'negative') out.push({ kind: 'sector_outlook' })
  if (ctx.sector_stale) out.push({ kind: 'sector_stale' })
  if (ctx.country_category !== null && ctx.country_category >= 5)
    out.push({ kind: 'country_category', category: ctx.country_category })
  else if (ctx.country_category === null && oecdImported) out.push({ kind: 'country_unclassified' })
  const required = ctx.required_rank ?? 0
  const mine = ctx.my_rank ?? 0
  if (required > 0 && mine < required) out.push({ kind: 'rank', required, mine })
  return out
}

/** What tci.cover_concentration answers for a policy or a submission. */
export interface Concentration {
  buyers: number
  total_uzs: number
  rates_missing: number
  by_sector: { grade: string; buyers: number; amount_uzs: number }[]
  by_country: { category: string; buyers: number; amount_uzs: number }[]
  share_cd: number | null
  share_cat57: number | null
  warn_pct: number
  single_cd_sector: boolean
  blocked: { entity_id: string; block: CoverBlock }[]
  loading_hint_pct: number | null
  warn: boolean
}

/** The mirror of the warning cover_concentration computes: a C/D share or a
 * category 5–7 share above the threshold, or every buyer in one C/D sector. */
export function concentrationWarns(c: Pick<Concentration, 'share_cd' | 'share_cat57' | 'warn_pct' | 'single_cd_sector'>): boolean {
  return (c.share_cd ?? 0) > c.warn_pct || (c.share_cat57 ?? 0) > c.warn_pct || c.single_cd_sector
}

/** A sector review is stale once its quarter has passed (v_sector_grades). */
export function quarterStart(day: Date): string {
  const month = Math.floor(day.getUTCMonth() / 3) * 3
  return `${day.getUTCFullYear()}-${String(month + 1).padStart(2, '0')}-01`
}

export function isStale(reviewQuarterStart: string | null, today: Date = new Date()): boolean {
  return reviewQuarterStart !== null && reviewQuarterStart < quarterStart(today)
}

/** A review's factors are complete: every factor scored (sector_factors_valid). */
export function factorsComplete(factors: Partial<Record<SectorFactor, { score?: string | null }>>): boolean {
  return SECTOR_FACTORS.every((k) => FACTOR_SCORES.includes(factors[k]?.score as FactorScore))
}

/** An OECD list is stale when its effective date is older than the setting
 * (v_country_risk.import_stale, default six months). */
export function importStale(effectiveDate: string | null, staleMonths: number, today: Date = new Date()): boolean {
  if (!effectiveDate) return true
  const limit = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - staleMonths, today.getUTCDate()))
  return effectiveDate < limit.toISOString().slice(0, 10)
}

/** The engine's view of a grade's risk table (credit_engine 0.2.0). */
export interface EngineRiskContext {
  sector_grade: SectorGrade | null
  country_category: number | null
  country_classified: boolean
  country_source: 'oecd' | 'internal' | null
  adjustments: {
    sector: Partial<Record<SectorGrade, { notch: number; cap_grade: string | null }>>
    country: Partial<Record<string, { notch: number; cap_grade: string | null }>>
  }
}

/**
 * What a rating sends the engine: the buyer's sector grade and country
 * category with the admin's notches and caps. The country part follows the
 * cover matrix's rule — silent until an OECD list is imported or the country
 * has an approved internal category — so the country table is sent empty
 * then, and the engine applies no country line's notch or cap.
 */
export function engineRiskContext(
  ctx: Pick<BuyerRiskContext, 'sector_grade' | 'country_category' | 'country_source' | 'internal_category'>,
  adjustments: readonly RiskAdjustment[],
  oecdImported: boolean,
): EngineRiskContext {
  const countryActive = oecdImported || ctx.internal_category !== null
  const rule = (a: RiskAdjustment) => ({ notch: a.notch, cap_grade: a.cap_grade })
  return {
    sector_grade: ctx.sector_grade,
    country_category: countryActive ? ctx.country_category : null,
    country_classified: countryActive && ctx.country_category !== null,
    country_source: countryActive ? ctx.country_source : null,
    adjustments: {
      sector: Object.fromEntries(adjustments.filter((a) => a.dimension === 'sector').map((a) => [a.key, rule(a)])),
      country: countryActive
        ? Object.fromEntries(adjustments.filter((a) => a.dimension === 'country').map((a) => [a.key, rule(a)]))
        : {},
    },
  }
}
