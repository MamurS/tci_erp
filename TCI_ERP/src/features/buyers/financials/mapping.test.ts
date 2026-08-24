import { describe, expect, it } from 'vitest'

import { mapLocalStatement, validateLocalStatement } from './mapping'
import type { MappingRule } from './mapping'

const F1_MAPPINGS: MappingRule[] = [
  { line_code: '012', target_table: 'balance_sheet', target_column: 'property_plant_equipment', sign: 1 },
  { line_code: '080', target_table: 'balance_sheet', target_column: 'property_plant_equipment', sign: 1 },
  { line_code: '090', target_table: 'balance_sheet', target_column: 'property_plant_equipment', sign: 1 },
  { line_code: '022', target_table: 'balance_sheet', target_column: 'intangible_assets', sign: 1 },
  { line_code: '140', target_table: 'balance_sheet', target_column: 'inventories', sign: 1 },
  { line_code: '230', target_table: 'balance_sheet', target_column: 'trade_receivables', sign: 1 },
  { line_code: '310', target_table: 'balance_sheet', target_column: 'other_receivables', sign: 1 },
  { line_code: '320', target_table: 'balance_sheet', target_column: 'cash_and_equivalents', sign: 1 },
  { line_code: '410', target_table: 'balance_sheet', target_column: 'share_capital', sign: 1 },
  { line_code: '420', target_table: 'balance_sheet', target_column: 'share_capital', sign: 1 },
  { line_code: '440', target_table: 'balance_sheet', target_column: 'other_reserves', sign: -1 },
  { line_code: '450', target_table: 'balance_sheet', target_column: 'retained_earnings', sign: 1 },
  { line_code: '510', target_table: 'balance_sheet', target_column: 'long_term_borrowings', sign: 1 },
  { line_code: '730', target_table: 'balance_sheet', target_column: 'short_term_borrowings', sign: 1 },
  { line_code: '610', target_table: 'balance_sheet', target_column: 'trade_payables', sign: 1 },
]

const F2_MAPPINGS: MappingRule[] = [
  { line_code: '010', target_table: 'income_statement', target_column: 'revenue', sign: 1 },
  { line_code: '020', target_table: 'income_statement', target_column: 'cost_of_sales', sign: 1 },
  { line_code: '050', target_table: 'income_statement', target_column: 'distribution_expenses', sign: 1 },
  { line_code: '060', target_table: 'income_statement', target_column: 'administrative_expenses', sign: 1 },
  { line_code: '090', target_table: 'income_statement', target_column: 'other_operating_income', sign: 1 },
  { line_code: '110', target_table: 'income_statement', target_column: 'finance_income', sign: 1 },
  { line_code: '170', target_table: 'income_statement', target_column: 'finance_costs', sign: 1 },
  { line_code: '250', target_table: 'income_statement', target_column: 'income_tax', sign: 1 },
  { line_code: '260', target_table: 'income_statement', target_column: 'income_tax', sign: 1 },
]

describe('mapLocalStatement - balance sheet', () => {
  it('aggregates several local lines into one IFRS column', () => {
    const { balanceSheet } = mapLocalStatement(
      'UZ_NAS_F1',
      { '012': 500, '080': 30, '090': 70 },
      F1_MAPPINGS,
    )
    expect(balanceSheet.property_plant_equipment).toBe(600)
  })

  it('applies sign -1 (treasury shares reduce reserves)', () => {
    const { balanceSheet } = mapLocalStatement(
      'UZ_NAS_F1',
      { '440': 50 },
      F1_MAPPINGS,
    )
    expect(balanceSheet.other_reserves).toBe(-50)
  })

  it('unmapped lines contribute nothing', () => {
    const { balanceSheet } = mapLocalStatement(
      'UZ_NAS_F1',
      { '011': 999, '150': 999, '400': 999 },
      F1_MAPPINGS,
    )
    expect(balanceSheet.property_plant_equipment).toBeNull()
    expect(balanceSheet.inventories).toBeNull()
  })

  it('computes IFRS subtotals from mapped components, not local totals', () => {
    const { balanceSheet } = mapLocalStatement(
      'UZ_NAS_F1',
      {
        '012': 500, '022': 100,        // non-current
        '140': 200, '320': 50,         // current
        '400': 123456,                 // local total is ignored for computation
      },
      F1_MAPPINGS,
    )
    expect(balanceSheet.total_non_current_assets).toBe(600)
    expect(balanceSheet.total_current_assets).toBe(250)
    expect(balanceSheet.total_assets).toBe(850)
  })

  it('cross-checks computed totals vs local subtotal lines', () => {
    const { warnings } = mapLocalStatement(
      'UZ_NAS_F1',
      { '012': 500, '140': 200, '390': 210, '400': 700 },
      F1_MAPPINGS,
    )
    // computed tca=200 vs local 390=210 -> warning; computed ta=700 = local 400 -> ok
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      lineCode: '390',
      ifrsColumn: 'total_current_assets',
      localValue: 210,
      computedValue: 200,
    })
  })

  it('tolerance of 1 unit suppresses rounding noise', () => {
    const { warnings } = mapLocalStatement(
      'UZ_NAS_F1',
      { '140': 200, '390': 200.9 },
      F1_MAPPINGS,
    )
    expect(warnings).toHaveLength(0)
  })

  it('no cross-check when local subtotal is absent', () => {
    const { warnings } = mapLocalStatement('UZ_NAS_F1', { '140': 200 }, F1_MAPPINGS)
    expect(warnings).toHaveLength(0)
  })
})

