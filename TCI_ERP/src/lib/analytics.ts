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
}

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
  score: number | null
  grade: string | null
  grade_label_key: string | null
  data_coverage: number
  components: RatingComponent[]
  adjustments: RatingAdjustment[]
  warnings: string[]
  engine_version: string
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
