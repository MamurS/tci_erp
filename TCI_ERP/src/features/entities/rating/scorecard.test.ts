import { describe, expect, it } from 'vitest'

import M79 from '../../../../supabase/migrations/0079_rating_scorecard.sql?raw'
import { GRADE_CODES } from '../../../lib/gradeCatalogue'
import type { GradeBand } from '../../../lib/gradeScale'
import {
  DEFAULT_WEIGHTS,
  engineSuggestions,
  initialPillars,
  OVERALL_REASONS,
  overallReasonsFor,
  PILLAR_REASONS,
  PILLARS,
  rebalance,
  scorecardPayload,
  scorecardProblems,
  weightedGrade,
} from './scorecard'
import type { PillarInput } from './scorecard'

const card = (grades: (string | null)[], weights: number[], reason = 'in_line_with_peers'): PillarInput[] =>
  PILLARS.map((pillar, i) => ({
    pillar,
    grade: grades[i],
    weight: weights[i],
    reason: pillar === 'payment' ? 'no_negative_experience' : reason,
    comment: '',
  }))

describe('the scorecard mirrors 0079', () => {
  const body = (name: string) => {
    const at = M79.indexOf(`create or replace function tci.${name}(`)
    return M79.slice(at, M79.indexOf('$$;', at))
  }

  it('lists the same reasons, in the same order', () => {
    const rows = [...body('rating_scorecard_reasons').matchAll(/\('(\w+)',\s*'(\w+)',\s*'(\w+)'\)/g)].map((m) => [
      m[1],
      m[2],
      m[3],
    ])
    const mirror = [
      ...PILLARS.flatMap((p) => PILLAR_REASONS[p].map((r) => [p, r.code, r.polarity])),
      ...OVERALL_REASONS.map((r) => ['overall', r.code, r.polarity]),
    ]
    expect(rows).toEqual(mirror)
  })

  it('has the same pillars, scale, default weights and rounding', () => {
    expect(body('rating_scorecard_pillars')).toContain(`array[${PILLARS.map((p) => `'${p}'`).join(', ')}]`)
    expect(body('rating_scale_codes')).toContain(`array[${GRADE_CODES.map((g) => `'${g}'`).join(', ')}]`)
    expect(M79).toContain(
      `default '{"general": ${DEFAULT_WEIGHTS.general}, "balance_sheet": ${DEFAULT_WEIGHTS.balance_sheet}, "profit_loss": ${DEFAULT_WEIGHTS.profit_loss}, "payment": ${DEFAULT_WEIGHTS.payment}}'::jsonb`,
    )
    expect(M79).toContain('v_pos_w    := least(greatest(floor(v_value + 0.5)::integer, 1), cardinality(v_codes));')
    expect(M79).toContain("if (v_pos_f = v_pos_w) <> (v_polarity = 'consistent')")
  })
})

describe('weightedGrade', () => {
  it('is the weighted mean position, a half to the worse grade', () => {
    expect(weightedGrade(card(['B1', 'B2', 'B1', 'C1'], [25, 30, 25, 20]))).toEqual({ value: 3.7, grade: 'B2' })
    expect(weightedGrade(card(['B1', 'B2', null, null], [50, 50, 0, 0]))).toEqual({ value: 3.5, grade: 'B2' })
    expect(weightedGrade(card(['A1', 'A1', 'A1', 'A2'], [25, 25, 25, 25]))?.grade).toBe('A1')
  })
  it('waits for 100 % over something graded', () => {
    expect(weightedGrade(card([null, null, null, null], [0, 0, 0, 0]))).toBeNull()
    expect(weightedGrade(card(['B1', 'B1', 'B1', 'B1'], [25, 25, 25, 15]))).toBeNull()
  })
})

describe('rebalance', () => {
  it('spreads the defaults over the graded pillars, summing to 100', () => {
    expect(rebalance(DEFAULT_WEIGHTS, [...PILLARS])).toEqual(DEFAULT_WEIGHTS)
    const two = rebalance(DEFAULT_WEIGHTS, ['general', 'payment'])
    expect(two).toEqual({ general: 56, balance_sheet: 0, profit_loss: 0, payment: 44 })
    const three = rebalance(DEFAULT_WEIGHTS, ['general', 'balance_sheet', 'profit_loss'])
    expect(three.general + three.balance_sheet + three.profit_loss).toBe(100)
    expect(rebalance(DEFAULT_WEIGHTS, [])).toEqual({ general: 0, balance_sheet: 0, profit_loss: 0, payment: 0 })
  })
})

