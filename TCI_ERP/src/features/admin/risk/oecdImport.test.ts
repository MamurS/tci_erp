import { describe, expect, it } from 'vitest'

import M85 from '../../../../supabase/migrations/0085_sector_country_risk.sql?raw'
import {
  dateInText,
  decodeCsvBytes,
  findFileDate,
  importPayload,
  parseCategory,
  parseCsvText,
  parseOecdRows,
  refusedCodes,
  unknownCodes,
} from './oecdImport'

describe('parseOecdRows — headers', () => {
  it('reads the English header and the categories', () => {
    const p = parseOecdRows([
      ['Country', 'Code', 'Category'],
      ['Germany', 'DE', 0],
      ['Uzbekistan', 'UZ', '5'],
    ])
    expect(p.errors).toEqual([])
    expect(p.headerIndex).toBe(0)
    expect(importPayload(p)).toEqual([
      { country_code: 'DE', category: 0 },
      { country_code: 'UZ', category: 5 },
    ])
  })

  it('reads Russian and Uzbek headers, in any case', () => {
    expect(importPayload(parseOecdRows([['КОД', 'Страна', 'Категория'], ['kz', 'Казахстан', 5]]))).toEqual([
      { country_code: 'KZ', category: 5 },
    ])
    expect(importPayload(parseOecdRows([['Mamlakat kodi', 'IHTT toifasi'], ['UZ', 5]]))).toEqual([
      { country_code: 'UZ', category: 5 },
    ])
    expect(importPayload(parseOecdRows([['Код страны', 'Классификация ОЭСР'], ['TR', 5]]))).toEqual([
      { country_code: 'TR', category: 5 },
    ])
  })

  it('takes country_code / ISO / classification variants and ignores extra columns', () => {
    const p = parseOecdRows([
      ['#', 'Country name', 'country_code', 'Region', 'Prevailing classification', 'Since'],
      [1, 'France', 'FR', 'Europe', 0, '2020'],
      [2, 'Brazil', 'BR', 'Americas', 4, '2021'],
    ])
    expect(p.errors).toEqual([])
    expect(importPayload(p)).toEqual([
      { country_code: 'FR', category: 0 },
      { country_code: 'BR', category: 4 },
    ])
    expect(importPayload(parseOecdRows([['ISO', 'OECD category'], ['CN', 2]]))).toEqual([
      { country_code: 'CN', category: 2 },
    ])
  })

  it('prefers the exact code header over one that only contains «code»', () => {
    const p = parseOecdRows([
      ['Region code', 'Code', 'Category'],
      ['EU', 'AT', 0],
    ])
    expect(importPayload(p)).toEqual([{ country_code: 'AT', category: 0 }])
  })

  it('finds the header below a title block', () => {
    const p = parseOecdRows([
      ['Country Risk Classifications of the Participants to the Arrangement'],
      ['Valid as of 28 June 2026'],
      [],
      ['ISO code', 'Country', 'Classification'],
      ['AZ', 'Azerbaijan', 5],
    ])
    expect(p.headerIndex).toBe(3)
    expect(p.rows[0]).toMatchObject({ row: 5, country_code: 'AZ', category: 5 })
  })

  it('names a missing column', () => {
    expect(parseOecdRows([['Country', 'Category'], ['Germany', 0]]).errors).toEqual([{ kind: 'no_code_column' }])
    expect(parseOecdRows([['Code', 'Country'], ['DE', 'Germany']]).errors).toEqual([{ kind: 'no_category_column' }])
    expect(parseOecdRows([]).errors).toEqual([{ kind: 'empty' }])
    expect(parseOecdRows([[null, ''], []]).errors).toEqual([{ kind: 'empty' }])
    expect(parseOecdRows([['Code', 'Category']]).errors).toEqual([{ kind: 'empty' }])
  })
})

describe('parseOecdRows — values', () => {
  const head = ['Code', 'Category']

  it('upper-cases a lower-case code and says so', () => {
    const p = parseOecdRows([head, ['uz', 5], ['DE', 0]])
    expect(p.rows.map((r) => [r.country_code, r.warnings])).toEqual([
      ['UZ', ['lowercase']],
      ['DE', []],
    ])
  })

  it('leaves out a country with no category and counts it — never 0', () => {
    const p = parseOecdRows([head, ['US', '-'], ['JP', ''], ['GB', null], ['CH', '—'], ['UZ', 5], ['XK', 'n/a']])
    expect(p.skipped).toBe(5)
    expect(p.skippedCodes).toEqual(['US', 'JP', 'GB', 'CH', 'XK'])
    expect(importPayload(p)).toEqual([{ country_code: 'UZ', category: 5 }])
    expect(p.errors).toEqual([])
  })

  it('refuses a category that is not a whole number 0–7', () => {
    const p = parseOecdRows([head, ['AA', 8], ['BB', '2.5'], ['CC', 'high'], ['DD', -1], ['EE', 3.5], ['FF', '3.0'], ['GG', '4,0']])
    expect(p.errors.map((e) => [e.kind, e.row, e.value])).toEqual([
      ['category_invalid', 2, '8'],
      ['category_invalid', 3, '2.5'],
      ['category_invalid', 4, 'high'],
      ['category_invalid', 5, '-1'],
      ['category_invalid', 6, '3.5'],
    ])
    expect(importPayload(p)).toEqual([
      { country_code: 'FF', category: 3 },
      { country_code: 'GG', category: 4 },
    ])
  })

  it('refuses a duplicate, naming both rows — also when one of them is not classified', () => {
    const p = parseOecdRows([head, ['DE', 0], ['de', 0], ['US', '-'], ['US', 0]])
    expect(p.errors).toEqual([
      { kind: 'duplicate', row: 3, code: 'DE', firstRow: 2 },
      { kind: 'duplicate', row: 5, code: 'US', firstRow: 4 },
    ])
  })

  it('refuses alpha-3 codes by name instead of guessing', () => {
    const p = parseOecdRows([head, ['UZB', 5], ['deu', 0]])
    expect(p.errors).toEqual([
      { kind: 'alpha3', row: 2, value: 'UZB' },
      { kind: 'alpha3', row: 3, value: 'deu' },
    ])
  })

  it('refuses a malformed code and a category with no code; ignores blank lines and footnotes', () => {
    const p = parseOecdRows([
      head,
      ['U1', 3],
      ['', 4],
      [null, null],
      ['DE', 0],
      ['* Countries not listed are not classified', null],
    ])
    expect(p.errors).toEqual([
      { kind: 'code_invalid', row: 2, value: 'U1' },
      { kind: 'code_missing', row: 3, value: '4' },
    ])
    expect(importPayload(p)).toEqual([{ country_code: 'DE', category: 0 }])
  })

  it('parses categories', () => {
    expect([0, 7, '7', ' 3 ', '3.00', 8, '', '1e0'].map(parseCategory)).toEqual([0, 7, 7, 3, 3, null, null, null])
  })
})

