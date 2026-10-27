/**
 * «Сектора» (Prompt 31, migration 0085) — the pure rules of the credit
 * analysis section: its views, the sector list's filters, who may write,
 * approve, propose or end what, and the two series the sector page draws.
 * The database decides every permission (submit / decide_sector_review,
 * assign_sector_analyst, propose / decide / end_country_override); these
 * mirror it so a button is offered only where the database will accept it.
 * model.test.ts locks each mirror to the text of 0085.
 */

import { gradeKey } from '../../components/ui/gradeTone'
import type { UserRole } from '../../lib/roles'
import { FACTOR_SCORES, SECTOR_FACTORS, factorsComplete, quarterStart } from '../risk/rules'
import type { FactorScore, Outlook, ReviewKind, SectorFactor, SectorFactors, SectorGrade } from '../risk/rules'

// ---------------------------------------------------------------------------
// Views and filters (both in the URL)
// ---------------------------------------------------------------------------

export const SECTOR_VIEWS = ['sectors', 'countries'] as const
export type SectorView = (typeof SECTOR_VIEWS)[number]

/** An unknown view falls back to the sector list. */
export function parseSectorView(value: string | null | undefined): SectorView {
  return (SECTOR_VIEWS as readonly string[]).includes(value ?? '') ? (value as SectorView) : 'sectors'
}

/** The sector list's filters (?filter=): every one is a column of
 * tci.v_sector_grades, never a second computation. */
export const SECTOR_FILTERS = ['all', 'ungraded', 'stale', 'overdue', 'pending', 'cd'] as const
export type SectorFilter = (typeof SECTOR_FILTERS)[number]

export function parseSectorFilter(value: string | null | undefined): SectorFilter {
  return (SECTOR_FILTERS as readonly string[]).includes(value ?? '') ? (value as SectorFilter) : 'all'
}

/** What a filter reads off a row of v_sector_grades. */
export interface SectorFlags {
  grade: SectorGrade | null
  stale: boolean
  overdue: boolean
  pending: boolean
}

export function sectorMatches(row: SectorFlags, filter: SectorFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'ungraded':
      return row.grade === null
    case 'stale':
      return row.stale
    case 'overdue':
      return row.overdue
    case 'pending':
      return row.pending
    case 'cd':
      return isWeakGrade(row.grade)
  }
}

export function filterSectors<T extends SectorFlags>(rows: readonly T[], filter: SectorFilter): T[] {
  return rows.filter((row) => sectorMatches(row, filter))
}

export function filterCounts(rows: readonly SectorFlags[]): Record<SectorFilter, number> {
  const out = Object.fromEntries(SECTOR_FILTERS.map((f) => [f, 0])) as Record<SectorFilter, number>
  for (const row of rows) for (const f of SECTOR_FILTERS) if (sectorMatches(row, f)) out[f] += 1
  return out
}

/** A C or D sector: a downgrade to it tells credit underwriting which buyers
 * with limits it touches (sector_review_in_force). */
