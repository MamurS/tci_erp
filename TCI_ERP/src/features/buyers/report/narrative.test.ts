import { describe, expect, it } from 'vitest'

import en from '../../../i18n/locales/en.json'
import ru from '../../../i18n/locales/ru.json'
import uz from '../../../i18n/locales/uz.json'
import type { StatementBundle } from '../types'
import { emptyBalanceSheet, emptyIncomeStatement } from '../types'
import type { BalanceSheetValues, IncomeStatementValues } from '../types'
import { buildCashFlowColumns } from '../financials/cashflow'
import { buildRiskPeriods } from '../financials/risk'
import { buildNarrative } from './narrative'

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

const prev = stmt({
  fiscal_year: 2024,
  period_end_date: '2024-12-31',
  balance_sheets: bs({
    total_assets: 900,
    total_current_assets: 450,
    total_current_liabilities: 250,
    total_equity: 350,
    total_liabilities: 550,
    retained_earnings: 200,
    inventories: 90,
    trade_receivables: 100,
    trade_payables: 80,
    cash_and_equivalents: 40,
    long_term_borrowings: 150,
    short_term_borrowings: 80,
  }),
  income_statements: is({
    revenue: 1800,
    cost_of_sales: 1400,
    gross_profit: 400,
    operating_profit: 220,
    finance_costs: 35,
    net_profit: 120,
  }),
})

const cur = stmt({
  fiscal_year: 2025,
  period_end_date: '2025-12-31',
  balance_sheets: bs({
    total_assets: 1000,
    total_current_assets: 500,
    total_current_liabilities: 250,
    total_equity: 400,
    total_liabilities: 600,
    retained_earnings: 260,
    inventories: 100,
    trade_receivables: 120,
    trade_payables: 90,
    cash_and_equivalents: 80,
    long_term_borrowings: 200,
    short_term_borrowings: 100,
  }),
  income_statements: is({
    revenue: 2000,
    cost_of_sales: 1500,
    gross_profit: 500,
    operating_profit: 260,
    finance_costs: 40,
    net_profit: 150,
    depreciation_amortization: 60,
  }),
})

function narrativeFor(statements: StatementBundle[], all: StatementBundle[]) {
  return buildNarrative({
    statements,
    all,
    riskPeriods: buildRiskPeriods(statements, all),
    cashFlowColumns: buildCashFlowColumns(statements, all),
  })
}

describe('buildNarrative', () => {
  const bullets = narrativeFor([prev, cur], [prev, cur])
  const keys = bullets.map((b) => b.key)

  it('produces 6-10 bullets grouped by theme order', () => {
    expect(bullets.length).toBeGreaterThanOrEqual(6)
    expect(bullets.length).toBeLessThanOrEqual(10)
    const themes = bullets.map((b) => b.theme)
    const order = ['performance', 'profitability', 'leverage', 'liquidity', 'cashflow', 'activity', 'risk']
    expect([...themes].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(themes)
  })

  it('states revenue growth with like-for-like base', () => {
    const bullet = bullets.find((b) => b.key === 'revenue_grew')
    expect(bullet).toBeDefined()
    expect(bullet?.params.pct).toBeCloseTo(11.11, 1)
  })

  it('covers profitability, leverage, liquidity, cashflow, activity and risk', () => {
    expect(keys).toContain('gross_margin_up') // 22.2% -> 25%
    expect(keys).toContain('net_profit_positive')
    expect(keys).toContain('leverage_moderate') // 300/400 = 0.75
    expect(keys).toContain('liquidity_ok') // 2.0
    expect(keys.some((k) => k.startsWith('cfo_'))).toBe(true)
    expect(keys).toContain('ccc_level')
    expect(keys.some((k) => k.startsWith('z_'))).toBe(true)
  })

  it('deterministic: same input, same output', () => {
    expect(narrativeFor([prev, cur], [prev, cur])).toEqual(bullets)
  })

  it('omits sentences whose inputs are missing', () => {
    const bare = stmt({
      fiscal_year: 2025,
      income_statements: is({ revenue: 500 }),
    })
    const soloKeys = narrativeFor([bare], [bare]).map((b) => b.key)
    expect(soloKeys).toContain('revenue_level') // no base -> level phrasing
    expect(soloKeys).not.toContain('gross_margin_up')
    expect(soloKeys).not.toContain('leverage_low')
    expect(soloKeys.some((k) => k.startsWith('cfo_'))).toBe(false)
  })

  it('flags a net loss and a liquidity breach', () => {
    const distressed = stmt({
      fiscal_year: 2025,
      balance_sheets: bs({
        total_current_assets: 100,
        total_current_liabilities: 200,
        total_equity: 100,
        long_term_borrowings: 300,
      }),
      income_statements: is({ revenue: 1000, net_profit: -50 }),
    })
    const soloKeys = narrativeFor([distressed], [distressed]).map((b) => b.key)
    expect(soloKeys).toContain('net_loss')
    expect(soloKeys).toContain('liquidity_breach')
    expect(soloKeys).toContain('leverage_high')
  })
})

describe('narrative i18n coverage', () => {
  const INVENTORY = [
    'revenue_grew', 'revenue_fell', 'revenue_flat', 'revenue_level',
    'gross_margin_up', 'gross_margin_down', 'net_profit_positive', 'net_loss',
    'leverage_low', 'leverage_moderate', 'leverage_high',
    'liquidity_ok', 'liquidity_breach',
    'cfo_positive', 'cfo_negative', 'cfo_negative_persistent',
    'dso_up', 'dso_down', 'ccc_level',
    'z_safe', 'z_grey', 'z_distress', 'norm_breaches',
  ]

  it.each([
    ['en', en],
    ['ru', ru],
    ['uz', uz],
  ])('every narrative template exists in %s', (_lang, catalog) => {
    const templates = (catalog as { report: { narrative: Record<string, string> } }).report
      .narrative
    for (const key of INVENTORY) {
      expect(templates[key], `missing report.narrative.${key}`).toBeTruthy()
    }
  })
})
