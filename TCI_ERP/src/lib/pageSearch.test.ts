import { describe, expect, it } from 'vitest'

import { emptyingTerm, filterByTerms, normalizeSearch, parseTerms, searchRows } from './pageSearch'

interface Row {
  name: string
  policy: string
  country: string
}

const ROWS: Row[] = [
  { name: 'Delcreda MChJ', policy: 'TCI-10000', country: 'UZ' },
  { name: 'Delcreda MChJ', policy: 'TCI-100001', country: 'UZ' },
  { name: 'Delcreda GmbH', policy: 'TCI-10002', country: 'DE' },
  { name: 'Samarkand Textile MChJ', policy: 'TCI-2026-0001', country: 'UZ' },
  { name: 'Navoiy Oʻgʻit', policy: 'TCI-2026-0002', country: 'UZ' },
]
const fields = (r: Row) => [r.name, r.policy, r.country]

describe('parseTerms', () => {
  it('splits on commas, trims and drops empties', () => {
    expect(parseTerms(' Delcreda ,, TCI-10000 , ')).toEqual(['delcreda', 'tci-10000'])
    expect(parseTerms('')).toEqual([])
    expect(parseTerms(null)).toEqual([])
  })
})

describe('normalizeSearch', () => {
  it('ignores case, accents, spaces and Uzbek apostrophe variants', () => {
    expect(normalizeSearch('  Navoiy  Oʻgʻit ')).toBe("navoiy o'g'it")
    expect(normalizeSearch("Navoiy O‘g‘it")).toBe("navoiy o'g'it")
    expect(normalizeSearch('Société')).toBe('societe')
  })
})

describe('filterByTerms', () => {
  it('an exact number finds exactly that subject', () => {
    expect(searchRows(ROWS, 'TCI-10000', fields).map((r) => r.policy)).toEqual(['TCI-10000'])
  })

  it('a part of a value matches as contains', () => {
    expect(searchRows(ROWS, 'tci-1000', fields).map((r) => r.policy)).toEqual(['TCI-10000', 'TCI-100001', 'TCI-10002'])
  })

  it('an exact name selects that company, in every country it is in', () => {
    expect(searchRows(ROWS, 'delcreda mchj', fields)).toHaveLength(2)
    expect(searchRows(ROWS, 'delcreda', fields)).toHaveLength(3)
  })

  it('applies the terms in order, each narrowing the previous', () => {
    expect(searchRows(ROWS, 'Delcreda, DE', fields).map((r) => r.name)).toEqual(['Delcreda GmbH'])
    expect(searchRows(ROWS, 'MChJ, UZ, 2026', fields).map((r) => r.policy)).toEqual(['TCI-2026-0001'])
  })

  it('no country is needed; a country is one more term', () => {
    expect(searchRows(ROWS, 'Samarkand', fields)).toHaveLength(1)
    expect(searchRows(ROWS, 'Delcreda, UZ', fields)).toHaveLength(2)
  })

  it('finds Uzbek names whichever apostrophe is typed', () => {
    expect(searchRows(ROWS, "o'g'it", fields)).toHaveLength(1)
  })

  it('names the term that left nothing', () => {
    const query = 'Delcreda, FR'
    const { rows, matches } = filterByTerms(ROWS, parseTerms(query), fields)
    expect(rows).toHaveLength(0)
    expect(matches).toEqual(['contains', 'none'])
    expect(emptyingTerm(query, matches)).toBe('FR')
  })

  it('an empty query leaves every row', () => {
    expect(searchRows(ROWS, '  ', fields)).toHaveLength(ROWS.length)
  })
})
