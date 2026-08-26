/**
 * Regression: growth dynamics are ALWAYS computed in the original statement
 * currency. With rising UZS values and a moving USD rate, the USD-converted
 * LEVELS may even fall — but every growth % (narrative, table Δ%) must equal
 * the UZS-based figure regardless of the selected display currency.
 */

import { describe, expect, it } from 'vitest'

import type { StatementBundle } from '../types'
import { emptyBalanceSheet, emptyIncomeStatement } from '../types'
import type { BalanceSheetValues, IncomeStatementValues } from '../types'
import {
  applyDisplayCurrency,
  incomeStatementColumns,
  relativeChange,
} from './analysis'
import { buildCashFlowColumns } from './cashflow'
import { convertStatements } from './fx'
import type { RateLookup } from './fx'
import { buildRiskPeriods } from './risk'
import { buildNarrative } from '../report/narrative'

function stmt(overrides: Partial<StatementBundle>): StatementBundle {
  return {
    id: 'x',
    entity_id: 'b1',
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

const bs = (o: Partial<BalanceSheetValues>): BalanceSheetValues => ({
  ...emptyBalanceSheet(),
  ...o,
})
const is = (o: Partial<IncomeStatementValues>): IncomeStatementValues => ({
  ...emptyIncomeStatement(),
  ...o,
})

// Rising UZS revenue: 1 800 000 -> 2 000 000 (+11.11%).
const prev = stmt({
  id: 'p',
  fiscal_year: 2024,
  period_end_date: '2024-12-31',
  balance_sheets: bs({
    total_assets: 900_000,
    total_current_assets: 450_000,
    total_current_liabilities: 250_000,
    total_equity: 350_000,
    total_liabilities: 550_000,
    trade_receivables: 100_000,
    inventories: 90_000,
    trade_payables: 80_000,
    cash_and_equivalents: 40_000,
  }),
  income_statements: is({
    revenue: 1_800_000,
    cost_of_sales: 1_400_000,
    gross_profit: 400_000,
    operating_profit: 220_000,
    net_profit: 120_000,
  }),
})
const cur = stmt({
  id: 'c',
  fiscal_year: 2025,
  period_end_date: '2025-12-31',
  balance_sheets: bs({
    total_assets: 1_000_000,
    total_current_assets: 500_000,
    total_current_liabilities: 250_000,
    total_equity: 400_000,
    total_liabilities: 600_000,
    trade_receivables: 120_000,
    inventories: 100_000,
    trade_payables: 90_000,
    cash_and_equivalents: 80_000,
  }),
  income_statements: is({
    revenue: 2_000_000,
    cost_of_sales: 1_500_000,
    gross_profit: 500_000,
    operating_profit: 260_000,
    net_profit: 150_000,
    depreciation_amortization: 60_000,
  }),
})

// USD strengthens 12 000 -> 13 500 UZS: USD-converted revenue FALLS.
const rateFor: RateLookup = (ccy, date) =>
  ccy === 'USD' ? (date === '2024-12-31' ? 12_000 : 13_500) : null

const UZS_GROWTH = (2_000_000 - 1_800_000) / 1_800_000

describe('growth dynamics stay in the original statement currency', () => {
  const originals = [prev, cur]
  const converted = convertStatements(originals, 'USD', rateFor).statements

  it('sanity: USD-converted levels move against the UZS trend', () => {
    const usdPrev = converted[0].income_statements?.revenue ?? 0
    const usdCur = converted[1].income_statements?.revenue ?? 0
    expect(usdCur).toBeLessThan(usdPrev) // FX distortion the fix must ignore
  })

  it('narrative growth % equals the UZS-based figure under USD display', () => {
    const narrative = buildNarrative({
      statements: converted,
      all: converted,
      riskPeriods: buildRiskPeriods(converted, converted),
      cashFlowColumns: buildCashFlowColumns(converted, converted),
      originalAll: originals,
    })
    const bullet = narrative.find((b) => b.key.startsWith('revenue_'))
    expect(bullet?.key).toBe('revenue_grew') // not revenue_fell
    expect(Number(bullet?.params.pct)).toBeCloseTo(UZS_GROWTH * 100, 5)
    // Levels stay in the display currency.
    expect(Number(bullet?.params.amount)).toBeCloseTo(2_000_000 / 13_500, 5)
    expect(String(bullet?.params.currency)).toBe('USD')
  })

  it('narrative growth % is identical for original and USD display', () => {
    const originalNarrative = buildNarrative({
      statements: originals,
      all: originals,
      riskPeriods: buildRiskPeriods(originals, originals),
      cashFlowColumns: buildCashFlowColumns(originals, originals),
    })
    const usdNarrative = buildNarrative({
      statements: converted,
      all: converted,
      riskPeriods: buildRiskPeriods(converted, converted),
      cashFlowColumns: buildCashFlowColumns(converted, converted),
      originalAll: originals,
    })
    const pct = (bullets: typeof originalNarrative) =>
      Number(bullets.find((b) => b.key.startsWith('revenue_'))?.params.pct)
    expect(pct(usdNarrative)).toBeCloseTo(pct(originalNarrative), 10)
  })

  it('table Δ% columns compare original values while levels are converted', () => {
    const columns = applyDisplayCurrency(
      incomeStatementColumns(originals, originals),
      converted,
    )
    const latest = columns[1]
    // Displayed level is USD…
    expect(latest.statement.currency_code).toBe('USD')
    expect(latest.statement.income_statements?.revenue).toBeCloseTo(2_000_000 / 13_500, 5)
    // …while Δ% inputs are the original UZS bundles.
    const delta = relativeChange(
      latest.deltaCurrent.income_statements?.revenue ?? null,
      latest.deltaBase?.income_statements?.revenue ?? null,
    )
    expect(delta).toBeCloseTo(UZS_GROWTH, 10)
  })
})
