/**
 * Portfolio figures for the commercial and credit workspaces. The DEFINITIONS
 * (premium base, incurred, loss ratio, in force, amount in UZS) live in the
 * SQL views of migration 0052; this module only adds rows up and groups
 * them. Two rules carried over from the views:
 *
 *   - money is summed per currency and never across currencies (the credit
 *     portfolio sums UZS amounts the database already converted);
 *   - a missing UZS amount (no rate for the currency) is COUNTED, never
 *     treated as zero.
 */

export interface PolicyPortfolioRow {
  policy_id: string
  policy_number: string
  status: string
  product_structure: string
  policyholder_entity_id: string
  policyholder_name: string
  policyholder_country: string | null
  currency_code: string
  inception_date: string
  expiry_date: string
  days_to_expiry: number
  max_liability_amount: number | string | null
  minimum_premium: number | string | null
  earned_premium: number | string | null
  premium_paid: number | string | null
  premium_overdue: number | string | null
  premium_base: number | string
  claims_count: number
  open_claims: number
  claimed_total: number | string
  indemnity_paid: number | string
  indemnity_outstanding: number | string
  recoveries_insurer: number | string
  incurred: number | string
  loss_ratio_pct: number | string | null
  limits_count: number
  limits_uzs: number | string | null
  limits_missing_rates: number
}

export interface CreditPortfolioRow {
  decision_id: string
  request_id: string
  policy_id: string
  policy_number: string
  policyholder_entity_id: string
  policyholder_name: string
  buyer_entity_id: string
  buyer_name: string
  buyer_country: string | null
  outcome: string
  approved_amount: number | string | null
  currency_code: string
  amount_uzs: number | string | null
  valid_until: string | null
  days_to_review: number | null
  decision_band: string
  current_grade: string | null
  current_band: string
  rated_at: string | null
}

/** PostgREST may hand numeric columns over as strings. */
export function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

const sum = (values: (number | null)[]) => values.reduce<number>((a, v) => a + (v ?? 0), 0)

/** Statuses whose cover is running: the in-force book. */
export const IN_FORCE_POLICY_STATUSES = ['active', 'suspended'] as const

