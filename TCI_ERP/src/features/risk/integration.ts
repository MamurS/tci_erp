/**
 * Sector, country and sanctions on the EXISTING screens (Prompt 31): the pure
 * part — which refusal a write met, which words a client may read, which
 * warnings a decision screen shows, and how a concentration is laid out.
 * The database decides every one of them (0085); these only mirror it so a
 * screen can grey out, warn and explain. integration.test.ts locks each one
 * to the text of 0085.
 */

import { refusalOr } from '../../lib/optimistic'
import { COUNTRY_KEYS, SECTOR_GRADES } from './rules'
import type { BuyerRiskContext, Concentration, CoverBlock, RiskAdjustment, RiskWarning } from './rules'
import { decisionWarnings } from './rules'

// ---------------------------------------------------------------------------
// Refusals: «cover not available»
// ---------------------------------------------------------------------------

/** The two literal texts tci.raise_cover_block raises (0085). */
export const COVER_FRAGMENTS: Record<CoverBlock, string> = {
  company: 'cover_not_available: company',
  country: 'cover_not_available: country',
}

/** Which party a refused write met a sanctions flag on, or null for any
 * other failure. Read from the message, which is literal on purpose. */
export function coverBlockOf(error: unknown): CoverBlock | null {
  const message = (error as { message?: unknown } | null)?.message
  if (typeof message !== 'string') return null
  const text = message.toLowerCase()
  if (text.includes(COVER_FRAGMENTS.company)) return 'company'
  if (text.includes(COVER_FRAGMENTS.country)) return 'country'
  return null
}

/** Staff wording: names the sanctions and that no authority overrides them
 * (the same keys refusals.ts maps). */
export const STAFF_COVER_KEYS: Record<CoverBlock, string> = {
  company: 'risk.errors.coverCompany',
  country: 'risk.errors.coverCountry',
}

/** Client wording: «cover is not available for this buyer / country» — never
 * the word sanctions, never a regime (the client must not learn either). */
export const CLIENT_COVER_KEYS: Record<CoverBlock, string> = {
  company: 'portal.errors.coverCompany',
  country: 'portal.errors.coverCountry',
}

/** The staff message for a cover refusal, or null when it was something else. */
export function staffCoverRefusal(error: unknown): string | null {
  const block = coverBlockOf(error)
  return block ? STAFF_COVER_KEYS[block] : null
}

/** The portal's mapping: a cover refusal becomes the client's own words
 * BEFORE the shared mapping (whose risk.errors.* name the sanctions) can see
 * it; anything else is mapped as everywhere else. */
export function clientRefusalOr(error: unknown, fallback: string): string {
  const block = coverBlockOf(error)
  return block ? CLIENT_COVER_KEYS[block] : refusalOr(error, fallback)
}

/** The client's cover key, or null — for portal handlers that map by SQLSTATE. */
export function clientCoverRefusal(error: unknown): string | null {
  const block = coverBlockOf(error)
  return block ? CLIENT_COVER_KEYS[block] : null
}

// ---------------------------------------------------------------------------
// Decision screens
// ---------------------------------------------------------------------------

/** The outcomes the cover guard refuses for a flagged party (0085
 * guard_cover_decision): only what grants cover. A decline stays possible. */
export const COVER_GRANTING_OUTCOMES = ['approved', 'partial'] as const

export function outcomeBlocked(outcome: string, ctx: Pick<BuyerRiskContext, 'cover_block'> | null | undefined): boolean {
  return Boolean(ctx?.cover_block) && (COVER_GRANTING_OUTCOMES as readonly string[]).includes(outcome)
}

/** Whether the country part of the risk picture is in force: an OECD list
 * has been imported, or the country has an approved internal category —
 * the rule of tci.cover_required_rank_internal. */
export function countryRiskActive(
  ctx: Pick<BuyerRiskContext, 'internal_category'> | null | undefined,
  oecdImported: boolean,
): boolean {
  return oecdImported || (ctx?.internal_category ?? null) !== null
}

/**
 * The warnings a decision screen shows. The rank warning is the credit
 * decider's own (my_rank is their CREDIT rank, and only decide_limit_request
 * asks the cover matrix), so other viewers do not get it.
 */
export function visibleWarnings(
  ctx: BuyerRiskContext,
  oecdImported: boolean,
  options: { showRank: boolean },
): RiskWarning[] {
  return decisionWarnings(ctx, oecdImported).filter((w) => w.kind !== 'rank' || options.showRank)
}

/** A warning's words: an i18n key and its params. The rank warning's level
 * names are rendered by the screen (levelName), from `required` / `mine`. */
export function warningKey(w: RiskWarning): { key: string; params: Record<string, string | number> } {
  switch (w.kind) {
    case 'sector_grade':
      return { key: 'risk.decision.warnings.sectorGrade', params: { grade: w.grade } }
    case 'sector_outlook':
      return { key: 'risk.decision.warnings.sectorOutlook', params: {} }
    case 'sector_stale':
      return { key: 'risk.decision.warnings.sectorStale', params: {} }
    case 'country_category':
      return { key: 'risk.decision.warnings.countryCategory', params: { category: w.category } }
    case 'country_unclassified':
      return { key: 'risk.decision.warnings.countryUnclassified', params: {} }
    case 'rank':
      return { key: 'risk.decision.warnings.rank', params: { required: w.required, mine: w.mine } }
  }
}

