import { describe, expect, it } from 'vitest'

import MODELS from '../../../../credit_engine/src/credit_engine/models.py?raw'
import RISK_CONTEXT from '../../../../credit_engine/src/credit_engine/risk_context.py?raw'
import type { RatingResponse, RiskAdjustmentLine, RiskContext } from '../../lib/analytics'
import { countryInactive, riskTrace, signedNotch } from './integrationTrace'

const fullTable: RiskContext['adjustments'] = {
  sector: { A: { notch: 1, cap_grade: null }, B: { notch: 0, cap_grade: null }, D: { notch: -2, cap_grade: null } },
  country: { '6': { notch: 0, cap_grade: 'C1' }, '2': { notch: 0, cap_grade: null }, unclassified: { notch: 0, cap_grade: null } },
}

function rating(lines: RiskAdjustmentLine[], patch: Partial<RatingResponse> = {}): Pick<
  RatingResponse,
  'grade' | 'base_grade' | 'risk_adjustments' | 'risk_context'
> {
  return {
    grade: 'C1',
    base_grade: 'B1',
    risk_adjustments: lines,
    risk_context: {
      sector_grade: 'B',
      country_category: 2,
      country_classified: true,
      country_source: 'oecd',
      adjustments: fullTable,
    },
    ...patch,
  }
}

const sectorLine = (grade: 'A' | 'B' | 'C' | 'D', notch: number, from: string, to: string): RiskAdjustmentLine => ({
  code: 'sector_adjustment',
  sector_grade: grade,
  notch,
  cap_grade: null,
  from_grade: from,
  to_grade: to,
})

const countryLine = (
  category: number | null,
  notch: number,
  from: string,
  to: string,
  extra: Partial<Extract<RiskAdjustmentLine, { code: 'country_adjustment' }>> = {},
): RiskAdjustmentLine => ({
  code: 'country_adjustment',
  country_category: category,
  country_key: category === null ? 'unclassified' : String(category),
  country_classified: category !== null,
  country_source: category === null ? null : 'oecd',
  notch,
  cap_grade: null,
  from_grade: from,
  to_grade: to,
  ...extra,
})

describe('the engine’s trace codes (credit_engine 0.2.0)', () => {
  it('are the three line codes of models.py', () => {
    expect(MODELS).toContain('code: Literal["sector_adjustment"] = "sector_adjustment"')
    expect(MODELS).toContain('code: Literal["country_adjustment"] = "country_adjustment"')
    expect(MODELS).toContain('code: Literal["grade_cap"] = "grade_cap"')
    expect(MODELS).toContain('cap_sources: list[Literal["sector", "country"]]')
    // a positive notch is a BETTER grade
    expect(RISK_CONTEXT).toContain('position -= sector_rule.notch')
  })
})