export function inForce(row: { status: string }): boolean {
  return (IN_FORCE_POLICY_STATUSES as readonly string[]).includes(row.status)
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export interface CurrencyTotals {
  currency: string
  policies: number
  premiumBase: number
  earnedPremium: number
  premiumPaid: number
  premiumOverdue: number
  maxLiability: number
  claims: number
  openClaims: number
  indemnityPaid: number
  incurred: number
  /** incurred / premium base x 100 over the currency's policies; null while the base is 0. */
  lossRatioPct: number | null
}

/** One line per currency, largest premium first. */
export function policyTotalsByCurrency(rows: readonly PolicyPortfolioRow[]): CurrencyTotals[] {
  const groups = new Map<string, PolicyPortfolioRow[]>()
  for (const row of rows) groups.set(row.currency_code, [...(groups.get(row.currency_code) ?? []), row])
  return [...groups.entries()]
    .map(([currency, list]) => {
      const premiumBase = sum(list.map((r) => num(r.premium_base)))
      const incurred = sum(list.map((r) => num(r.incurred)))
      return {
        currency,
        policies: list.length,
        premiumBase,
        earnedPremium: sum(list.map((r) => num(r.earned_premium))),
        premiumPaid: sum(list.map((r) => num(r.premium_paid))),
        premiumOverdue: sum(list.map((r) => num(r.premium_overdue))),
        maxLiability: sum(list.map((r) => num(r.max_liability_amount))),
        claims: sum(list.map((r) => r.claims_count)),
        openClaims: sum(list.map((r) => r.open_claims)),
        indemnityPaid: sum(list.map((r) => num(r.indemnity_paid))),
        incurred,
        lossRatioPct: premiumBase > 0 ? Math.round((incurred * 1000) / premiumBase) / 10 : null,
      }
    })
    .sort((a, b) => b.premiumBase - a.premiumBase || a.currency.localeCompare(b.currency))
}

export interface CountRow {
  key: string
  count: number
}

/** How many policies per value of a column, most first. */
export function countBy<T>(rows: readonly T[], key: (row: T) => string | null): CountRow[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const k = key(row) ?? ''
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([k, count]) => ({ key: k, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/** In-force policies ending within `days` (renewal pipeline), soonest first. */
export function expiringWithin(rows: readonly PolicyPortfolioRow[], days: number): PolicyPortfolioRow[] {
  return rows
    .filter((r) => inForce(r) && r.days_to_expiry >= 0 && r.days_to_expiry <= days)
    .sort((a, b) => a.days_to_expiry - b.days_to_expiry)
}

/** Policies with a loss ratio, worst first. */
export function worstLossRatios(rows: readonly PolicyPortfolioRow[], limit: number): PolicyPortfolioRow[] {
  return rows
    .filter((r) => num(r.loss_ratio_pct) !== null && (num(r.incurred) ?? 0) > 0)
    .sort((a, b) => (num(b.loss_ratio_pct) ?? 0) - (num(a.loss_ratio_pct) ?? 0))
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Credit limits
// ---------------------------------------------------------------------------

export const GRADE_BANDS = ['A', 'B', 'C', 'D', 'unrated'] as const

export interface CreditTotals {
  limits: number
  buyers: number
  policies: number
  exposureUzs: number
  /** Limits whose currency has no UZS rate: left out of exposureUzs, counted here. */
  missingRates: number
}

export function creditTotals(rows: readonly CreditPortfolioRow[]): CreditTotals {
  return {
    limits: rows.length,
    buyers: new Set(rows.map((r) => r.buyer_entity_id)).size,
    policies: new Set(rows.map((r) => r.policy_id)).size,
    exposureUzs: sum(rows.map((r) => num(r.amount_uzs))),
    missingRates: rows.filter((r) => num(r.amount_uzs) === null).length,
  }
}

export interface ExposureRow {
  key: string
  limits: number
  exposureUzs: number
  missingRates: number
  /** Share of the total UZS exposure (0..1); null when there is none. */
  share: number | null
}

function exposureBy(rows: readonly CreditPortfolioRow[], key: (row: CreditPortfolioRow) => string): ExposureRow[] {
  const total = sum(rows.map((r) => num(r.amount_uzs)))
  const groups = new Map<string, CreditPortfolioRow[]>()
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row])
  return [...groups.entries()].map(([k, list]) => {
    const exposureUzs = sum(list.map((r) => num(r.amount_uzs)))
    return {
      key: k,
      limits: list.length,
      exposureUzs,
      missingRates: list.filter((r) => num(r.amount_uzs) === null).length,
      share: total > 0 ? exposureUzs / total : null,
    }
  })
}

/** Exposure by the buyer's CURRENT band, in band order, every band listed. */
export function exposureByBand(rows: readonly CreditPortfolioRow[]): ExposureRow[] {
  const found = new Map(exposureBy(rows, (r) => r.current_band).map((e) => [e.key, e]))
  const total = sum(rows.map((r) => num(r.amount_uzs)))
  return GRADE_BANDS.map(
    (band) => found.get(band) ?? { key: band, limits: 0, exposureUzs: 0, missingRates: 0, share: total > 0 ? 0 : null },
  )
}

export function exposureByCountry(rows: readonly CreditPortfolioRow[]): ExposureRow[] {
  return exposureBy(rows, (r) => r.buyer_country ?? '').sort(
    (a, b) => b.exposureUzs - a.exposureUzs || b.limits - a.limits || a.key.localeCompare(b.key),
  )
}

/** Limits per original currency: the amounts as granted, never converted. */
export function limitsByCurrency(rows: readonly CreditPortfolioRow[]): { currency: string; limits: number; amount: number }[] {
  const groups = new Map<string, { limits: number; amount: number }>()
  for (const row of rows) {
    const g = groups.get(row.currency_code) ?? { limits: 0, amount: 0 }
    groups.set(row.currency_code, { limits: g.limits + 1, amount: g.amount + (num(row.approved_amount) ?? 0) })
  }
  return [...groups.entries()]
    .map(([currency, g]) => ({ currency, ...g }))
    .sort((a, b) => b.limits - a.limits || a.currency.localeCompare(b.currency))
}

export interface BuyerExposure {
  buyerId: string
  buyerName: string
  country: string | null
  band: string
  grade: string | null
  limits: number
  policies: number
  exposureUzs: number
  missingRates: number
}

/** The largest buyers by UZS exposure across all policies. */
export function topBuyers(rows: readonly CreditPortfolioRow[], limit: number): BuyerExposure[] {
  const groups = new Map<string, CreditPortfolioRow[]>()
  for (const row of rows) groups.set(row.buyer_entity_id, [...(groups.get(row.buyer_entity_id) ?? []), row])
  return [...groups.entries()]
    .map(([buyerId, list]) => ({
      buyerId,
      buyerName: list[0].buyer_name,
      country: list[0].buyer_country,
      band: list[0].current_band,
      grade: list[0].current_grade,
      limits: list.length,
      policies: new Set(list.map((r) => r.policy_id)).size,
      exposureUzs: sum(list.map((r) => num(r.amount_uzs))),
      missingRates: list.filter((r) => num(r.amount_uzs) === null).length,
    }))
    .sort((a, b) => b.exposureUzs - a.exposureUzs || b.limits - a.limits || a.buyerName.localeCompare(b.buyerName))
    .slice(0, limit)
}

/** Limits whose validity ends within `days` (review pipeline), soonest first. */
export function reviewsDue(rows: readonly CreditPortfolioRow[], days: number): CreditPortfolioRow[] {
  return rows
    .filter((r) => r.days_to_review !== null && r.days_to_review >= 0 && r.days_to_review <= days)
    .sort((a, b) => (a.days_to_review ?? 0) - (b.days_to_review ?? 0))
}

/** Buyers with an in-force limit whose latest rating is older than `days`, or who have none. */
export function staleRatings(rows: readonly CreditPortfolioRow[], days: number, today: Date): CreditPortfolioRow[] {
  const cutoff = today.getTime() - days * 86_400_000
  const seen = new Set<string>()
  return rows.filter((r) => {
    if (seen.has(r.buyer_entity_id)) return false
    const stale = r.rated_at === null || new Date(r.rated_at).getTime() < cutoff
    if (stale) seen.add(r.buyer_entity_id)
    return stale
  })
}
