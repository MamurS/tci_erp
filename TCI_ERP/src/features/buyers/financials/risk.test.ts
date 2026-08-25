import { describe, expect, it } from 'vitest'

import type { StatementBundle } from '../types'
import { emptyBalanceSheet, emptyIncomeStatement } from '../types'
import type { BalanceSheetValues, IncomeStatementValues } from '../types'
import { altmanZ, buildRiskPeriods, normBreached, zBand } from './risk'

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

function bs(overrides: Partial<BalanceSheetValues>): BalanceSheetValues {
  return { ...emptyBalanceSheet(), ...overrides }
}

function is(overrides: Partial<IncomeStatementValues>): IncomeStatementValues {
  return { ...emptyIncomeStatement(), ...overrides }
}

describe('Altman Z\'\'-score (EM version)', () => {
  it('computes 6.56 X1 + 3.26 X2 + 6.72 X3 + 1.05 X4 + 3.25', () => {
    const z = altmanZ({
      workingCapital: 100, // X1 = 0.1
      retainedEarnings: 200, // X2 = 0.2
      ebit: 150, // X3 = 0.15
      equity: 400, // X4 = 400/600
      totalAssets: 1000,
      totalLiabilities: 600,
    })
    const expected = 6.56 * 0.1 + 3.26 * 0.2 + 6.72 * 0.15 + 1.05 * (400 / 600) + 3.25
    expect(z).toBeCloseTo(expected)
  })

  it('null when any input is missing', () => {
    expect(
      altmanZ({
        workingCapital: 100, retainedEarnings: null, ebit: 150,
        equity: 400, totalAssets: 1000, totalLiabilities: 600,
      }),
    ).toBeNull()
  })

  it('bands: safe > 5.85, grey 4.35-5.85, distress < 4.35', () => {
    expect(zBand(6.0)).toBe('safe')
    expect(zBand(5.0)).toBe('grey')
    expect(zBand(4.0)).toBe('distress')
    expect(zBand(null)).toBeNull()
  })
})

describe('norm breaches', () => {
  it('min norms', () => {
    expect(normBreached(0.9, { min: 1 })).toBe(true)
    expect(normBreached(1.2, { min: 1 })).toBe(false)
  })

  it('max norms', () => {
    expect(normBreached(1.5, { max: 1 })).toBe(true)
    expect(normBreached(0.7, { max: 1 })).toBe(false)
  })

  it('null value or no norm -> no breach', () => {
    expect(normBreached(null, { min: 1 })).toBe(false)
    expect(normBreached(0.1, undefined)).toBe(false)
  })
})

describe('buildRiskPeriods', () => {
  const healthy = stmt({
    fiscal_year: 2025,
    period_end_date: '2025-12-31',
    balance_sheets: bs({
      total_assets: 1000,
      total_liabilities: 550,
      total_equity: 450,
      total_current_assets: 500,
      total_current_liabilities: 250,
      retained_earnings: 300,
      inventories: 100,
      cash_and_equivalents: 80,
      long_term_borrowings: 200,
      short_term_borrowings: 100,
      trade_receivables: 120,
      trade_payables: 90,
    }),
    income_statements: is({
      revenue: 2000,
      cost_of_sales: 1500,
      operating_profit: 260,
      finance_costs: 40,
      net_profit: 150,
    }),
  })

  it('computes risk rows with norm flags', () => {
    const [period] = buildRiskPeriods([healthy], [healthy])
    expect(period.values.net_working_capital).toBe(250)
    expect(period.values.current_ratio).toBeCloseTo(2)
    expect(period.values.leverage).toBeCloseTo(300 / 450)
    expect(period.values.borrowed_concentration).toBeCloseTo(0.55)
    expect(period.values.interest_coverage).toBeCloseTo(6.5)
    expect(period.breaches.current_ratio).toBe(false)
    expect(period.breaches.leverage).toBe(false)
    expect(period.zBand).not.toBeNull()
  })

  it('flags norm breaches (weak liquidity, heavy leverage)', () => {
    const weak = stmt({
      balance_sheets: bs({
        total_assets: 1000,
        total_liabilities: 900,
        total_equity: 100,
        total_current_assets: 200,
        total_current_liabilities: 400,
        inventories: 150,
        long_term_borrowings: 500,
        short_term_borrowings: 200,
      }),
      income_statements: is({ operating_profit: 30, finance_costs: 60 }),
    })
    const [period] = buildRiskPeriods([weak], [weak])
    expect(period.breaches.current_ratio).toBe(true) // 0.5 < 1
    expect(period.breaches.quick_ratio).toBe(true) // 0.125 < 0.5
    expect(period.breaches.leverage).toBe(true) // 7 > 1
    expect(period.breaches.borrowed_concentration).toBe(true) // 0.9 > 0.8
    expect(period.breaches.interest_coverage).toBe(true) // 0.5 < 2
  })

  it('CFO-based rows appear only when a prior same-kind statement exists', () => {
    const prev = stmt({
      fiscal_year: 2024,
      period_end_date: '2024-12-31',
      balance_sheets: bs({ cash_and_equivalents: 50, total_current_liabilities: 200 }),
      income_statements: is({}),
    })
    const alone = buildRiskPeriods([healthy], [healthy])
    expect(alone[0].values.cfo_to_current_liabilities).toBeNull()

    const withPrev = buildRiskPeriods([healthy], [prev, healthy])
    expect(withPrev[0].values.cfo_to_current_liabilities).not.toBeNull()
  })
})
