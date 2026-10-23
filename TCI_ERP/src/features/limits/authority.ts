/**
 * Authority conversion — pure module, EXACT mirror of the SQL rule in
 * migration 0013 (tci.latest_uzs_rate / tci.to_uzs / tci.my_authority_uzs
 * / the underwriter branch of tci.decide_limit_request):
 *
 *   - amounts are compared in UZS;
 *   - rate(ccy) = the fx_rates row with the latest rate_date <= today,
 *     preferring source 'cbu' over 'manual' on the same date; UZS = 1;
 *   - a missing rate is an explicit failure (the user must add the rate);
 *   - authority is resolved PER GRADE BAND: MAX over the caller's currently
 *     valid 'credit' authority_grants for that band, converted the same way;
 *   - ADMIN is unlimited and never consults the matrix.
 *
 * Used for the decision-form preflight banner; the SQL function is the
 * enforcing side. Since 0060 a decision beyond authority is not escalated:
 * decide_limit_request (and adjust_limit_commercial, for an increase) answer
 * `needs_validation` and record nothing, and the screen offers «Отправить на
 * валидацию» instead of the decision button (validation.ts).
 */

import type { AuthorityScope, GradeBand } from '../../lib/roles'
import type { AuthorityGrant } from './types'

export interface FxRateRow {
  currency_code: string
  rate_to_uzs: number
  rate_date: string
  source: 'cbu' | 'manual'
}

/** Latest rate to UZS as of `todayIso`; null when no usable rate exists. */
export function latestUzsRate(
  rates: readonly FxRateRow[],
  currencyCode: string,
  todayIso: string,
): number | null {
  if (currencyCode === 'UZS') return 1
  const usable = rates.filter(
    (r) => r.currency_code === currencyCode && r.rate_date <= todayIso,
  )
  if (!usable.length) return null
  usable.sort((a, b) =>
    a.rate_date === b.rate_date
      ? Number(b.source === 'cbu') - Number(a.source === 'cbu')
      : b.rate_date.localeCompare(a.rate_date),
  )
  return Number(usable[0].rate_to_uzs)
}

/** Amount in UZS; null when the rate is missing (SQL raises P0003 instead). */
export function toUzs(
  amount: number,
  currencyCode: string,
  rates: readonly FxRateRow[],
  todayIso: string,
): number | null {
  const rate = latestUzsRate(rates, currencyCode, todayIso)
  return rate === null ? null : amount * rate
}

/** `amount` in `from` expressed in `to`, both through UZS at their latest
 * rates (the same rule as latestUzsRate). Null when either rate is missing:
 * the caller says so rather than showing the amount in a currency the reader
 * did not ask for. Display only — no decision is taken on this figure. */
export function convertAtLatest(
  amount: number,
  from: string,
  to: string,
  rates: readonly FxRateRow[],
  todayIso: string,
): number | null {
  if (from === to) return amount
  const fromRate = latestUzsRate(rates, from, todayIso)
  const toRate = latestUzsRate(rates, to, todayIso)
  if (fromRate === null || toRate === null || toRate === 0) return null
  return (amount * fromRate) / toRate
}

/** MAX authority in UZS for ONE stream and ONE band over currently valid
 * grants; 0 when none. The 'credit' stream is tci.my_authority_uzs(band);
 * the 'commercial' stream is the identical aggregate inlined in
 * tci.adjust_limit_commercial (migration 0020) — one rule, two streams. */
export function scopedAuthorityUzs(
  grants: readonly AuthorityGrant[],
  scope: AuthorityScope,
  band: GradeBand,
  rates: readonly FxRateRow[],
  todayIso: string,
): number {
  let max = 0
  for (const g of grants) {
    if (g.applies_to !== scope) continue
    if (g.grade_band !== band) continue
    if (g.valid_from > todayIso) continue
    if (g.valid_to !== null && g.valid_to < todayIso) continue
    const converted = toUzs(Number(g.max_amount), g.currency_code, rates, todayIso)
    if (converted !== null && converted > max) max = converted
  }
  return max
}

/** Mirror of tci.my_authority_uzs(band) — the 'credit' stream. */
export function authorityUzs(
  grants: readonly AuthorityGrant[],
  band: GradeBand,
  rates: readonly FxRateRow[],
  todayIso: string,
): number {
  return scopedAuthorityUzs(grants, 'credit', band, rates, todayIso)
}

/** Mirror of the authority branch of tci.adjust_limit_commercial: the
 * adjuster is bounded by their COMMERCIAL authority for the band of the credit
 * decision being adjusted. Since 0063 nobody is exempt — admin included. */
export function commercialPreflight(
  amount: number,
  currencyCode: string,
  band: GradeBand,
  grants: readonly AuthorityGrant[],
  rates: readonly FxRateRow[],
  todayIso: string,
): AuthorityPreflight {
  const authority = scopedAuthorityUzs(grants, 'commercial', band, rates, todayIso)
  const amountUzs = toUzs(amount, currencyCode, rates, todayIso)
  if (amountUzs === null) {
    return { band, amountUzs: null, authorityUzs: authority, withinAuthority: null }
  }
  return { band, amountUzs, authorityUzs: authority, withinAuthority: amountUzs <= authority }
}

export interface AuthorityPreflight {
  /** The band the decision is judged in (from the chosen assessment). */
  band: GradeBand
  /** null = cannot evaluate (missing rate) — the SQL side would raise P0003. */
  amountUzs: number | null
  authorityUzs: number | null
  /** true = decision records; false = needs validation (0060); null = unknown (missing rate). */
  withinAuthority: boolean | null
}

/** Mirror of the authority branch of tci.decide_limit_request: the decider
 * is bounded by their authority for THIS band. Since 0063 nobody is exempt —
 * admin included. */
export function preflight(
  amount: number,
  currencyCode: string,
  band: GradeBand,
  myAuthorityUzsValue: number | null,
  rates: readonly FxRateRow[],
  todayIso: string,
): AuthorityPreflight {
  const amountUzs = toUzs(amount, currencyCode, rates, todayIso)
  if (amountUzs === null || myAuthorityUzsValue === null) {
    return { band, amountUzs, authorityUzs: myAuthorityUzsValue, withinAuthority: null }
  }
  return {
    band,
    amountUzs,
    authorityUzs: myAuthorityUzsValue,
    withinAuthority: amountUzs <= myAuthorityUzsValue,
  }
}
