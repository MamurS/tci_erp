import { describe, expect, it } from 'vitest'

import type { StatementBundle } from '../types'
import { emptyBalanceSheet, emptyIncomeStatement } from '../types'
import type { BalanceSheetValues, IncomeStatementValues } from '../types'
import {
  buildCashFlowColumns,
  computeCashFlowColumn,
  hasPersistentNegativeCfo,
} from './cashflow'

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

describe('computeCashFlowColumn (indirect method)', () => {
  const prev = stmt({
    fiscal_year: 2024,
    period_end_date: '2024-12-31',
    balance_sheets: bs({
      trade_receivables: 100,
      inventories: 200,
      trade_payables: 80,
      property_plant_equipment: 500,
      long_term_borrowings: 150,
      share_capital: 50,
      cash_and_equivalents: 40,
    }),
  })
  const cur = stmt({
    fiscal_year: 2025,
    period_end_date: '2025-12-31',
    balance_sheets: bs({
      trade_receivables: 130, // +30 -> operating -30
      inventories: 180, // -20 -> operating +20
      trade_payables: 100, // +20 -> operating +20
      property_plant_equipment: 540, // +40, D&A 25 -> investing -(40+25) = -65
      long_term_borrowings: 170, // +20 -> financing +20
      share_capital: 50, // 0
      cash_and_equivalents: 85, // Δcash = +45
    }),
    income_statements: is({ net_profit: 60, depreciation_amortization: 25 }),
  })

  it('classifies deltas into operating / investing / financing', () => {
    const col = computeCashFlowColumn(cur, prev)
    // CFO = 60 + 25 - 30 + 20 + 20 = 95
    expect(col.cfo).toBe(95)
    expect(col.cfi).toBe(-65)
    expect(col.cff).toBe(20)
    expect(col.netChange).toBe(50)
  })

  it('reconciles net change vs delta cash and reports the diff', () => {
    const col = computeCashFlowColumn(cur, prev)
    expect(col.deltaCash).toBe(45)
    expect(col.reconciliationDiff).toBe(5)
    expect(col.reconciled).toBe(false)
  })

  it('reconciliation OK within tolerance of 1', () => {
    const adjusted = stmt({
      ...cur,
      balance_sheets: bs({ ...cur.balance_sheets, cash_and_equivalents: 89.5 }),
    })
    const col = computeCashFlowColumn(adjusted, prev)
    expect(col.reconciled).toBe(true)
  })

  it('both-null lines contribute zero; unknown cash -> reconciliation null', () => {
    const emptyPrev = stmt({ fiscal_year: 2024, period_end_date: '2024-12-31' })
    const emptyCur = stmt({ fiscal_year: 2025, period_end_date: '2025-12-31' })
    const col = computeCashFlowColumn(emptyCur, emptyPrev)
    expect(col.cfo).toBe(0)
    expect(col.reconciled).toBeNull()
  })

  it('lines without underlying data are flagged (rendered as em dash, never 0)', () => {
    const col = computeCashFlowColumn(cur, prev)
    const lineByKey = (key: string) =>
      [...col.operating, ...col.investing, ...col.financing].find((l) => l.key === key)
    // inventories present in both periods -> data
    expect(lineByKey('delta_inventories')?.hasData).toBe(true)
    // investment property absent in both periods -> no data
    expect(lineByKey('investment_property')?.hasData).toBe(false)
    // net profit present via income statement
    expect(lineByKey('net_profit')?.hasData).toBe(true)
  })
})

describe('buildCashFlowColumns pairing', () => {
  it('pairs with the chronologically previous statement of same kind and type', () => {
    const a2023 = stmt({ fiscal_year: 2023, period_end_date: '2023-12-31' })
    const q1 = stmt({
      statement_kind: 'quarterly', fiscal_year: 2024, fiscal_quarter: 1, period_end_date: '2024-03-31',
    })
    const a2024 = stmt({ fiscal_year: 2024, period_end_date: '2024-12-31' })
    const all = [a2023, q1, a2024]

    const cols = buildCashFlowColumns([a2024], all)
    expect(cols).toHaveLength(1)
    // annual 2024 pairs with annual 2023, skipping the quarterly in between
    expect(cols[0].previous.id).toBe(a2023.id)
  })

  it('management statements never pair with statutory', () => {
    const st2023 = stmt({ fiscal_year: 2023, period_end_date: '2023-12-31' })
    const mgmt2024 = stmt({
      fiscal_year: 2024, period_end_date: '2024-12-31', report_type: 'management',
    })
    expect(buildCashFlowColumns([mgmt2024], [st2023, mgmt2024])).toHaveLength(0)
  })

  it('earliest statement produces no column', () => {
    const a2023 = stmt({ fiscal_year: 2023, period_end_date: '2023-12-31' })
    expect(buildCashFlowColumns([a2023], [a2023])).toHaveLength(0)
  })
})

describe('hasPersistentNegativeCfo', () => {
  const colWithCfo = (cfo: number) =>
    ({ cfo }) as ReturnType<typeof computeCashFlowColumn>

  it('true only for 2+ consecutive negative CFO columns', () => {
    expect(hasPersistentNegativeCfo([colWithCfo(-1), colWithCfo(-2)])).toBe(true)
    expect(hasPersistentNegativeCfo([colWithCfo(-1), colWithCfo(5), colWithCfo(-2)])).toBe(false)
    expect(hasPersistentNegativeCfo([colWithCfo(5)])).toBe(false)
    expect(hasPersistentNegativeCfo([])).toBe(false)
  })
})
