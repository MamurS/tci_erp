import { describe, expect, it } from 'vitest'

import { hiddenColumnsCss, parseDensity, parseHidden } from './tablePrefs'

describe('table preferences', () => {
  it('reads a density, falling back to the surface default', () => {
    expect(parseDensity('compact', 'regular')).toBe('compact')
    expect(parseDensity('huge', 'relaxed')).toBe('relaxed')
    expect(parseDensity(null, 'regular')).toBe('regular')
  })
  it('reads hidden columns defensively', () => {
    expect(parseHidden('[2,0,2]')).toEqual([2, 0, 2])
    expect(parseHidden('[-1,"x",1.5,3]')).toEqual([3])
    expect(parseHidden('not json')).toEqual([])
    expect(parseHidden(null)).toEqual([])
  })
  it('hides the cells and the col of each hidden column, scoped to the table', () => {
    expect(hiddenColumnsCss('limits', [1])).toBe(
      '[data-table="limits"] tr > :nth-child(2), [data-table="limits"] col:nth-child(2) { display: none; }',
    )
    expect(hiddenColumnsCss('limits', [])).toBe('')
  })
})
