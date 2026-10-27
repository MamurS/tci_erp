/** Client for the analytics service (services/analytics, FastAPI). */

const BASE_URL: string = import.meta.env.VITE_ANALYTICS_API_URL ?? 'http://localhost:8000'

/** Thrown when the service is unreachable or returns a non-OK status. */
export class AnalyticsUnavailableError extends Error {
  readonly detail: unknown

  constructor(detail?: unknown) {
    super('analytics service unavailable')
    this.name = 'AnalyticsUnavailableError'
    this.detail = detail
  }
}

export interface AnalyticsPeriod {
  fiscal_year: number
  statement_kind: 'annual' | 'quarterly'
  balance_sheet: Record<string, number | null>
  income_statement: Record<string, number | null>
}

export interface StatementPayload {
  buyer: { name: string | null; country_code: string | null; age_years: number | null }
  currency: string
  unit: 'units' | 'thousands' | 'millions'
  exchange_rate_usd?: number
  /** Recorded in inputs_snapshot; trends never mix report types. */
  report_type?: 'statutory' | 'management'
  periods: AnalyticsPeriod[]
  /** Sector grade + country risk category (engine 0.2.0). Omitted ⇒ the grade
   * and the limit rest on the financials alone, exactly as before. */
  risk_context?: RiskContext
}

// ---------------------------------------------------------------------------
// Risk context: sector grade and country risk category (credit_engine 0.2.0,
// credit_engine/src/credit_engine/risk_context.py)
// ---------------------------------------------------------------------------

export type SectorGrade = 'A' | 'B' | 'C' | 'D'

/** One row of tci.risk_adjustment_settings. A positive notch is a BETTER
 * grade; cap_grade is the best grade a buyer under the row may hold. */
export interface RiskAdjustmentRule {
  notch: number
  cap_grade: string | null
}

export interface RiskAdjustmentTable {
  /** Keyed by sector grade; a missing key = notch 0, no cap. */
  sector: Partial<Record<SectorGrade, RiskAdjustmentRule>>
  /** Keyed by '0'…'7' or 'unclassified'; a missing key = notch 0, no cap. */
  country: Partial<Record<string, RiskAdjustmentRule>>
}

export interface RiskContext {
  /** The sector grade in force; null = not graded (no sector line). */
  sector_grade: SectorGrade | null
  /** 0…7; must be null exactly when country_classified is false. */
  country_category: number | null
  /** false = not classified — NOT category 0; the 'unclassified' row applies. */
  country_classified: boolean
  country_source: 'oecd' | 'internal' | null
  adjustments: RiskAdjustmentTable
}

export interface SectorAdjustmentLine {
  code: 'sector_adjustment'
  sector_grade: SectorGrade
  notch: number
  cap_grade: string | null
  from_grade: string
  to_grade: string
}

export interface CountryAdjustmentLine {
  code: 'country_adjustment'
  country_category: number | null
  /** '0'…'7' or 'unclassified' */
  country_key: string
  country_classified: boolean
  country_source: 'oecd' | 'internal' | null
  notch: number
  /** The row's configured cap, whether or not it bit. */
  cap_grade: string | null
  from_grade: string
  to_grade: string
}

/** Present only when a cap BIT (the notched grade was better than it). */
export interface GradeCapLine {
  code: 'grade_cap'
  cap_grade: string
  cap_sources: Array<'sector' | 'country'>
  from_grade: string
  to_grade: string
}

export type RiskAdjustmentLine = SectorAdjustmentLine | CountryAdjustmentLine | GradeCapLine

export interface RatingComponent {
  factor: string
  value: number | null
  score: number | null
  weight: number
  status: string
  band: string | null
}

export interface RatingAdjustment {
  code: string
  detail: string
  rating_before: number
  rating_after: number
}

export interface RatingResponse {
  /** The financials' score — never moved by the risk context. */
  score: number | null
  /** The grade in force: after the risk context when one was sent. */
  grade: string | null
  grade_label_key: string | null
  data_coverage: number
  components: RatingComponent[]
  adjustments: RatingAdjustment[]
  warnings: string[]
  engine_version: string
  // The four below are present only when the request carried a risk_context.
  /** The grade the score maps to, before the risk context (absent when unrated). */
  base_grade?: string
  /** The score placed in `grade`'s band; the limit is computed on it. */
  effective_score?: number
  /** The risk context used, echoed. */
  risk_context?: RiskContext
  /** Sector line (if graded), country line (always), cap line (if it bit). */
  risk_adjustments?: RiskAdjustmentLine[]
}

export interface LimitModelTrace {
  model: string
  limit: number
  components: Record<string, number>
  reasons: string[]
}

export interface CreditLimitResponse {
  suggested_limit: number
  currency: string
  model_used: string
  trace: LimitModelTrace[]
  reasons: string[]
  engine_version: string
  // Present only when the request carried a risk_context (send /rating's
  // `score` as rating_score, not its effective_score).
  base_grade?: string
  grade?: string
  effective_score?: number
  risk_context?: RiskContext
  risk_adjustments?: RiskAdjustmentLine[]
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (cause) {
    throw new AnalyticsUnavailableError(cause)
  }
  if (!response.ok) throw new AnalyticsUnavailableError(`HTTP ${response.status}`)
  return (await response.json()) as T
}

export function postRating(payload: StatementPayload): Promise<RatingResponse> {
  return post<RatingResponse>('/rating', payload)
}

export function postCreditLimit(
  payload: StatementPayload & { rating_score: number },
): Promise<CreditLimitResponse> {
  return post<CreditLimitResponse>('/credit-limit', payload)
}

async function get<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`)
  } catch (cause) {
    throw new AnalyticsUnavailableError(cause)
  }
  if (!response.ok) throw new AnalyticsUnavailableError(`HTTP ${response.status}`)
  return (await response.json()) as T
}

// ---------------------------------------------------------------------------
// Official company registries (services/analytics app/registry.py)
// ---------------------------------------------------------------------------

export type RegistrySource = 'gleif' | 'companies_house'

export interface RegistrySourceInfo {
  source: RegistrySource
  /** null = worldwide */
  countries: string[] | null
  available: boolean
}

/** One company as an official register describes it — a suggestion that the
 * information manager confirms in the company form. */
export interface RegistryRecord {
  source: RegistrySource
  source_id: string
  name: string
  country_code: string | null
  registration_number: string | null
  address: string | null
  legal_form: string | null
  status: string | null
  founded_date: string | null
  url: string | null
}

export function getRegistrySources(): Promise<RegistrySourceInfo[]> {
  return get<RegistrySourceInfo[]>('/registry/sources')
}

export async function searchRegistry(
  source: RegistrySource,
  query: string,
  country?: string | null,
): Promise<RegistryRecord[]> {
  const params = new URLSearchParams({ source, q: query })
  if (country) params.set('country', country)
  const body = await get<{ records: RegistryRecord[] }>(`/registry/search?${params}`)
  return body.records
}
