import { describe, expect, it } from 'vitest'

import { ALPHA3_TO_ALPHA2 } from './iso3166'
import { noteMeaning, parseOecdPdfLines } from './oecdPdf'

// Lines as pdf.js gives them for the OECD list valid as of 16 October 2026
// (cre-crc-current-english.pdf), shortened.
const LINES = [
  'Country Risk Classifications',
  'of the Participants to the Arrangement on Officially Supported Export Credits',
  'Valid as of: 16 October 2026',
  'Classification',
  'Country Code Current',
  '(1)',
  'nb Country Name Previous Notes',
  'ISO Alpha 3 Prevailing',
  '1 AFG Afghanistan 7 7',
  '4 AND Andorra - - (8)',
  '11 AUT Austria - - (6) (7)',
  '16 BRB Barbados - - (5)',
  '32 CMR Cameroon 6 7 (9)',
  '43 HRV Croatia - - (7)',
  '46 CYP Cyprus - - (2) (7)',
  '95 XKV Kosovo 6 6 (4)',
  '161 SGP Singapore 0 0',
  '186 UZB Uzbekistan 5 5',
  '(1) This document and any map included herein are without prejudice to the status of or sovereignty over any territory, to the delimitation',
  '(2) Footnote by Türkiye',
  'of the sovereign is also assessed in order to identify, on an exceptional basis, sovereigns that are: (1) not the lowest risk obligor in the',
  '(4) This designation is without prejudice to positions on status, and is in line with United Nations Security Council Resolution 1244/99 and',
  '(5) Currently not reviewed or classified.',
  '(6) High Income OECD Country not reviewed or classified.',
  '(7) High Income Euro Area Country not reviewed or classified.',
  '(8) European micro-state that uses the euro through monetary agreement with the European Union not reviewed or classified.',
  '(9) According to article 23 of the 2023 Arrangement, for all countries classified through the county risk classification methodology, the risk',
  'Page 6 - (16-10-26) # Unclassified - Non classifié',
]

describe('the OECD PDF', () => {
  const read = parseOecdPdfLines(LINES)
  const byCode = new Map(read.parse.rows.map((r) => [r.country_code, r]))

  it('takes the date after «Valid as of»', () => {
    expect(read.fileDate).toBe('2026-10-16')
  })

  it('reads the footnotes by what they say, not by their number', () => {
    expect(read.notes).toMatchObject({ 2: 'other', 4: 'other', 5: 'not_classified', 6: 'high_income', 7: 'high_income', 8: 'high_income', 9: 'other' })
    expect(noteMeaning('European Union and Türkiye')).toBe('other') // «European» is not «euro»
  })

  it('imports the CURRENT category with alpha-2 codes', () => {
    expect(byCode.get('AF')?.category).toBe(7)
    expect(byCode.get('CM')?.category).toBe(7) // previous 6, current 7
    expect(byCode.get('UZ')?.category).toBe(5)
    expect(byCode.get('SG')).toMatchObject({ category: 0, warnings: [] }) // a real 0
    expect(byCode.get('XK')?.category).toBe(6) // Kosovo, XKV
  })

  it('reads a high-income «-» as 0, with a warning naming the note', () => {
    for (const code of ['AD', 'AT', 'HR', 'CY']) {
      expect(byCode.get(code)).toMatchObject({ category: 0, warnings: ['highIncomeZero'] })
    }
    expect(byCode.get('AT')?.notes).toEqual([6, 7])
  })

  it('leaves a «not reviewed» country out: not classified, never 0', () => {
    expect(byCode.has('BB')).toBe(false)
    expect(read.parse.skippedCodes).toEqual(['BB'])
    expect(read.parse.skipped).toBe(1)
  })

  it('refuses what it cannot read, by row', () => {
    const bad = parseOecdPdfLines([
      '7 ZZZ Nowhere 3 3',
      '8 FRA France - -',
      '9 FRA France 2 2',
      '10 DEU Germany - - (9)',
      '(9) According to article 23',
    ])
    expect(bad.parse.errors).toEqual([
      { kind: 'code_invalid', row: 7, value: 'ZZZ' },
      { kind: 'dash_unexplained', row: 8, value: '—', code: 'FR' },
      { kind: 'duplicate', row: 9, code: 'FR', firstRow: 8 },
      { kind: 'dash_unexplained', row: 10, value: '(9)', code: 'DE' },
    ])
    expect(parseOecdPdfLines(['nothing here']).parse.errors).toEqual([{ kind: 'empty' }])
  })

  it('maps every ISO alpha-3 code to an alpha-2 code', () => {
    expect(Object.keys(ALPHA3_TO_ALPHA2)).toHaveLength(250)
    for (const [a3, a2] of Object.entries(ALPHA3_TO_ALPHA2)) {
      expect(a3).toMatch(/^[A-Z]{3}$/)
      expect(a2).toMatch(/^[A-Z]{2}$/)
    }
    expect(ALPHA3_TO_ALPHA2.UZB).toBe('UZ')
  })
})
