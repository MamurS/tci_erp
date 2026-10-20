import { describe, expect, it } from 'vitest'

import type { IncomeStatementValues, StatementBundle } from '../types'
import { emptyBalanceSheet, emptyIncomeStatement } from '../types'
import { COMMENTARY_METRICS, buildCommentary, describeMove, strengthOf } from './commentary'
import COMMENTARY_EN from '../../../i18n/locales/en.json'

let seq = 0
function stmt(year: number, is: Partial<IncomeStatementValues>, currency = 'UZS'): StatementBundle {
  seq += 1
  return {
    id: `c${seq}`,
    entity_id: 'e1',
    statement_kind: 'annual',
    fiscal_year: year,
    fiscal_quarter: null,
    period_end_date: `${year}-12-31`,
    currency_code: currency,
    unit: 'units',
    audited: false,
    source: null,
    accounting_basis: 'ifrs',
    template_id: null,
    mapping_status: 'n/a',
    report_type: 'statutory',
    created_at: '',
    updated_at: '',
    balance_sheets: emptyBalanceSheet(),
    income_statements: { ...emptyIncomeStatement(), ...is },
  }
}

describe('describeMove', () => {
  it('grades the strength of a move like the reference report', () => {
    expect(strengthOf(0.0096)).toBe('slight')
    expect(strengthOf(-0.1586)).toBe('moderate')
    expect(strengthOf(0.4698)).toBe('strong')
    expect(strengthOf(1.173)).toBe('sharp')
  })

  it('reads a shrinking loss as a narrowing, not as growth', () => {
    expect(describeMove(-49.55, -41.69)).toMatchObject({ kind: 'change', move: 'lossNarrowed' })
    expect(describeMove(-10, -12)).toMatchObject({ kind: 'change', move: 'lossWidened' })
    // A negative cash conversion cycle is not a loss.
    expect(describeMove(-87.68, -47.64, false)).toMatchObject({ kind: 'change', move: 'up' })
  })

  it('has no percentage across a sign change or from a single period', () => {
    expect(describeMove(-5, 3)).toEqual({ kind: 'changeNm' })
    expect(describeMove(null, 3)).toEqual({ kind: 'level' })
    expect(describeMove(3, 3)).toEqual({ kind: 'flat' })
  })
})

describe('buildCommentary', () => {
  const company = [
    stmt(2021, { revenue: 177.82, net_profit: -49.17 }),
    stmt(2022, { revenue: 261.37, net_profit: -48.7 }),
  ]
  const group = [stmt(2021, { revenue: 192 }), stmt(2022, { revenue: 289 })]

  it('pairs a company sentence with a group sentence per metric', () => {
    const pnl = buildCommentary('pnl', { company, group })
    const revenue = pnl.find((p) => p.metric === 'revenue')!
    expect(revenue.sentences.map((s) => s.subject)).toEqual(['company', 'group'])
    expect(revenue.sentences[0].commentary).toMatchObject({
      kind: 'change',
      move: 'up',
      strength: 'strong',
    })
    const net = pnl.find((p) => p.metric === 'netProfit')!
    expect(net.sentences).toHaveLength(1)
    expect(net.sentences[0].commentary).toMatchObject({ move: 'lossNarrowed', strength: 'slight' })
  })

  it('omits metrics with no value and never compares across currencies', () => {
    const pnl = buildCommentary('pnl', {
      company: [stmt(2021, { revenue: 1 }, 'USD'), stmt(2022, { revenue: 2 })],
    })
    expect(pnl.map((p) => p.metric)).toEqual(['revenue'])
    expect(pnl[0].sentences[0]).toMatchObject({ from: null, commentary: { kind: 'level' } })
  })

  it('shows the display amounts but reads the move from the original', () => {
    const shown = [stmt(2021, { revenue: 1000 }), stmt(2022, { revenue: 1000 })]
    const [revenue] = buildCommentary('pnl', { company, companyDisplay: shown })
    expect(revenue.sentences[0].to).toBe(1000)
    expect(revenue.sentences[0].commentary.kind).toBe('change')
  })

  it('has a subject for every metric in the en locale', () => {
    const subjects = (
      COMMENTARY_EN as { report: { commentary: { subjects: Record<string, unknown> } } }
    ).report.commentary.subjects
    for (const defs of Object.values(COMMENTARY_METRICS)) {
      for (const def of defs) expect(subjects[def.metric], def.metric).toBeDefined()
    }
  })
})
