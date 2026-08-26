/**
 * Display-currency conversion — pure module.
 *
 * Rates are stored as "UZS per 1 unit of currency" (CBU convention) at a
 * given date. Conversion of a statement value uses the rate at the
 * statement's period_end_date:
 *
 *   value_in_target = value × rate(from→UZS) / rate(target→UZS)
 *
 * UZS itself has an implicit rate of 1.
 */

import type { StatementBundle } from '../types'
import { BALANCE_SHEET_KEYS, INCOME_STATEMENT_KEYS } from '../types'
import type { BalanceSheetValues, IncomeStatementValues } from '../types'

export type DisplayCurrency = 'original' | 'UZS' | 'USD' | 'EUR'

export interface RateNeed {
  currency_code: string
  rate_date: string
}

export function rateKey(currencyCode: string, rateDate: string): string {
  return `${currencyCode}:${rateDate}`
}

/** Unique (currency, date) pairs needed to convert the displayed statements. */
export function requiredRates(
  displayed: StatementBundle[],
  target: DisplayCurrency,
): RateNeed[] {
  if (target === 'original') return []
  const needs = new Map<string, RateNeed>()
  for (const s of displayed) {
    for (const ccy of [s.currency_code, target]) {
      if (ccy === 'UZS') continue
      const key = rateKey(ccy, s.period_end_date)
      if (!needs.has(key)) needs.set(key, { currency_code: ccy, rate_date: s.period_end_date })
    }
  }
  return [...needs.values()]
}

/** rate lookup: (ccy, date) -> UZS per unit, or null when unknown. */
export type RateLookup = (currencyCode: string, rateDate: string) => number | null

export function convertValue(
  value: number | null,
  fromCcy: string,
  date: string,
  target: Exclude<DisplayCurrency, 'original'>,
  rateFor: RateLookup,
): number | null {
  if (value === null) return null
  if (fromCcy === target) return value
  const fromRate = fromCcy === 'UZS' ? 1 : rateFor(fromCcy, date)
  const toRate = target === 'UZS' ? 1 : rateFor(target, date)
  if (fromRate === null || toRate === null || toRate === 0) return null
  return (value * fromRate) / toRate
}

export interface FootnoteRate {
  currency_code: string
  rate_to_uzs: number
  rate_date: string
}

export interface ConvertedStatements {
  statements: StatementBundle[]
  /** (ccy, date) pairs that had no rate — conversion incomplete. */
  missing: RateNeed[]
  /** Footnote data: per period, the rates applied (formatting is done in
   * the UI layer via format.ts — never here). */
  footnotes: { statement: StatementBundle; rates: FootnoteRate[] }[]
}

/** Convert monetary values of the displayed statements into the target
 * currency (ratios are scale-invariant and not converted). */
export function convertStatements(
  displayed: StatementBundle[],
  target: DisplayCurrency,
  rateFor: RateLookup,
): ConvertedStatements {
  if (target === 'original') {
    return { statements: displayed, missing: [], footnotes: [] }
  }

  const missing = new Map<string, RateNeed>()
  const footnotes: ConvertedStatements['footnotes'] = []

  const statements = displayed.map((s) => {
    const date = s.period_end_date
    const rates: FootnoteRate[] = []
    for (const ccy of [...new Set([s.currency_code, target])]) {
      if (ccy === 'UZS') continue
      const rate = rateFor(ccy, date)
      if (rate === null) {
        missing.set(rateKey(ccy, date), { currency_code: ccy, rate_date: date })
      } else {
        rates.push({ currency_code: ccy, rate_to_uzs: rate, rate_date: date })
      }
    }
    if (rates.length) footnotes.push({ statement: s, rates })

    const convert = (v: number | null): number | null =>
      convertValue(v, s.currency_code, date, target, rateFor)

    const bs = s.balance_sheets
      ? (Object.fromEntries(
          BALANCE_SHEET_KEYS.map((k) => [k, convert(s.balance_sheets?.[k] ?? null)]),
        ) as BalanceSheetValues)
      : null
    const is = s.income_statements
      ? (Object.fromEntries(
          INCOME_STATEMENT_KEYS.map((k) => [k, convert(s.income_statements?.[k] ?? null)]),
        ) as IncomeStatementValues)
      : null

    return { ...s, currency_code: target, balance_sheets: bs, income_statements: is }
  })

  return { statements, missing: [...missing.values()], footnotes }
}