describe('the overall reason', () => {
  it('says consistent exactly at the weighted grade, up or down otherwise', () => {
    expect(overallReasonsFor('B2', 'B2').map((r) => r.code)).toEqual(['consistent_with_subgrades'])
    expect(overallReasonsFor('B1', 'B2').map((r) => r.code)).toEqual([
      'group_support',
      'positive_recent_developments',
      'analyst_judgement',
    ])
    expect(overallReasonsFor('C1', 'B2').every((r) => r.polarity === 'down' || r.polarity === 'either')).toBe(true)
  })
})

describe('scorecardProblems', () => {
  const ok = card(['B1', 'B2', 'B1', 'C1'], [25, 30, 25, 20])
  it('passes a complete scorecard', () => {
    expect(scorecardProblems(ok, 'B2', 'consistent_with_subgrades')).toEqual([])
  })
  it('names what is missing', () => {
    expect(scorecardProblems(card([null, null, null, null], [0, 0, 0, 0]), 'B2', 'x')).toEqual(['nothingGraded'])
    expect(scorecardProblems(card(['B1', 'B2', 'B1', 'C1'], [25, 30, 25, 10]), 'B2', 'consistent_with_subgrades')).toContain(
      'weights',
    )
    expect(scorecardProblems(card(['B1', 'B2', 'B1', 'C1'], [25, 30, 25, 20], 'prompt_payment'), 'B2', 'consistent_with_subgrades')).toContain(
      'pillarReason',
    )
    expect(scorecardProblems(ok, 'B1', 'consistent_with_subgrades')).toEqual(['overallReason'])
    expect(scorecardProblems(ok, '', 'consistent_with_subgrades')).toEqual(['finalGrade'])
  })
  it('sends a not-assessed pillar with no weight and no reason', () => {
    const payload = scorecardPayload(card(['B1', 'B1', null, null], [50, 50, 0, 0]), 'B1', 'consistent_with_subgrades')
    expect(payload.pillars[2]).toEqual({ pillar: 'profit_loss', grade: null, weight: 0, reason: null, comment: null })
  })
})

describe('engine suggestions', () => {
  const bands: GradeBand[] = [
    { code: 'A1', label_key: '', lower: 0, upper: 10, risk_coefficient: 1.5 },
    { code: 'A2', label_key: '', lower: 10, upper: 25, risk_coefficient: 1.2 },
    { code: 'B1', label_key: '', lower: 25, upper: 40, risk_coefficient: 1 },
    { code: 'B2', label_key: '', lower: 40, upper: 55, risk_coefficient: 0.7 },
    { code: 'C1', label_key: '', lower: 55, upper: 65, risk_coefficient: 0.4 },
    { code: 'C2', label_key: '', lower: 65, upper: 75, risk_coefficient: 0.15 },
    { code: 'D', label_key: '', lower: 75, upper: 100, risk_coefficient: 0 },
  ]
  const factor = (name: string, score: number | null, weight: number) => ({
    factor: name,
    value: 0,
    score,
    weight,
    status: 'scored',
    band: null,
  })
  it('reads each pillar from its factors on the served scale', () => {
    const s = engineSuggestions(
      [factor('equity_ratio', 30, 8), factor('current_ratio', 54, 3), factor('net_profitability', 69, 7), factor('age_years', null, 1)],
      bands,
    )
    expect(s).toEqual({ balance_sheet: 'B1', profit_loss: 'C2' })
    expect(engineSuggestions([factor('equity_ratio', 30, 8)], undefined)).toEqual({})
  })
  it('starts the form from them', () => {
    const p = initialPillars(DEFAULT_WEIGHTS, { balance_sheet: 'B1', profit_loss: 'C2' })
    expect(p.map((x) => [x.grade, x.weight])).toEqual([
      [null, 0],
      ['B1', 55],
      ['C2', 45],
      [null, 0],
    ])
  })
})
