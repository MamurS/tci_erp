/**
 * Authority conversion — pure module, EXACT mirror of the SQL rule in
 * migration 0013 (tci.latest_uzs_rate / tci.to_uzs / tci.my_authority_uzs
 * / the underwriter branch of tci.decide_limit_request):
 *
 *   - amounts are compared in UZS;
 *   - rate(ccy) = the fx_rates row with the latest rate_date <= today,
 *     preferring source 'cbu' over 'manual' on the same date; UZS = 1;
 *   - a missing rate is an explicit failure (the user must add the rate);
 *   - an underwriter's authority = MAX over their currently valid
 *     underwriting_authorities rows, converted the same way;
 *   - admin and senior_underwriter decide regardless of amount.
 *
 * Used for the decision-form preflight banner; the SQL function is the
 * enforcing side.
 */

import type { UserRole } from '../../lib/roles'
import type { UnderwritingAuthority } from './types'

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

/** MAX authority in UZS over currently valid rows; 0 when none. */
export function authorityUzs(
  authorities: readonly UnderwritingAuthority[],
  rates: readonly FxRateRow[],
  todayIso: string,
): number {
  let max = 0
  for (const a of authorities) {
    if (a.valid_from > todayIso) continue
    if (a.valid_to !== null && a.valid_to < todayIso) continue
    const converted = toUzs(Number(a.max_amount), a.currency_code, rates, todayIso)
    if (converted !== null && converted > max) max = converted
  }
  return max
}

export interface AuthorityPreflight {
  /** null = cannot evaluate (missing rate) — the SQL side would raise P0003. */
  amountUzs: number | null
  authorityUzs: number | null
  /** true = decision records; false = would escalate; null = unknown (missing rate). */
  withinAuthority: boolean | null
}

/** Mirror of the underwriter branch of tci.decide_limit_request. */
export function preflight(
  amount: number,
  currencyCode: string,
  role: UserRole | null,
  myAuthorityUzsValue: number | null,
  rates: readonly FxRateRow[],
  todayIso: string,
): AuthorityPreflight {
  if (role === 'admin' || role === 'senior_underwriter') {
    return { amountUzs: null, authorityUzs: null, withinAuthority: true }
  }
  const amountUzs = toUzs(amount, currencyCode, rates, todayIso)
  if (amountUzs === null || myAuthorityUzsValue === null) {
    return { amountUzs, authorityUzs: myAuthorityUzsValue, withinAuthority: null }
  }
  return {
    amountUzs,
    authorityUzs: myAuthorityUzsValue,
    withinAuthority: amountUzs <= myAuthorityUzsValue,
  }
}