describe('mapLocalStatement - income statement', () => {
  const values = {
    '010': 1000, '020': 700, '050': 60, '060': 40, '090': 10,
    '110': 5, '170': 25, '250': 30, '260': 6,
  }

  it('maps lines and aggregates both profit taxes into income_tax', () => {
    const { incomeStatement } = mapLocalStatement('UZ_NAS_F2', values, F2_MAPPINGS)
    expect(incomeStatement.revenue).toBe(1000)
    expect(incomeStatement.income_tax).toBe(36)
  })

  it('computes P&L subtotals with expenses stored positive', () => {
    const { incomeStatement } = mapLocalStatement('UZ_NAS_F2', values, F2_MAPPINGS)
    expect(incomeStatement.gross_profit).toBe(300)
    expect(incomeStatement.operating_profit).toBe(300 - 60 - 40 + 10)
    expect(incomeStatement.profit_before_tax).toBe(210 + 5 - 25)
    expect(incomeStatement.net_profit).toBe(190 - 36)
  })

  it('cross-checks P&L subtotal lines', () => {
    const { warnings } = mapLocalStatement(
      'UZ_NAS_F2',
      { ...values, '030': 290, '270': 154 },
      F2_MAPPINGS,
    )
    // gross computed 300 vs local 290 -> warning; net computed 154 = local -> ok
    expect(warnings).toHaveLength(1)
    expect(warnings[0].ifrsColumn).toBe('gross_profit')
  })

  it('all-empty input yields all-null IFRS row and no warnings', () => {
    const { balanceSheet, incomeStatement, warnings } = mapLocalStatement(
      'UZ_NAS_F2',
      {},
      F2_MAPPINGS,
    )
    expect(Object.values(balanceSheet).every((v) => v === null)).toBe(true)
    expect(Object.values(incomeStatement).every((v) => v === null)).toBe(true)
    expect(warnings).toHaveLength(0)
  })
})

describe('validateLocalStatement (local form subtotal checks)', () => {
  it('net book value formula: 012 = 010 - 011', () => {
    const warnings = validateLocalStatement('UZ_NAS_F1', { '010': 900, '011': 300, '012': 550 })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ lineCode: '012', entered: 550, expected: 600 })
  })

  it('equity total subtracts treasury shares: 480 = 410+...+470 - 440', () => {
    const values = { '410': 100, '440': 20, '450': 50, '480': 130 }
    expect(validateLocalStatement('UZ_NAS_F1', values)).toHaveLength(0)
    expect(validateLocalStatement('UZ_NAS_F1', { ...values, '480': 150 })).toHaveLength(1)
  })

  it('F2 net profit: 270 = 240 - 250 - 260', () => {
    const ok = validateLocalStatement('UZ_NAS_F2', { '240': 200, '250': 30, '260': 6, '270': 164 })
    expect(ok).toHaveLength(0)
    const bad = validateLocalStatement('UZ_NAS_F2', { '240': 200, '250': 30, '270': 180 })
    expect(bad[0]).toMatchObject({ lineCode: '270', expected: 170 })
  })

  it('silent when subtotal or all components absent', () => {
    expect(validateLocalStatement('UZ_NAS_F1', { '010': 900 })).toHaveLength(0)
    expect(validateLocalStatement('UZ_NAS_F1', { '400': 900 })).toHaveLength(0)
  })
})
