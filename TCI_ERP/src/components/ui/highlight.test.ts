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