describe('parseCsvText', () => {
  it('drops a byte-order mark and reads a comma file', () => {
    const rows = parseCsvText('\uFEFFcode,category\r\nDE,0\r\nUZ,5\r\n')
    expect(rows).toEqual([
      ['code', 'category'],
      ['DE', '0'],
      ['UZ', '5'],
    ])
    expect(importPayload(parseOecdRows(rows))).toHaveLength(2)
  })

  it('reads a semicolon file with quoted fields', () => {
    const rows = parseCsvText('Страна;Код;Категория\n"Корея, Республика";KR;0\n"Say ""hi""";UZ;5')
    expect(rows).toEqual([
      ['Страна', 'Код', 'Категория'],
      ['Корея, Республика', 'KR', '0'],
      ['Say "hi"', 'UZ', '5'],
    ])
    expect(importPayload(parseOecdRows(rows))).toEqual([
      { country_code: 'KR', category: 0 },
      { country_code: 'UZ', category: 5 },
    ])
  })

  it('honours Excel’s sep= line, tabs and CR line ends', () => {
    expect(parseCsvText('sep=;\ncode;category\nDE;0')).toEqual([
      ['code', 'category'],
      ['DE', '0'],
    ])
    expect(parseCsvText('code\tcategory\rDE\t0')).toEqual([
      ['code', 'category'],
      ['DE', '0'],
    ])
  })

  it('decodes UTF-8 with a BOM and Windows-1251', () => {
    const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('код;категория')])
    expect(decodeCsvBytes(utf8.buffer)).toBe('код;категория')
    // «код» in Windows-1251
    expect(decodeCsvBytes(new Uint8Array([0xea, 0xee, 0xe4]).buffer)).toBe('код')
  })
})

describe('the file date', () => {
  it('reads the usual ways of writing a date', () => {
    expect(dateInText('Valid as of 28 June 2026')).toBe('2026-06-28')
    expect(dateInText('June 28, 2026')).toBe('2026-06-28')
    expect(dateInText('по состоянию на 28 июня 2026 г.')).toBe('2026-06-28')
    expect(dateInText('2026-06-28')).toBe('2026-06-28')
    expect(dateInText('28.06.2026')).toBe('2026-06-28')
    expect(dateInText('28/06/2026')).toBe('2026-06-28')
    expect(dateInText('31.02.2026')).toBeNull()
    expect(dateInText('3 categories in 2026')).toBeNull()
  })

  it('looks above the header first, then at the file name', () => {
    const rows = [['OECD CRC'], ['Valid as of 28 June 2026'], ['Code', 'Category'], ['DE', '0'], ['2027-01-01', '1']]
    expect(findFileDate(rows, 2, 'crc-2025-01-31.csv')).toBe('2026-06-28')
    expect(findFileDate([['Code', 'Category']], 0, 'crc_2025-01-31.csv')).toBe('2025-01-31')
    expect(findFileDate([['Code', 'Category']], 0, 'crc.csv')).toBeNull()
    expect(findFileDate([[new Date(2026, 5, 28)], ['Code', 'Category']], 1, 'x.xlsx')).toBe('2026-06-28')
  })
})

describe('against the server (0085 import_country_risk)', () => {
  it('sends what the function reads: country_code and a 0–7 category', () => {
    expect(M85).toContain("upper(r ->> 'country_code')")
    expect(M85).toContain("where (r ->> 'category') !~ '^[0-7]$';")
  })

  it('names unknown codes before sending, and reads the ones a refusal names', () => {
    const p = parseOecdRows([['Code', 'Category'], ['DE', 0], ['XX', 3], ['QQ', '-']])
    expect(unknownCodes(p, new Set(['DE']))).toEqual(['XX', 'QQ'])
    expect(M85).toContain("using errcode = 'P0001', detail = array_to_string(v_unknown, ',');")
    expect(refusedCodes({ message: 'country_import_unknown: XX, QQ', details: 'XX,QQ' })).toEqual(['XX', 'QQ'])
    expect(refusedCodes({ message: 'country_import_unknown: XX, QQ' })).toEqual(['XX', 'QQ'])
  })
})