/** Does the cover matrix alone send this decision to validation? (The amount
 * against authority is judged by authority.ts; this is the other half of
 * decide_limit_request's test.) */
export function rankShort(ctx: Pick<BuyerRiskContext, 'required_rank' | 'my_rank'> | null | undefined): boolean {
  if (!ctx) return false
  return (ctx.my_rank ?? 0) < (ctx.required_rank ?? 0)
}

// ---------------------------------------------------------------------------
// Concentration
// ---------------------------------------------------------------------------

/** Who reads the concentration panel: the desks that write cover — sales,
 * commercial and credit underwriting — and admin's oversight. */
export const CONCENTRATION_ROLES = ['sales', 'commercial_underwriter', 'credit_underwriter', 'admin'] as const

export interface ConcentrationRow {
  key: string
  buyers: number
  amountUzs: number
  /** amount ÷ total, a fraction; null when the total is zero. */
  share: number | null
}

/** The sector keys in the order shown: A … D, then «no sector grade». */
export const SECTOR_ROW_KEYS = [...SECTOR_GRADES, 'none'] as const
/** The country keys in the order shown: 0 … 7, then not classified. */
export const COUNTRY_ROW_KEYS = COUNTRY_KEYS

function rows(
  input: readonly { key: string; buyers: number; amount_uzs: number }[],
  order: readonly string[],
  total: number,
): ConcentrationRow[] {
  const byKey = new Map(input.map((r) => [r.key, r]))
  return order
    .filter((k) => byKey.has(k))
    .map((k) => {
      const r = byKey.get(k)!
      const amount = Number(r.amount_uzs ?? 0)
      return { key: k, buyers: Number(r.buyers), amountUzs: amount, share: total > 0 ? amount / total : null }
    })
}

export interface ConcentrationView {
  buyers: number
  totalUzs: number
  ratesMissing: number
  bySector: ConcentrationRow[]
  /** Null while the country part is not in force (no OECD list and no
   * internal category among the buyers): every buyer would read «not
   * classified», which says nothing yet. */
  byCountry: ConcentrationRow[] | null
  /** Fractions; null when the total is zero. */
  shareCd: number | null
  shareCat57: number | null
  /** The threshold, a fraction. */
  warnAt: number
  warn: boolean
  singleCdSector: boolean
  /** A percentage (5 = 5 %); null when the total is zero. */
  loadingHintPct: number | null
}

/**
 * The concentration as the panel draws it. While no OECD list is imported
 * cover_concentration still files every buyer under «unclassified» and adds
 * that row's premium loading to the hint; the cover matrix itself ignores
 * the country part until a list exists, so the panel does too — the country
 * breakdown is left out and the hint is the sector part alone (the same
 * exposure-weighted formula as 0085, without the country term).
 */
export function concentrationView(
  c: Concentration,
  options: { oecdImported: boolean; adjustments: readonly RiskAdjustment[] | null },
): ConcentrationView {
  const total = Number(c.total_uzs ?? 0)
  const byCountryRaw = c.by_country.map((r) => ({ key: r.category, buyers: r.buyers, amount_uzs: r.amount_uzs }))
  const countryActive =
    options.oecdImported || byCountryRaw.some((r) => r.key !== 'unclassified')
  const bySector = rows(
    c.by_sector.map((r) => ({ key: r.grade, buyers: r.buyers, amount_uzs: r.amount_uzs })),
    SECTOR_ROW_KEYS,
    total,
  )
  let loading = c.loading_hint_pct === null || c.loading_hint_pct === undefined ? null : Number(c.loading_hint_pct)
  if (!countryActive && total > 0 && options.adjustments) {
    const sectorLoading = (grade: string) =>
      options.adjustments!.find((a) => a.dimension === 'sector' && a.key === grade)?.premium_loading_pct ?? 0
    const weighted = bySector.reduce((sum, r) => sum + r.amountUzs * Number(sectorLoading(r.key)), 0)
    loading = Math.round((weighted / total) * 10) / 10
  }
  return {
    buyers: Number(c.buyers),
    totalUzs: total,
    ratesMissing: Number(c.rates_missing ?? 0),
    bySector,
    byCountry: countryActive ? rows(byCountryRaw, COUNTRY_ROW_KEYS, total) : null,
    shareCd: c.share_cd === null || c.share_cd === undefined ? null : Number(c.share_cd) / 100,
    shareCat57: c.share_cat57 === null || c.share_cat57 === undefined ? null : Number(c.share_cat57) / 100,
    warnAt: Number(c.warn_pct) / 100,
    warn: Boolean(c.warn),
    singleCdSector: Boolean(c.single_cd_sector),
    loadingHintPct: loading,
  }
}

/** Which of the concentration's warnings apply, for the words (the flag
 * itself is the database's `warn`). */
export function concentrationReasons(v: Pick<ConcentrationView, 'shareCd' | 'shareCat57' | 'warnAt' | 'singleCdSector'>): (
  'share_cd' | 'share_cat57' | 'single_cd_sector'
)[] {
  const out: ('share_cd' | 'share_cat57' | 'single_cd_sector')[] = []
  if ((v.shareCd ?? 0) > v.warnAt) out.push('share_cd')
  if ((v.shareCat57 ?? 0) > v.warnAt) out.push('share_cat57')
  if (v.singleCdSector) out.push('single_cd_sector')
  return out
}
