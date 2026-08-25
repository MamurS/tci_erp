import { describe, expect, it } from 'vitest'

import type { StatementBundle } from '../types'
import { emptyBalanceSheet } from '../types'
import { convertStatements, convertValue, requiredRates } from './fx'
import type { RateLookup } from './fx'

let seq = 0
function stmt(overrides: Partial<StatementBundle>): StatementBundle {
  seq += 1
  return {
    id: `s${seq}`,
    buyer_id: 'b1',
    statement_kind: 'annual',
    fiscal_year: 2025,
    fiscal_quarter: null,
    period_end_date: '2025-12-31',
    currency_code: 'UZS',
    unit: 'thousands',
    audited: false,
    source: null,
    accounting_basis: 'ifrs',
    template_id: null,
    mapping_status: 'n/a',
    report_type: 'statutory',
    created_at: '',
    updated_at: '',
    balance_sheets: null,
    income_statements: null,
    ...overrides,
  }
}

const RATES: Record<string, number> = {
  'USD:2025-12-31': 12_500,
  'EUR:2025-12-31': 13_500,
  'USD:2024-12-31': 12_000,
}

const lookup: RateLookup = (ccy, date) => RATES[`${ccy}:${date}`] ?? null

describe('convertValue', () => {
  it('UZS -> USD divides by the USD rate at the period end', () => {
    expect(convertValue(25_000_000, 'UZS', '2025-12-31', 'USD', lookup)).toBeCloseTo(2_000)
  })

  it('USD -> UZS multiplies by the USD rate', () => {
    expect(convertValue(100, 'USD', '2025-12-31', 'UZS', lookup)).toBeCloseTo(1_250_000)
  })

  it('cross conversion USD -> EUR goes through UZS', () => {
    expect(convertValue(135, 'USD', '2025-12-31', 'EUR', lookup)).toBeCloseTo(125)
  })

  it('same currency is unchanged; missing rate -> null', () => {
    expect(convertValue(500, 'USD', '2025-12-31', 'USD', lookup)).toBe(500)
    expect(convertValue(500, 'EUR', '2024-12-31', 'USD', lookup)).toBeNull()
    expect(convertValue(null, 'UZS', '2025-12-31', 'USD', lookup)).toBeNull()
  })
})

describe('requiredRates', () => {
  it('lists unique (currency, date) pairs excluding UZS', () => {
    const a = stmt({ currency_code: 'UZS', period_end_date: '2025-12-31' })
    const b = stmt({ currency_code: 'USD', period_end_date: '2024-12-31' })
    const needs = requiredRates([a, b], 'USD')
    expect(needs).toEqual(
      expect.arrayContaining([
        { currency_code: 'USD', rate_date: '2025-12-31' },
        { currency_code: 'USD', rate_date: '2024-12-31' },
      ]),
    )
    expect(needs).toHaveLength(2)
  })

  it('original display needs no rates', () => {
    expect(requiredRates([stmt({ currency_code: 'USD' })], 'original')).toEqual([])
  })
})

describe('convertStatements', () => {
  it('converts balance sheet values and reports footnote rates', () => {
    const s = stmt({
      currency_code: 'UZS',
      balance_sheets: { ...emptyBalanceSheet(), total_assets: 125_000_000 },
    })
    const { statements, missing, footnotes } = convertStatements([s], 'USD', lookup)
    expect(statements[0].currency_code).toBe('USD')
    expect(statements[0].balance_sheets?.total_assets).toBeCloseTo(10_000)
    expect(missing).toHaveLength(0)
    expect(footnotes[0].rates[0]).toEqual({
      currency_code: 'USD',
      rate_to_uzs: 12_500,
      rate_date: '2025-12-31',
    })
  })

  it('missing rates are collected once per (ccy, date)', () => {
    const a = stmt({ currency_code: 'EUR', period_end_date: '2024-12-31' })
    const b = stmt({ currency_code: 'EUR', period_end_date: '2024-12-31' })
    const { missing } = convertStatements([a, b], 'UZS', lookup)
    expect(missing).toEqual([{ currency_code: 'EUR', rate_date: '2024-12-31' }])
  })

  it('original passes statements through untouched', () => {
    const s = stmt({ currency_code: 'EUR' })
    const result = convertStatements([s], 'original', lookup)
    expect(result.statements[0]).toBe(s)
  })
})
