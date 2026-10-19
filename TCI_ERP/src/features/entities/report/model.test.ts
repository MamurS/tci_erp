import { describe, expect, it } from 'vitest'

import type { BalanceSheetValues, IncomeStatementValues, StatementBundle } from '../types'
import { emptyBalanceSheet, emptyIncomeStatement } from '../types'
import {
  BS_REPORT_ROWS,
  PL_REPORT_ROWS,
  annualSeries,
  bsBase,
  combineGroupSeries,
  debtToEquity,
  isStale,
  keyFigures,
  memberFigures,
  normalizeBundle,
  plBase,
  ratioTables,
  relativeMove,
  statementRows,
  toneFor,
  topMembers,
} from './model'

let seq = 0
function stmt(overrides: Partial<StatementBundle>): StatementBundle {
  seq += 1
  return {
    id: `s${seq}`,
    entity_id: 'e1',
    statement_kind: 'annual',
    fiscal_year: 2024,
    fiscal_quarter: null,
    period_end_date: '2024-12-31',
    currency_code: 'UZS',
    unit: 'units',
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

describe('normalizeBundle / annualSeries', () => {
  it('scales thousands and millions to units and never turns null into 0', () => {
    const s = normalizeBundle(
      stmt({ unit: 'thousands', balance_sheets: bs({ total_assets: 1500, inventories: null }) }),
    )
    expect(s.unit).toBe('units')
    expect(s.balance_sheets?.total_assets).toBe(1_500_000)
    expect(s.balance_sheets?.inventories).toBeNull()
  })

  it('keeps one annual statement per year of the requested type, chronologically', () => {
    const series = annualSeries(
      [
        stmt({ fiscal_year: 2024, period_end_date: '2024-12-31' }),
        stmt({ fiscal_year: 2022, period_end_date: '2022-12-31' }),
        stmt({ fiscal_year: 2023, period_end_date: '2023-12-31', report_type: 'management' }),
        stmt({ fiscal_year: 2023, statement_kind: 'quarterly', fiscal_quarter: 2 }),
        stmt({ fiscal_year: 2023, period_end_date: '2023-12-31' }),
      ],
      'statutory',
    )
    expect(series.map((s) => s.fiscal_year)).toEqual([2022, 2023, 2024])
    expect(series.every((s) => s.report_type === 'statutory')).toBe(true)
  })
})

describe('combineGroupSeries', () => {
  it('sums members in the same currency after normalising units', () => {
    const { series, membersPerYear, otherCurrencyMembers } = combineGroupSeries(
      [
        stmt({ entity_id: 'a', unit: 'thousands', income_statements: is({ revenue: 100 }) }),
        stmt({ entity_id: 'b', unit: 'millions', income_statements: is({ revenue: 2 }) }),
        stmt({ entity_id: 'c', currency_code: 'USD', income_statements: is({ revenue: 9 }) }),
      ],
      'statutory',
      'UZS',
      'g1',
    )
    expect(series).toHaveLength(1)
    expect(series[0].income_statements?.revenue).toBe(2_100_000)
    expect(series[0].entity_id).toBe('g1')
    expect(membersPerYear[2024]).toBe(2)
    expect(otherCurrencyMembers).toBe(1)
  })

  it('leaves a line null when no member reported it', () => {
    const { series } = combineGroupSeries(
      [stmt({ entity_id: 'a', income_statements: is({ revenue: 5 }) })],
      'statutory',
      'UZS',
      'g1',
    )
    expect(series[0].income_statements?.net_profit).toBeNull()
  })
})

describe('statementRows', () => {
  const series = [
    stmt({
      fiscal_year: 2023,
      balance_sheets: bs({ total_assets: 200, long_term_borrowings: 50, total_equity: 80 }),
    }),
    stmt({
      fiscal_year: 2024,
      balance_sheets: bs({ total_assets: 250, long_term_borrowings: 40, total_equity: 100 }),
    }),
  ]
  const rows = statementRows(series, BS_REPORT_ROWS, bsBase)

  it('drops rows empty in every year', () => {
    expect(rows.map((r) => r.def.labelKey)).toEqual(['equity', 'ltLoans', 'totalAssets'])
  })

  it('computes the share of the base and a direction-aware tone', () => {
    const loans = rows.find((r) => r.def.labelKey === 'ltLoans')!
    expect(loans.cells[0].share).toBeCloseTo(0.25)
    expect(loans.cells[0].trend).toBeNull()
    expect(loans.cells[1].trend).toBe('down')
    expect(loans.cells[1].tone).toBe('pos') // less debt is good
    const equity = rows.find((r) => r.def.labelKey === 'equity')!
    expect(equity.cells[1].tone).toBe('pos')
  })

  it('reports P&L shares against revenue', () => {
    const pl = statementRows(
      [stmt({ income_statements: is({ revenue: 1000, cost_of_sales: 600, net_profit: 50 }) })],
      PL_REPORT_ROWS,
      plBase,
    )
    expect(pl.find((r) => r.def.labelKey === 'costOfSales')!.cells[0].share).toBeCloseTo(0.6)
  })
})

describe('relativeMove', () => {
  it('measures against the magnitude so a shrinking loss is an improvement', () => {
    expect(relativeMove(-48.7, -49.17)).toBeCloseTo(0.00956, 4)
  })
  it('is not meaningful on a sign flip, a zero base or a huge move', () => {
    expect(relativeMove(10, -5)).toBeNull()
    expect(relativeMove(10, 0)).toBeNull()
    expect(relativeMove(1200, 1)).toBeNull()
    expect(relativeMove(null, 1)).toBeNull()
  })
})

describe('keyFigures', () => {
  it('uses % for amounts, pp for the equity ratio and x for leverage', () => {
    const figures = keyFigures([
      stmt({
        fiscal_year: 2023,
        balance_sheets: bs({ total_assets: 100, total_equity: 40, short_term_borrowings: 20 }),
        income_statements: is({ revenue: 100, net_profit: 10 }),
      }),
      stmt({
        fiscal_year: 2024,
        balance_sheets: bs({ total_assets: 100, total_equity: 50, short_term_borrowings: 25 }),
        income_statements: is({ revenue: 120, net_profit: 8 }),
      }),
    ])
    const by = Object.fromEntries(figures.map((f) => [f.key, f]))
    expect(by.revenue.change).toEqual({ kind: 'pct', value: expect.closeTo(0.2, 6) })
    expect(by.revenue.tone).toBe('pos')
    expect(by.netProfit.tone).toBe('neg')
    expect(by.equityRatio.change).toEqual({ kind: 'pp', value: expect.closeTo(0.1, 6) })
    expect(by.debtToEquity.value).toBeCloseTo(0.5)
    expect(by.debtToEquity.change?.kind).toBe('x')
    expect(by.debtToEquity.previousYear).toBe(2023)
  })

  it('has no change with a single year', () => {
    const [revenue] = keyFigures([stmt({ income_statements: is({ revenue: 1 }) })])
    expect(revenue.change).toBeNull()
    expect(revenue.trend).toBeNull()
  })
})

describe('debtToEquity', () => {
  it('is null without equity and without any borrowings', () => {
    expect(debtToEquity(stmt({ balance_sheets: bs({ short_term_borrowings: 5 }) }))).toBeNull()
    expect(debtToEquity(stmt({ balance_sheets: bs({ total_equity: 5 }) }))).toBeNull()
  })
})

describe('ratioTables', () => {
  it('builds profitability, liquidity and turnover with direction-aware tones', () => {
    const series = [
      stmt({
        fiscal_year: 2023,
        balance_sheets: bs({ total_current_assets: 100, total_current_liabilities: 60 }),
        income_statements: is({
          revenue: 100,
          gross_profit: 30,
          operating_profit: 10,
          net_profit: 5,
        }),
      }),
      stmt({
        fiscal_year: 2024,
        balance_sheets: bs({ total_current_assets: 120, total_current_liabilities: 100 }),
        income_statements: is({
          revenue: 100,
          gross_profit: 40,
          operating_profit: 10,
          net_profit: 5,
        }),
      }),
    ]
    const tables = ratioTables(series, series)
    expect(tables.map((t) => t.key)).toEqual(['profitability', 'liquidity', 'turnover'])
    const gross = tables[0].rows.find((r) => r.key === 'grossMargin')!
    expect(gross.tones[1]).toBe('pos')
    const nwc = tables[1].rows.find((r) => r.key === 'nwc')!
    expect(nwc.values).toEqual([40, 20])
    expect(nwc.changes[1]).toBeCloseTo(-0.5)
    expect(nwc.tones[1]).toBe('neg')
  })
})

describe('toneFor', () => {
  it('reads a rise in days payable as good and in days sales as bad', () => {
    expect(toneFor('up', 'up_good')).toBe('pos')
    expect(toneFor('up', 'up_bad')).toBe('neg')
    expect(toneFor(null, 'up_bad')).toBeNull()
  })
})

describe('group members', () => {
  const members = [
    { id: 'a', name: 'A', registration_number: '1', industry: null },
    { id: 'b', name: 'B', registration_number: '2', industry: 'Retail' },
    { id: 'c', name: 'C', registration_number: '3', industry: null },
  ]
  const statements = [
    stmt({ entity_id: 'a', income_statements: is({ revenue: 300 }) }),
    stmt({ entity_id: 'b', unit: 'thousands', income_statements: is({ revenue: 1 }) }),
  ]
  const figures = memberFigures(members, statements, 'statutory', 'UZS')

  it('skips members with no statement and normalises units', () => {
    expect(figures.map((m) => m.id)).toEqual(['a', 'b'])
    expect(figures[1].revenue).toBe(1000)
  })

  it('ranks by the metric with the share of the group total', () => {
    const top = topMembers(figures, 'revenue')
    expect(top.map((m) => m.member.id)).toEqual(['b', 'a'])
    expect(top[0].share).toBeCloseTo(1000 / 1300)
  })

  it('can leave the subject out of the ranking but not out of the total', () => {
    const top = topMembers(figures, 'revenue', 5, 'b')
    expect(top.map((m) => m.member.id)).toEqual(['a'])
    expect(top[0].share).toBeCloseTo(300 / 1300)
  })
})

describe('isStale', () => {
  it('flags statements more than twelve months old', () => {
    expect(isStale('2024-12-31', '2026-10-19')).toBe(true)
    expect(isStale('2025-12-31', '2026-10-19')).toBe(false)
    expect(isStale(null, '2026-10-19')).toBe(false)
  })
})
