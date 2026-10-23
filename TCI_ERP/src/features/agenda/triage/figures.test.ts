import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'

import type { BalanceSheetValues, IncomeStatementValues, StatementBundle } from '../../entities/types'
import { emptyBalanceSheet, emptyIncomeStatement } from '../../entities/types'
import { authorityState, movedChipText, negativeCfoStreak, num, otherLimitsInForce, whatMoved } from './figures'
import type { LimitLike } from './figures'

describe('authorityState', () => {
  const row = { amount_uzs: '900', rate_missing: false, my_authority_uzs: '600', decide_alone: false, own_request: false }

  it('one’s own request is a colleague’s whatever the authority (four eyes, 0063)', () => {
    expect(authorityState({ ...row, decide_alone: true, own_request: true })).toEqual({ kind: 'ownRequest' })
  })

  it('takes within / short from decide_alone and only derives the shortfall', () => {
    expect(authorityState(row)).toEqual({ kind: 'short', authorityUzs: 600, shortfallUzs: 300 })
    expect(authorityState({ ...row, decide_alone: true })).toEqual({ kind: 'within', authorityUzs: 600 })
  })

  it('says it cannot tell when the currency has no rate', () => {
    expect(authorityState({ ...row, rate_missing: true, amount_uzs: null })).toEqual({ kind: 'noRate' })
  })
})

describe('otherLimitsInForce', () => {
  const limit = (over: Partial<LimitLike>): LimitLike => ({
    policy_id: 'p1',
    insurance_request_id: null,
    outcome: 'approved',
    approved_amount: 100,
    currency_code: 'UZS',
    ...over,
  })
  const rates = (ccy: string) => (ccy === 'UZS' ? 1 : ccy === 'USD' ? 12_000 : null)

  it('sums in UZS outside the excluded scope', () => {
    const sum = otherLimitsInForce(
      [limit({ policy_id: 'p1' }), limit({ policy_id: 'p2', approved_amount: '10', currency_code: 'USD' })],
      'p1',
      rates,
    )
    expect(sum).toEqual({ count: 1, uzs: 120_000, missingRates: 0 })
  })

  it('counts a limit without a rate and never adds it as zero', () => {
    const sum = otherLimitsInForce([limit({ currency_code: 'KZT' })], null, rates)
    expect(sum).toEqual({ count: 1, uzs: null, missingRates: 1 })
  })

  it('leaves out declined, revoked and pre-bind limits (v_buyer_exposure rule)', () => {
    const sum = otherLimitsInForce(
      [
        limit({ outcome: 'declined' }),
        limit({ outcome: 'revoked' }),
        limit({ policy_id: null, insurance_request_id: 's1' }),
        limit({ outcome: 'partial', approved_amount: 5 }),
      ],
      null,
      rates,
    )
    expect(sum).toEqual({ count: 1, uzs: 5, missingRates: 0 })
  })
})

describe('num', () => {
  it('reads numerics that arrive as strings, null otherwise', () => {
    expect(num('12.5')).toBe(12.5)
    expect(num('')).toBeNull()
    expect(num(null)).toBeNull()
    expect(num('x')).toBeNull()
  })
})

let seq = 0
function stmt(
  year: number,
  is: Partial<IncomeStatementValues>,
  bs: Partial<BalanceSheetValues> = {},
  over: Partial<StatementBundle> = {},
): StatementBundle {
  seq += 1
  return {
    id: `s${seq}`,
    entity_id: 'e1',
    statement_kind: 'annual',
    fiscal_year: year,
    fiscal_quarter: null,
    period_end_date: `${year}-12-31`,
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
    balance_sheets: { ...emptyBalanceSheet(), ...bs },
    income_statements: { ...emptyIncomeStatement(), ...is },
    ...over,
  }
}

const t = ((key: string) => key) as unknown as TFunction

describe('whatMoved', () => {
  it('reuses the report commentary on the two statements, metrics in order', () => {
    const moved = whatMoved(
      stmt(2024, { revenue: 1000, net_profit: 50 }),
      stmt(2025, { revenue: 1136, net_profit: 50 }),
    )
    expect(moved.comparable).toBe(true)
    if (!moved.comparable) return
    // Net profit did not move, so only revenue is news.
    expect(moved.chips.map((c) => c.metric)).toEqual(['revenue'])
    expect(movedChipText(moved.chips[0], moved.currency, t, 'en')).toBe('report.keyFigureLabels.revenue +13.6%')
  })

  it('normalises units before comparing (thousands against units)', () => {
    const moved = whatMoved(
      stmt(2024, { revenue: 1000 }, {}, { unit: 'thousands' }),
      stmt(2025, { revenue: 1_000_000 }),
    )
    expect(moved.comparable && moved.chips).toEqual([])
  })

  it('shows both values when a loss turns into a profit', () => {
    const moved = whatMoved(stmt(2024, { net_profit: -5_000_000 }), stmt(2025, { net_profit: 3_000_000 }))
    if (!moved.comparable) throw new Error('comparable')
    expect(movedChipText(moved.chips[0], 'UZS', t, 'en')).toBe('report.keyFigureLabels.netProfit -5.0M → 3.0M UZS')
  })

  it('never compares a quarter with a year, two report types or two currencies', () => {
    const year = stmt(2024, { revenue: 1 })
    expect(whatMoved(year, stmt(2025, { revenue: 2 }, {}, { statement_kind: 'quarterly', fiscal_quarter: 1 }))).toEqual({
      comparable: false,
      reason: 'kind',
    })
    expect(whatMoved(year, stmt(2025, { revenue: 2 }, {}, { report_type: 'management' }))).toEqual({
      comparable: false,
      reason: 'reportType',
    })
    expect(whatMoved(year, stmt(2025, { revenue: 2 }, {}, { currency_code: 'USD' }))).toEqual({
      comparable: false,
      reason: 'currency',
    })
  })
})

describe('negativeCfoStreak', () => {
  // With no balance-sheet movements the derived operating cash flow follows
  // net profit, so a loss year is a negative-CFO year.
  const series = (profits: number[]) => profits.map((p, i) => stmt(2021 + i, { net_profit: p }))

  it('counts the consecutive negative years up to the latest statement', () => {
    const all = series([10, -5, -5, -5])
    expect(negativeCfoStreak(all[3]!, all)).toBe(3)
    expect(negativeCfoStreak(all[2]!, all)).toBe(2)
  })

  it('is 0 when the latest year is positive or cannot be derived', () => {
    const all = series([-5, -5, 10])
    expect(negativeCfoStreak(all[2]!, all)).toBe(0)
    // the first year has no year before it: no derived CFO
    expect(negativeCfoStreak(all[0]!, all)).toBe(0)
  })

  it('ignores statements of another kind', () => {
    const all = [...series([-5, -5]), stmt(2022, { net_profit: 50 }, {}, { statement_kind: 'quarterly', fiscal_quarter: 2 })]
    expect(negativeCfoStreak(all[1]!, all)).toBe(1)
  })
})
