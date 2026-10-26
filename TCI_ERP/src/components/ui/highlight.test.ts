import { describe, expect, it } from 'vitest'

import { matchRanges } from './highlight'

describe('matchRanges', () => {
  it('finds every match, ignoring case', () => {
    expect(matchRanges('Navoi Textile, NAVOI branch', 'navoi')).toEqual([
      [0, 5],
      [15, 20],
    ])
  })
  it('ignores diacritics and needs two characters', () => {
    expect(matchRanges('Ankara Tekstil A.Ş.', 'a.s')).toEqual([[15, 18]])
    expect(matchRanges('Navoi', 'n')).toEqual([])
  })
})

describe('matchRanges with several terms', () => {
  it('marks every comma-separated term, merged and in order', () => {
    expect(matchRanges('Samarkand Textile MChJ', 'textile, sam')).toEqual([
      [0, 3],
      [10, 17],
    ])
    expect(matchRanges('abcdef', 'abc, bcd')).toEqual([[0, 4]])
  })
})
