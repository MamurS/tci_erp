import { describe, expect, it } from 'vitest'

import {
  emptyBalanceSheet,
  emptyIncomeStatement,
  type BalanceSheetValues,
  type IncomeStatementValues,
} from '../types'
import { computeRatios, relativeChange } from './ratios'

function bs(overrides: Partial<BalanceSheetValues>): BalanceSheetValues {
  return { ...emptyBalanceSheet(), ...overrides }
}

function is(overrides: Partial<IncomeStatementValues>): IncomeStatementValues {
  return { ...emptyIncomeStatement(), ...overrides }
}

const SAMPLE_BS = bs({
  total_assets: 1000,
  total_equity: 400,
  total_liabilities: 600,
  total_current_assets: 500,
  total_current_liabilities: 250,
  inventories: 100,
  trade_receivables: 120,
  trade_payables: 90,
  cash_and_equivalents: 80,
  long_term_borrowings: 200,
  short_term_borrowings: 100,
})

const SAMPLE_IS = is({
  revenue: 2000,
  cost_of_sales: 1500,
  gross_profit: 500,
  operating_profit: 260,
  net_profit: 150,
  finance_costs: 40,
  depreciation_amortization: 60,
})

describe('profitability', () => {
  const r = computeRatios('annual', SAMPLE_BS, SAMPLE_IS)

  it('margins', () => {
    expect(r.gross_margin.value).toBeCloseTo(0.25)
    expect(r.operating_margin.value).toBeCloseTo(0.13)
    expect(r.net_margin.value).toBeCloseTo(0.075)
  })

  it('EBITDA margin uses operating profit + D&A', () => {
    expect(r.ebitda_margin.value).toBeCloseTo(320 / 2000)
  })

  it('ROA and ROE', () => {
    expect(r.roa.value).toBeCloseTo(0.15)
    expect(r.roe.value).toBeCloseTo(0.375)
    expect(r.roa.annualized).toBe(false)
  })
})

describe('solvency', () => {
  const r = computeRatios('annual', SAMPLE_BS, SAMPLE_IS)

  it('liquidity ratios', () => {
    expect(r.current_ratio.value).toBeCloseTo(2)
    expect(r.quick_ratio.value).toBeCloseTo(400 / 250)
    expect(r.cash_ratio.value).toBeCloseTo(80 / 250)
  })

  it('debt ratios use total borrowings', () => {
    expect(r.debt_to_equity.value).toBeCloseTo(300 / 400)
    expect(r.liabilities_to_assets.value).toBeCloseTo(0.6)
  })

  it('interest coverage and net debt / EBITDA', () => {
    expect(r.interest_coverage.value).toBeCloseTo(260 / 40)
    // net debt = 300 - 80 = 220; EBITDA = 320
    expect(r.net_debt_to_ebitda.value).toBeCloseTo(220 / 320)
  })
})

describe('efficiency', () => {
  const r = computeRatios('annual', SAMPLE_BS, SAMPLE_IS)

  it('turnover and working-capital days', () => {
    expect(r.asset_turnover.value).toBeCloseTo(2)
    expect(r.receivables_days.value).toBeCloseTo((120 / 2000) * 365)
    expect(r.inventory_days.value).toBeCloseTo((100 / 1500) * 365)
    expect(r.payables_days.value).toBeCloseTo((90 / 1500) * 365)
  })

  it('working capital cycle = DSO + DIO - DPO', () => {
    const expected = (120 / 2000) * 365 + (100 / 1500) * 365 - (90 / 1500) * 365
    expect(r.working_capital_cycle.value).toBeCloseTo(expected)
  })
})

describe('quarterly annualization', () => {
  const r = computeRatios('quarterly', SAMPLE_BS, SAMPLE_IS)

  it('flow/flow ratios are NOT annualized', () => {
    expect(r.gross_margin.value).toBeCloseTo(0.25)
    expect(r.gross_margin.annualized).toBe(false)
    expect(r.interest_coverage.value).toBeCloseTo(260 / 40)
  })

  it('flow/stock ratios annualize the flow (x4) and are flagged', () => {
    expect(r.roa.value).toBeCloseTo((150 * 4) / 1000)
    expect(r.roa.annualized).toBe(true)
    expect(r.asset_turnover.value).toBeCloseTo((2000 * 4) / 1000)
  })

  it('days ratios use annualized flow', () => {
    expect(r.receivables_days.value).toBeCloseTo((120 / 8000) * 365)
    expect(r.receivables_days.annualized).toBe(true)
  })

  it('net debt / EBITDA uses annualized EBITDA', () => {
    expect(r.net_debt_to_ebitda.value).toBeCloseTo(220 / (320 * 4))
  })
})

describe('null safety', () => {
  it('division by zero yields null, never Infinity', () => {
    const r = computeRatios('annual', bs({ total_current_liabilities: 0, total_current_assets: 10 }), null)
    expect(r.current_ratio.value).toBeNull()
  })

  it('missing inputs yield null', () => {
    const r = computeRatios('annual', null, null)
    for (const value of Object.values(r)) {
      expect(value.value).toBeNull()
    }
  })

  it('partial borrowings still sum', () => {
    const r = computeRatios('annual', bs({ short_term_borrowings: 50, total_equity: 100 }), null)
    expect(r.debt_to_equity.value).toBeCloseTo(0.5)
  })

  it('negative equity still computes (sign preserved)', () => {
    const r = computeRatios('annual', bs({ total_equity: -100, long_term_borrowings: 50 }), null)
    expect(r.debt_to_equity.value).toBeCloseTo(-0.5)
  })
})

describe('relativeChange', () => {
  it('growth and decline', () => {
    expect(relativeChange(120, 100)).toBeCloseTo(0.2)
    expect(relativeChange(80, 100)).toBeCloseTo(-0.2)
  })

  it('negative base uses absolute value', () => {
    expect(relativeChange(-50, -100)).toBeCloseTo(0.5)
  })

  it('null on zero or missing base', () => {
    expect(relativeChange(100, 0)).toBeNull()
    expect(relativeChange(null, 100)).toBeNull()
    expect(relativeChange(100, null)).toBeNull()
  })
})
