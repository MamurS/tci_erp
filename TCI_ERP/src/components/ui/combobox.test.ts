import { describe, expect, it } from 'vitest'

import { highlight, matchOptions, normalize } from './combobox'

const COMPANIES = [
  { id: '1', label: 'Andijan Auto Components MChJ', keywords: ['308114520'] },
  { id: '2', label: 'Ankara Tekstil Sanayi A.Ş.', keywords: ['312877'] },
  { id: '3', label: 'OOO «Ozon Volga»', keywords: [] },
  { id: '4', label: 'Samarkand Auto Parts', keywords: ['AUTO-1'] },
  { id: '5', label: 'Toshkent Qog‘oz Fabrikasi', keywords: [] },
]

describe('combobox matching', () => {
  it('ignores case, diacritics, apostrophes and repeated spaces', () => {
    expect(normalize('  Ankara  Tekstil Sanayi A.Ş. ')).toBe('ankara tekstil sanayi a.s.')
    expect(normalize('Qog‘oz')).toBe(normalize("Qog'oz"))
    expect(matchOptions(COMPANIES, 'qogoz').shown.map((c) => c.id)).toEqual(['5'])
    expect(matchOptions(COMPANIES, 'sanayi a.s').shown.map((c) => c.id)).toEqual(['2'])
  })

  it('ranks a label start, then a word start, then a contained match, then a keyword', () => {
    expect(matchOptions(COMPANIES, 'auto').shown.map((c) => c.id)).toEqual(['1', '4'])
    expect(matchOptions(COMPANIES, 'an').shown.map((c) => c.id)).toEqual(['1', '2', '4'])
    expect(matchOptions(COMPANIES, 'ozon').shown.map((c) => c.id)).toEqual(['3'])
    expect(matchOptions(COMPANIES, '308114').shown.map((c) => c.id)).toEqual(['1'])
  })

  it('caps the list and counts the rest', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: String(i), label: `Company ${i}` }))
    expect(matchOptions(many, 'company', 8)).toMatchObject({ more: 12 })
    expect(matchOptions(many, 'company', 8).shown).toHaveLength(8)
    expect(matchOptions(many, 'zzz')).toEqual({ shown: [], more: 0 })
  })

  it('highlights the matching characters of the original label', () => {
    expect(highlight('Andijan Auto Components MChJ', 'auto')).toEqual([
      { text: 'Andijan ', match: false },
      { text: 'Auto', match: true },
      { text: ' Components MChJ', match: false },
    ])
    expect(highlight('Toshkent Qog‘oz Fabrikasi', 'qogoz')).toEqual([
      { text: 'Toshkent ', match: false },
      { text: 'Qog‘oz', match: true },
      { text: ' Fabrikasi', match: false },
    ])
    expect(highlight('Ankara Tekstil Sanayi A.Ş.', 'a.s')).toEqual([
      { text: 'Ankara Tekstil Sanayi ', match: false },
      { text: 'A.Ş', match: true },
      { text: '.', match: false },
    ])
    expect(highlight('Ozon', 'xyz')).toEqual([{ text: 'Ozon', match: false }])
  })
})
