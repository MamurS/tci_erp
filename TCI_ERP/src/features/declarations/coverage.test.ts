import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0026_declarations.sql?raw'
import { classifyLine, isUncovered, sumSplits } from './coverage'

describe('the DL / uncovered-excess rule', () => {
  it('covers the whole turnover when the buyer holds a limit, however large', () => {
    // A credit limit caps the BALANCE, not the flow of sales through a period.
    expect(classifyLine(true, 1_000_000, 100)).toEqual({
      basis: 'limit',
      covered: 1_000_000,
      uncovered: 0,
    })
  })

  it('covers turnover inside the discretionary limit', () => {
    expect(classifyLine(false, 80, 100)).toEqual({
      basis: 'discretionary',
      covered: 80,
      uncovered: 0,
    })
  })

  it('stops cover at the DL and reports the excess separately', () => {
    expect(classifyLine(false, 250, 100)).toEqual({
      basis: 'uncovered_excess',
      covered: 100,
      uncovered: 150,
    })
  })

  it('treats turnover exactly at the DL as covered', () => {
    expect(classifyLine(false, 100, 100).basis).toBe('discretionary')
    expect(classifyLine(false, 100, 100).uncovered).toBe(0)
  })

  it('treats a missing DL as zero, not as unlimited', () => {
    expect(classifyLine(false, 50, null)).toEqual({
      basis: 'uncovered_excess',
      covered: 0,
      uncovered: 50,
    })
  })

  it('never folds the excess into the covered figure', () => {
    const split = classifyLine(false, 250, 100)
    expect(split.covered + split.uncovered).toBe(250)
    expect(split.covered).toBeLessThan(250)
  })

  it('sums a set of lines', () => {
    expect(
      sumSplits([
        { covered_amount: 900, uncovered_excess: 0 },
        { covered_amount: 100, uncovered_excess: 150 },
      ]),
    ).toEqual({ covered: 1000, uncovered: 150 })
  })

  it('flags only the uncovered basis', () => {
    expect(isUncovered('uncovered_excess')).toBe(true)
    expect(isUncovered('discretionary')).toBe(false)
    expect(isUncovered('limit')).toBe(false)
  })
})

describe('contract with migration 0026', () => {
  it('the SQL classifier still has the branch order this module mirrors', () => {
    expect(MIGRATION).toContain("when p_has_limit then 'limit'::tci.coverage_basis")
    expect(MIGRATION).toContain(
      'when p_insurable_turnover <= coalesce(p_discretionary_limit, 0)',
    )
    expect(MIGRATION).toContain("else 'uncovered_excess'::tci.coverage_basis")
  })

  it('premium is still earned on covered turnover only', () => {
    // If this ever changes, uncovered excess starts being charged for.
    expect(MIGRATION).toContain('covered_amount + uncovered_excess = insurable_turnover')
  })
})
