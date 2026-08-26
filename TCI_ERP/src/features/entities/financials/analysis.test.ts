import { describe, expect, it } from 'vitest'

import type { StatementBundle } from '../types'
import { statementPeriodLabel } from '../types'
import {
  balanceSheetColumns,
  defaultSelection,
  findLikeForLikeBase,
  hasMixedCurrencyOrUnit,
  incomeStatementColumns,
  verticalShare,
} from './analysis'
import { validateBalanceSheet, validateIncomeStatement } from './validation'
import { emptyBalanceSheet, emptyIncomeStatement } from '../types'

let seq = 0
function stmt(
  overrides: Partial<StatementBundle>,
): StatementBundle {
  seq += 1
  return {
    id: `s${seq}`,
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

describe('period labels', () => {
  it('compact annual and quarterly labels', () => {
    expect(statementPeriodLabel({ statement_kind: 'annual', fiscal_year: 2025, fiscal_quarter: null })).toBe('2025')
    expect(statementPeriodLabel({ statement_kind: 'quarterly', fiscal_year: 2025, fiscal_quarter: 1 })).toBe('2025 (1)')
  })
})

describe('defaultSelection', () => {
  it('picks last 6 by period_end_date, chronological', () => {
    const s = [
      stmt({ id: 'a', period_end_date: '2019-12-31' }),
      stmt({ id: 'b', period_end_date: '2024-12-31' }),
      stmt({ id: 'c', period_end_date: '2023-12-31' }),
      stmt({ id: 'd', period_end_date: '2025-03-31' }),
      stmt({ id: 'e', period_end_date: '2020-12-31' }),
      stmt({ id: 'f', period_end_date: '2021-12-31' }),
      stmt({ id: 'g', period_end_date: '2022-12-31' }),
    ]
    expect(defaultSelection(s)).toEqual(['e', 'f', 'g', 'c', 'b', 'd'])
  })
})

describe('balanceSheetColumns', () => {
  it('delta vs previous displayed column; first column has none', () => {
    const s1 = stmt({ fiscal_year: 2023, period_end_date: '2023-12-31' })
    const s2 = stmt({ fiscal_year: 2024, period_end_date: '2024-12-31' })
    const s3 = stmt({ fiscal_year: 2025, period_end_date: '2025-12-31' })
    const cols = balanceSheetColumns([s3, s1, s2]) // unordered input

    expect(cols.map((c) => c.statement.fiscal_year)).toEqual([2023, 2024, 2025])
    expect(cols[0].deltaBase).toBeNull()
    expect(cols[1].deltaBase?.fiscal_year).toBe(2023)
    expect(cols[2].deltaBaseLabel).toBe('2024')
  })

  it('never mixes report types: delta base skips management columns', () => {
    const st2023 = stmt({ fiscal_year: 2023, period_end_date: '2023-12-31' })
    const mgmt2024 = stmt({
      fiscal_year: 2024,
      period_end_date: '2024-12-31',
      report_type: 'management',
    })
    const st2025 = stmt({ fiscal_year: 2025, period_end_date: '2025-12-31' })
    const cols = balanceSheetColumns([st2023, mgmt2024, st2025])

    // statutory 2025 compares to statutory 2023, skipping management 2024
    expect(cols[2].deltaBase?.id).toBe(st2023.id)
    // management 2024 has no same-type predecessor displayed
    expect(cols[1].deltaBase).toBeNull()
  })
})

describe('like-for-like P&L comparison', () => {
  const fy2024 = stmt({ fiscal_year: 2024, period_end_date: '2024-12-31' })
  const fy2025 = stmt({ fiscal_year: 2025, period_end_date: '2025-12-31' })
  const q1_24 = stmt({
    statement_kind: 'quarterly', fiscal_year: 2024, fiscal_quarter: 1, period_end_date: '2024-03-31',
  })
  const q1_25 = stmt({
    statement_kind: 'quarterly', fiscal_year: 2025, fiscal_quarter: 1, period_end_date: '2025-03-31',
  })
  const all = [fy2024, fy2025, q1_24, q1_25]

  it('annual compares to previous fiscal year annual', () => {
    expect(findLikeForLikeBase(fy2025, all)?.id).toBe(fy2024.id)
  })

  it('quarter compares to same quarter of previous year, not to annual', () => {
    expect(findLikeForLikeBase(q1_25, all)?.id).toBe(q1_24.id)
  })

  it('base may be off-screen: displayed columns still find it in the full list', () => {
    const cols = incomeStatementColumns([fy2025, q1_25], all)
    const annualCol = cols.find((c) => c.statement.id === fy2025.id)
    expect(annualCol?.deltaBaseLabel).toBe('2024')
    const quarterCol = cols.find((c) => c.statement.id === q1_25.id)
    expect(quarterCol?.deltaBaseLabel).toBe('2024 (1)')
  })

  it('no matching prior-year statement -> no delta column', () => {
    expect(findLikeForLikeBase(fy2024, all)).toBeNull()
    const cols = incomeStatementColumns([fy2024], all)
    expect(cols[0].deltaBaseLabel).toBeNull()
  })

  it('like-for-like requires the same report_type', () => {
    const mgmt2024 = stmt({
      fiscal_year: 2024,
      period_end_date: '2024-12-31',
      report_type: 'management',
    })
    // statutory 2025 must NOT compare to management 2024
    expect(findLikeForLikeBase(fy2025, [mgmt2024, fy2025])).toBeNull()
    const mgmt2025 = stmt({
      fiscal_year: 2025,
      period_end_date: '2025-12-31',
      report_type: 'management',
    })
    expect(findLikeForLikeBase(mgmt2025, [mgmt2024, fy2024])?.id).toBe(mgmt2024.id)
  })
})

describe('verticalShare', () => {
  it('computes share and handles zero base', () => {
    expect(verticalShare(250, 1000)).toBeCloseTo(0.25)
    expect(verticalShare(250, 0)).toBeNull()
    expect(verticalShare(null, 1000)).toBeNull()
  })
})

describe('hasMixedCurrencyOrUnit', () => {
  it('detects mixed currency and mixed unit', () => {
    const a = stmt({ currency_code: 'UZS', unit: 'thousands' })
    const b = stmt({ currency_code: 'USD', unit: 'thousands' })
    const c = stmt({ currency_code: 'UZS', unit: 'millions' })
    expect(hasMixedCurrencyOrUnit([a, b])).toBe(true)
    expect(hasMixedCurrencyOrUnit([a, c])).toBe(true)
    expect(hasMixedCurrencyOrUnit([a, stmt({ currency_code: 'UZS', unit: 'thousands' })])).toBe(false)
    expect(hasMixedCurrencyOrUnit([a])).toBe(false)
  })
})

describe('balance sheet validation', () => {
  it('warns when total_assets != sides sum, within tolerance of 1', () => {
    const bs = {
      ...emptyBalanceSheet(),
      total_non_current_assets: 500,
      total_current_assets: 300,
      total_assets: 803, // off by 3
    }
    const warnings = validateBalanceSheet(bs)
    expect(warnings.some((w) => w.totalKey === 'total_assets')).toBe(true)

    const ok = validateBalanceSheet({ ...bs, total_assets: 800.5 }) // within 1
    expect(ok.some((w) => w.totalKey === 'total_assets')).toBe(false)
  })

  it('warns on balance equation mismatch', () => {
    const bs = { ...emptyBalanceSheet(), total_assets: 1000, total_equity_and_liabilities: 900 }
    expect(validateBalanceSheet(bs).some((w) => w.totalKey === 'balance_equation')).toBe(true)
  })

  it('silent when totals or all components are null', () => {
    expect(validateBalanceSheet(emptyBalanceSheet())).toEqual([])
  })
})

describe('income statement validation', () => {
  it('gross profit = revenue - cost of sales (cost entered positive)', () => {
    const is = { ...emptyIncomeStatement(), revenue: 1000, cost_of_sales: 600, gross_profit: 300 }
    const warnings = validateIncomeStatement(is)
    const warning = warnings.find((w) => w.totalKey === 'gross_profit')
    expect(warning).toBeDefined()
    expect(warning?.expected).toBe(400)
  })

  it('net profit check', () => {
    const is = {
      ...emptyIncomeStatement(),
      profit_before_tax: 500, income_tax: 100, net_profit: 400,
    }
    expect(validateIncomeStatement(is)).toEqual([])
  })
})