export function isWeakGrade(grade: string | null | undefined): boolean {
  return grade === 'C' || grade === 'D'
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export type UiLang = 'en' | 'ru' | 'uz'

export function uiLang(language: string | null | undefined): UiLang {
  const l = (language ?? 'en').slice(0, 2)
  return l === 'ru' || l === 'uz' ? l : 'en'
}

/** An industry's (sector's) name in the UI language, English when missing. */
export function industryName(
  row: { name_en: string; name_ru: string | null; name_uz: string | null; industry_code?: string } | null | undefined,
  lang: UiLang,
): string {
  if (!row) return '—'
  const name = lang === 'ru' ? row.name_ru : lang === 'uz' ? row.name_uz : row.name_en
  return name?.trim() || row.name_en || row.industry_code || '—'
}

// ---------------------------------------------------------------------------
// Who may do what (the mirror of the gates in 0085)
// ---------------------------------------------------------------------------

/** assign_sector_analyst: admin only. */
export function mayAssignAnalyst(actingRole: UserRole | null): boolean {
  return actingRole === 'admin'
}

/** submit_sector_review: a credit analyst, acting in that role. */
export function mayWriteReview(actingRole: UserRole | null): boolean {
  return actingRole === 'credit_analyst'
}

/**
 * A pending review (four eyes, decide_sector_review): another credit analyst
 * approves or rejects it; its author waits for a colleague; everyone else
 * only sees that it waits.
 */
export function reviewDecisionState(input: {
  actingRole: UserRole | null
  userId: string | null | undefined
  review: { status: string; created_by: string } | null | undefined
}): 'decide' | 'own' | 'readonly' | 'none' {
  const { actingRole, userId, review } = input
  if (!review || review.status !== 'pending') return 'none'
  if (actingRole !== 'credit_analyst') return 'readonly'
  return review.created_by === userId ? 'own' : 'decide'
}

/** propose_country_override: a credit analyst. */
export function mayProposeOverride(actingRole: UserRole | null): boolean {
  return actingRole === 'credit_analyst'
}

/**
 * A pending internal country category (decide_country_override): the head of
 * credit analysis — a credit analyst admin marked senior — decides it, never
 * the person who proposed it.
 */
export function overrideDecisionState(input: {
  actingRole: UserRole | null
  senior: boolean
  userId: string | null | undefined
  override: { status: string; proposed_by: string } | null | undefined
}): 'decide' | 'own' | 'notHead' | 'readonly' | 'none' {
  const { actingRole, senior, userId, override } = input
  if (!override || override.status !== 'pending') return 'none'
  if (actingRole !== 'credit_analyst') return 'readonly'
  if (!senior) return 'notHead'
  return override.proposed_by === userId ? 'own' : 'decide'
}

/** end_country_override: the head of credit analysis, on a live one. */
export function mayEndOverride(input: {
  actingRole: UserRole | null
  senior: boolean
  override: { status: string } | null | undefined
}): boolean {
  return input.actingRole === 'credit_analyst' && input.senior && input.override?.status === 'approved'
}

/** The colleagues a sector can be given to: staff holding credit_analyst
 * (the database refuses anyone else — sector_analyst_not_analyst). */
export function analystCandidates<T extends { roles: readonly string[]; full_name: string | null; email: string }>(
  directory: Iterable<T> | undefined,
): T[] {
  return [...(directory ?? [])]
    .filter((m) => m.roles.includes('credit_analyst'))
    .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email))
}

// ---------------------------------------------------------------------------
// The review form
// ---------------------------------------------------------------------------

export type FactorDraft = Record<SectorFactor, { score: FactorScore | null; note: string }>

export function emptyFactors(from?: Partial<SectorFactors> | null): FactorDraft {
  return Object.fromEntries(
    SECTOR_FACTORS.map((k) => {
      const prev = from?.[k]
      const score = prev && (FACTOR_SCORES as readonly string[]).includes(prev.score) ? prev.score : null
      return [k, { score, note: prev?.note ?? '' }]
    }),
  ) as FactorDraft
}

/** The factors as submit_sector_review takes them, or null while one is
 * unscored (factorsComplete, the mirror of sector_factors_valid). */
export function completeFactors(draft: FactorDraft): SectorFactors | null {
  if (!factorsComplete(draft)) return null
  return Object.fromEntries(
    SECTOR_FACTORS.map((k) => [k, { score: draft[k].score as FactorScore, note: draft[k].note.trim() }]),
  ) as SectorFactors
}

/** The kind a new review starts as: quarterly, unless this quarter's review
 * is already in force — then a second one is ad hoc. */
export function defaultReviewKind(currentQuarterStart: string | null, today: Date = new Date()): ReviewKind {
  return currentQuarterStart !== null && currentQuarterStart >= quarterStart(today) ? 'ad_hoc' : 'quarterly'
}

/** The last day of the quarter that starts on `start` (YYYY-MM-01), so the
 * quarter is named by formatPeriod («Q3 2026», «III кв. 2026»). */
export function quarterEnd(start: string): string {
  const [y, m] = start.split('-').map(Number)
  const end = new Date(Date.UTC(y, m + 2, 0))
  return end.toISOString().slice(0, 10)
}