describe('riskTrace', () => {
  it('is null without adjustment lines', () => {
    expect(riskTrace({ grade: 'B1', risk_adjustments: undefined })).toBeNull()
    expect(riskTrace({ grade: 'B1', risk_adjustments: [] })).toBeNull()
    expect(riskTrace({ grade: null, risk_adjustments: [sectorLine('B', 0, 'B1', 'B1')] })).toBeNull()
  })

  it('a zero notch reads «no change»', () => {
    const trace = riskTrace(
      rating([sectorLine('B', 0, 'B1', 'B1'), countryLine(2, 0, 'B1', 'B1')], { grade: 'B1', base_grade: 'B1' }),
    )!
    expect(trace.changed).toBe(false)
    expect(trace.lines).toEqual([
      { key: 'risk.trace.sectorNoChange', params: { grade: 'B' } },
      {
        key: 'risk.trace.countryNoChange',
        params: {},
        country: { key: 'risk.trace.country.oecd', params: { category: 2 } },
      },
    ])
    expect(trace.context.sector).toEqual({ key: 'risk.trace.context.sector', params: { grade: 'B' } })
  })

  it('a sector notch reads its signed count and the move', () => {
    const trace = riskTrace(rating([sectorLine('D', -2, 'B1', 'C1'), countryLine(2, 0, 'C1', 'C1')]))!
    expect(trace.base).toBe('B1')
    expect(trace.final).toBe('C1')
    expect(trace.changed).toBe(true)
    expect(trace.lines[0]).toEqual({
      key: 'risk.trace.sectorNotch',
      params: { grade: 'D', signed: '−2', count: 2, from: 'B1', to: 'C1' },
    })
  })

  it('a country cap that bit alone is said on the country line', () => {
    const trace = riskTrace(
      rating(
        [
          sectorLine('B', 0, 'B2', 'B2'),
          countryLine(6, 0, 'B2', 'B2', { cap_grade: 'C1' }),
          { code: 'grade_cap', cap_grade: 'C1', cap_sources: ['country'], from_grade: 'B2', to_grade: 'C1' },
        ],
        { base_grade: 'B2' },
      ),
    )!
    expect(trace.lines).toHaveLength(2)
    expect(trace.lines[1]).toEqual({
      key: 'risk.trace.countryCap',
      params: { cap: 'C1', from: 'B2', to: 'C1' },
      country: { key: 'risk.trace.country.oecd', params: { category: 6 } },
    })
  })

  it('a cap after a notch, or from both rules, gets a line of its own', () => {
    const trace = riskTrace(
      rating([
        sectorLine('A', 1, 'B1', 'A2'),
        countryLine(6, 0, 'A2', 'A2', { cap_grade: 'C1' }),
        { code: 'grade_cap', cap_grade: 'C1', cap_sources: ['sector', 'country'], from_grade: 'A2', to_grade: 'C1' },
      ]),
    )!
    expect(trace.lines.map((l) => l.key)).toEqual(['risk.trace.sectorNotch', 'risk.trace.countryNoChange', 'risk.trace.capBoth'])
    expect(trace.lines[0]!.params.signed).toBe('+1')
  })

  it('an internal category and «not classified» are named, never as 0', () => {
    const internal = riskTrace(
      rating([countryLine(4, -1, 'B1', 'B2', { country_source: 'internal' })], {
        grade: 'B2',
        risk_context: { ...rating([]).risk_context!, sector_grade: null, country_source: 'internal', country_category: 4 },
      }),
    )!
    expect(internal.lines[0]!.country).toEqual({ key: 'risk.trace.country.internal', params: { category: 4 } })
    expect(internal.context.sector.key).toBe('risk.trace.context.noSector')

    const unclassified = riskTrace(
      rating([countryLine(null, 0, 'B1', 'B1')], {
        grade: 'B1',
        risk_context: { ...rating([]).risk_context!, country_category: null, country_classified: false, country_source: null },
      }),
    )!
    expect(unclassified.lines[0]!.country).toEqual({ key: 'risk.trace.country.unclassified', params: {} })
  })

  it('a country part not yet in force says so', () => {
    const context: RiskContext = {
      sector_grade: 'B',
      country_category: null,
      country_classified: false,
      country_source: null,
      adjustments: { sector: fullTable.sector, country: {} },
    }
    expect(countryInactive(context)).toBe(true)
    expect(countryInactive(undefined)).toBe(false)
    const trace = riskTrace(
      rating([sectorLine('B', 0, 'B1', 'B1'), countryLine(null, 0, 'B1', 'B1')], {
        grade: 'B1',
        base_grade: 'B1',
        risk_context: context,
      }),
    )!
    expect(trace.lines[1]).toEqual({ key: 'risk.trace.countryInactive', params: {} })
    expect(trace.context.country.key).toBe('risk.trace.context.countryInactive')
  })

  it('signs a notch with a true minus', () => {
    expect(signedNotch(2)).toBe('+2')
    expect(signedNotch(-1)).toBe('−1')
    expect(signedNotch(0)).toBe('0')
  })
})