/** Sources are typed one per line; blank lines are dropped. */
export function parseSources(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** A source that is a web address becomes a link (http/https only — never
 * javascript: or any other scheme); anything else stays text. */
export function sourceHref(source: string): string | null {
  const s = source.trim()
  if (/\s/.test(s)) return null
  const candidate = /^https?:\/\//i.test(s) ? s : /^www\.[^\s/]+\.[^\s]+/i.test(s) ? `https://${s}` : null
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export function factorTone(score: FactorScore | string | null | undefined): 'pos' | 'neutral' | 'neg' {
  return score === 'favourable' ? 'pos' : score === 'adverse' ? 'neg' : 'neutral'
}

// ---------------------------------------------------------------------------
// The grade over time
// ---------------------------------------------------------------------------

/** A on top: the chart's y value of each grade. */
export const GRADE_POSITION: Record<SectorGrade, number> = { A: 1, B: 2, C: 3, D: 4 }
export const POSITION_GRADE: Record<number, SectorGrade> = { 1: 'A', 2: 'B', 3: 'C', 4: 'D' }

export interface GradePoint {
  at: number
  grade: SectorGrade
  outlook: Outlook
  value: number
  kind: ReviewKind
  /** The «today» end of the line (no review there, no dot). */
  carried?: boolean
}

/**
 * The grade IN FORCE over time: every approved review at the moment it came
 * into force (decided_at), oldest first; the last grade is carried to today
 * so the line ends where the reader stands. Pending and rejected reviews were
 * never in force and are not on it.
 */
export function gradeHistory(
  reviews: readonly {
    status: string
    grade: SectorGrade
    outlook: Outlook
    kind: ReviewKind
    decided_at: string | null
    created_at: string
  }[],
  today: Date = new Date(),
): GradePoint[] {
  const points: GradePoint[] = reviews
    .filter((r) => r.status === 'approved' && r.decided_at)
    .map((r) => ({
      at: new Date(r.decided_at as string).getTime(),
      grade: r.grade,
      outlook: r.outlook,
      value: GRADE_POSITION[r.grade],
      kind: r.kind,
    }))
    .sort((a, b) => a.at - b.at)
  const last = points[points.length - 1]
  if (last && today.getTime() > last.at) points.push({ ...last, at: today.getTime(), carried: true })
  return points
}

// ---------------------------------------------------------------------------
// The book in the sector
// ---------------------------------------------------------------------------

export interface BookLimit {
  amount_uzs: number | null
  valid_from: string | null
  decided_at: string | null
}

export interface ExposurePoint {
  /** YYYY-MM */
  month: string
  added: number
  cumulative: number
}

/** The month (Asia/Tashkent, UTC+5 all year) a limit took effect. */
export function effectiveMonth(limit: BookLimit): string | null {
  if (limit.valid_from) return limit.valid_from.slice(0, 7)
  if (!limit.decided_at) return null
  const t = new Date(limit.decided_at).getTime() + 5 * 3600_000
  return new Date(t).toISOString().slice(0, 7)
}

function nextMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

/**
 * TODAY's active limits, added up by the month each took effect — not the
 * exposure the sector had in past months (a limit since revoked or expired is
 * not in today's book, and nothing stores past books). Months without a new
 * limit are kept (flat), up to this month. A limit whose currency has no rate
 * is counted apart, never as zero.
 */
export function exposureByMonth(
  limits: readonly BookLimit[],
  today: Date = new Date(),
): { points: ExposurePoint[]; missingRates: number; undated: number; total: number } {
  const byMonth = new Map<string, number>()
  let missingRates = 0
  let undated = 0
  let total = 0
  for (const l of limits) {
    if (l.amount_uzs === null || l.amount_uzs === undefined || !Number.isFinite(Number(l.amount_uzs))) {
      missingRates += 1
      continue
    }
    const month = effectiveMonth(l)
    if (!month) {
      undated += 1
      continue
    }
    const amount = Number(l.amount_uzs)
    byMonth.set(month, (byMonth.get(month) ?? 0) + amount)
    total += amount
  }
  const months = [...byMonth.keys()].sort()
  if (!months.length) return { points: [], missingRates, undated, total }
  const end = new Date(today.getTime() + 5 * 3600_000).toISOString().slice(0, 7)
  const last = months[months.length - 1] > end ? months[months.length - 1] : end
  const points: ExposurePoint[] = []
  let cumulative = 0
  for (let m = months[0]; ; m = nextMonth(m)) {
    const added = byMonth.get(m) ?? 0
    cumulative += added
    points.push({ month: m, added, cumulative })
    if (m >= last) break
  }
  return { points, missingRates, undated, total }
}

/** The sector's buyers by their rating grade, best first, the unrated last. */
export const DISTRIBUTION_KEYS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D', 'unrated'] as const
export type DistributionKey = (typeof DISTRIBUTION_KEYS)[number]

export function gradeDistribution(
  buyers: readonly { rating_grade: string | null }[],
): { key: DistributionKey; count: number }[] {
  const counts = new Map<DistributionKey, number>(DISTRIBUTION_KEYS.map((k) => [k, 0]))
  for (const b of buyers) {
    const key = (b.rating_grade ? gradeKey(b.rating_grade) : null) as DistributionKey | null
    const k: DistributionKey = key && counts.has(key) ? key : 'unrated'
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return DISTRIBUTION_KEYS.map((key) => ({ key, count: counts.get(key) ?? 0 }))
}

/** The buyers with in-force limits, largest exposure first (unknown — a
 * currency without a rate — after the known ones, then by name). */
export function buyersWithLimits<T extends { limits: number; exposure_uzs: number | null; name: string }>(
  buyers: readonly T[],
): T[] {
  return buyers
    .filter((b) => b.limits > 0)
    .sort((a, b) => {
      if (a.exposure_uzs === null && b.exposure_uzs !== null) return 1
      if (b.exposure_uzs === null && a.exposure_uzs !== null) return -1
      const diff = (b.exposure_uzs ?? 0) - (a.exposure_uzs ?? 0)
      return diff !== 0 ? diff : a.name.localeCompare(b.name)
    })
}

// ---------------------------------------------------------------------------
// The country risk table
// ---------------------------------------------------------------------------

/** The country table's filters (?country=): the category in use 5–7 (where a
 * decision screen warns), an internal category in use, a live sanctions
 * flag, not classified. */
export const COUNTRY_FILTERS = ['all', 'high', 'internal', 'sanctioned', 'unclassified'] as const
export type CountryFilter = (typeof COUNTRY_FILTERS)[number]

export function parseCountryFilter(value: string | null | undefined): CountryFilter {
  return (COUNTRY_FILTERS as readonly string[]).includes(value ?? '') ? (value as CountryFilter) : 'all'
}

export interface CountryFlags {
  category: number | null
  source: 'oecd' | 'internal' | null
  sanctioned: boolean
}

export function countryMatches(row: CountryFlags, filter: CountryFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'high':
      return row.category !== null && row.category >= 5
    case 'internal':
      return row.source === 'internal'
    case 'sanctioned':
      return row.sanctioned
    case 'unclassified':
      return row.category === null
  }
}

export function countryFilterCounts(rows: readonly CountryFlags[]): Record<CountryFilter, number> {
  const out = Object.fromEntries(COUNTRY_FILTERS.map((f) => [f, 0])) as Record<CountryFilter, number>
  for (const row of rows) for (const f of COUNTRY_FILTERS) if (countryMatches(row, f)) out[f] += 1
  return out
}

/** The OECD list's state for the banner above the table: none imported (every
 * country not classified, the cover matrix not yet active), stale (older
 * than the setting — v_country_risk.import_stale), or current. */
export function oecdListState(
  rows: readonly { latest_import_effective: string | null; latest_import_at: string | null; import_stale: boolean }[],
): { state: 'none' | 'stale' | 'current'; effective: string | null; importedAt: string | null } {
  const first = rows[0]
  if (!first || !first.latest_import_effective) return { state: 'none', effective: null, importedAt: null }
  return {
    state: first.import_stale ? 'stale' : 'current',
    effective: first.latest_import_effective,
    importedAt: first.latest_import_at,
  }
}
