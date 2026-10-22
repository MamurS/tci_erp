import { describe, expect, it } from 'vitest'

import M56 from '../../../../supabase/migrations/0056_premium_payments.sql?raw'
import {
  applyMapping,
  decodeText,
  detectHeaderRow,
  fromExcelSerial,
  guessColumns,
  guessDateFormat,
  guessDecimal,
  guessMapping,
  headerLabels,
  mappingProblems,
  normalizeCurrency,
  parseAmount,
  parseDate,
  readMapping,
  readStatementFile,
} from './bankStatement'
import type { BankMapping } from './bankStatement'
import { BANK_LINE_STATUSES, LINE_RESULT_KEYS, MATCH_REASONS, emptyCounts, lineResultKey, pickImport, sectionOf } from './lines'

describe('parseAmount', () => {
  it('reads both decimal conventions and every thousands separator', () => {
    expect(parseAmount('1,234.56')).toBe(1234.56)
    expect(parseAmount('1.234,56')).toBe(1234.56)
    expect(parseAmount('1 234 567,89')).toBe(1234567.89)
    expect(parseAmount('1 234,5')).toBe(1234.5)
    expect(parseAmount('1 234.50')).toBe(1234.5)
    expect(parseAmount("1'234.50")).toBe(1234.5)
    expect(parseAmount('1234,56')).toBe(1234.56)
    expect(parseAmount('1234')).toBe(1234)
    expect(parseAmount('0,123')).toBe(0.12)
    expect(parseAmount(1250000.456)).toBe(1250000.46)
  })

  it('drops currency codes, signs and words around the number', () => {
    expect(parseAmount('1 250 000,00 UZS')).toBe(1250000)
    expect(parseAmount('USD 120.00')).toBe(120)
    expect(parseAmount('$120')).toBe(120)
    expect(parseAmount('€ 99,90')).toBe(99.9)
    expect(parseAmount('15 000 сум')).toBe(15000)
  })

  it('reads a minus, a trailing minus, a Unicode minus and parentheses as a debit', () => {
    expect(parseAmount('-500.00')).toBe(-500)
    expect(parseAmount('500.00-')).toBe(-500)
    expect(parseAmount('−500,00')).toBe(-500)
    expect(parseAmount('(1,200.00)')).toBe(-1200)
    expect(parseAmount(-75.5)).toBe(-75.5)
    expect(parseAmount('+75.5')).toBe(75.5)
  })

  it('treats a single separator before three digits as thousands', () => {
    expect(guessDecimal('1,234')).toBe('.')
    expect(guessDecimal('1.234')).toBe(',')
    expect(guessDecimal('12,34')).toBe(',')
    expect(guessDecimal('1,234,567')).toBe('.')
    expect(guessDecimal('1234')).toBeNull()
    expect(parseAmount('1,234')).toBe(1234)
    expect(parseAmount('1.234.567')).toBe(1234567)
  })

  it('refuses rather than misreads, with an explicit separator too', () => {
    expect(parseAmount('1234,56', '.')).toBeNull()
    expect(parseAmount('1,5', '.')).toBeNull()
    expect(parseAmount('1.234,56', ',')).toBe(1234.56)
    expect(parseAmount('1,234.56', '.')).toBe(1234.56)
    expect(parseAmount('12.34.56', ',')).toBeNull()
    expect(parseAmount('abc')).toBeNull()
    expect(parseAmount('')).toBeNull()
    expect(parseAmount(null)).toBeNull()
    expect(parseAmount(Number.NaN)).toBeNull()
    expect(parseAmount('1.2.3,4.5')).toBeNull()
  })
})

describe('parseDate', () => {
  it('reads day-first, ISO and month-first dates', () => {
    expect(parseDate('05.10.2026', 'DD.MM.YYYY')).toBe('2026-10-05')
    expect(parseDate('5.1.26', 'DD.MM.YYYY')).toBe('2026-01-05')
    expect(parseDate('04/03/2026', 'DD/MM/YYYY')).toBe('2026-03-04')
    expect(parseDate('04/03/2026', 'MM/DD/YYYY')).toBe('2026-04-03')
    expect(parseDate('2026-10-05', 'DD.MM.YYYY')).toBe('2026-10-05')
    expect(parseDate('2026.10.05', 'MM/DD/YYYY')).toBe('2026-10-05')
    expect(parseDate('05.10.2026 14:22:01', 'DD.MM.YYYY')).toBe('2026-10-05')
    expect(parseDate('2026-10-05T09:00:00', 'DD.MM.YYYY')).toBe('2026-10-05')
  })

  it('reads Excel date serials, as numbers and as text', () => {
    expect(fromExcelSerial(46300)).toBe('2026-10-05')
    expect(parseDate(46300, 'DD.MM.YYYY')).toBe('2026-10-05')
    expect(parseDate(46300.75, 'MM/DD/YYYY')).toBe('2026-10-05')
    expect(parseDate('46300', 'DD.MM.YYYY')).toBe('2026-10-05')
    expect(fromExcelSerial(1)).toBeNull()
  })

  it('refuses a date that does not exist', () => {
    expect(parseDate('31.02.2026', 'DD.MM.YYYY')).toBeNull()
    expect(parseDate('13/13/2026', 'MM/DD/YYYY')).toBeNull()
    expect(parseDate('2026-02-30', 'YYYY-MM-DD')).toBeNull()
    expect(parseDate('yesterday', 'DD.MM.YYYY')).toBeNull()
    expect(parseDate('', 'DD.MM.YYYY')).toBeNull()
    expect(parseDate(null, 'DD.MM.YYYY')).toBeNull()
  })

  it('guesses the format of a column', () => {
    expect(guessDateFormat(['01/02/2026', '25/02/2026'])).toBe('DD/MM/YYYY')
    expect(guessDateFormat(['01/02/2026', '02/25/2026'])).toBe('MM/DD/YYYY')
    expect(guessDateFormat(['01/02/2026'])).toBe('DD/MM/YYYY')
    expect(guessDateFormat(['01.02.2026'])).toBe('DD.MM.YYYY')
    expect(guessDateFormat(['2026-02-01'])).toBe('YYYY-MM-DD')
    expect(guessDateFormat([46300])).toBe('DD.MM.YYYY')
  })
})

describe('currencies', () => {
  it('reads codes, signs, ISO numeric codes and local words', () => {
    expect(normalizeCurrency('usd')).toBe('USD')
    expect(normalizeCurrency('$')).toBe('USD')
    expect(normalizeCurrency(840)).toBe('USD')
    expect(normalizeCurrency('860')).toBe('UZS')
    expect(normalizeCurrency('сум')).toBe('UZS')
    expect(normalizeCurrency('so‘m')).toBe('UZS')
    expect(normalizeCurrency('€')).toBe('EUR')
    expect(normalizeCurrency('руб.')).toBe('RUB')
    expect(normalizeCurrency('dollars')).toBeNull()
    expect(normalizeCurrency('')).toBeNull()
  })
})

describe('headers and the first guess', () => {
  const ROWS = [
    ['Выписка по счёту 20208000900123456001', null, null],
    ['Период: 01.10.2026 — 15.10.2026', null, null],
    [],
    ['Дата валютирования', 'Номер документа', 'Плательщик', 'ИНН плательщика', 'Дебет', 'Кредит', 'Назначение платежа'],
    ['05.10.2026', '118', 'ООО «Альфа»', '301234567', null, '1 250 000,00', 'Оплата по счёту INV-TCI-2026-0002-01'],
  ]

  it('names columns, including blank and repeated ones', () => {
    expect(headerLabels(['Дата', null, 'Сумма', 'Сумма', ' '])).toEqual(['Дата', '#B', 'Сумма', 'Сумма #2', '#E'])
  })

  it('finds the header row under the preamble', () => {
    expect(detectHeaderRow(ROWS)).toBe(3)
  })

  it('maps the columns by the words banks print', () => {
    const cols = guessColumns(headerLabels(ROWS[3]))
    expect(cols.value_date).toBe('Дата валютирования')
    expect(cols.reference).toBe('Номер документа')
    expect(cols.payer).toBe('Плательщик')
    expect(cols.credit).toBe('Кредит')
    expect(cols.debit).toBe('Дебет')
    expect(cols.purpose).toBe('Назначение платежа')
    expect(guessColumns(['Value date', 'Amount', 'Currency', 'Payment details', 'Counterparty'])).toEqual({
      value_date: 'Value date',
      amount: 'Amount',
      currency: 'Currency',
      purpose: 'Payment details',
      payer: 'Counterparty',
    })
  })

  it('makes a whole first mapping', () => {
    const m = guessMapping(ROWS)
    expect(m.header_row).toBe(4)
    expect(m.amount_layout).toBe('split')
    expect(m.columns.amount).toBeUndefined()
    expect(m.date_format).toBe('DD.MM.YYYY')
    expect(m.fixed_currency).toBeNull()
    expect(mappingProblems(m, headerLabels(ROWS[3]))).toEqual(['currency'])
  })

  it('reads a stored mapping back, and refuses one it did not write', () => {
    const m = guessMapping(ROWS)
    expect(readMapping(JSON.parse(JSON.stringify({ ...m, fixed_currency: 'uzs' })))).toEqual({ ...m, fixed_currency: 'UZS' })
    expect(readMapping({})).toBeNull()
    expect(readMapping(null)).toBeNull()
    expect(readMapping({ columns: {}, header_row: 0 })).toBeNull()
    expect(readMapping({ columns: { value_date: 'D' }, header_row: 2, date_format: 'nonsense' })?.date_format).toBe('DD.MM.YYYY')
  })
})

describe('applyMapping', () => {
  const SIGNED: BankMapping = {
    version: 1,
    header_row: 1,
    columns: { value_date: 'Date', amount: 'Amount', currency: 'Ccy', purpose: 'Details', payer: 'Payer', reference: 'Ref' },
    amount_layout: 'signed',
    fixed_currency: null,
    date_format: 'DD.MM.YYYY',
    decimal_separator: 'auto',
    skip_debits: true,
  }
  const ROWS = [
    ['Date', 'Amount', 'Ccy', 'Details', 'Payer', 'Ref'],
    ['05.10.2026', '1,200.00', 'USD', '  Premium   TCI-2026-0001 ', 'Alpha LLC', 'R-1'],
    ['06.10.2026', '-300.00', 'USD', 'Bank fee', null, null],
    [null, null, null, null, null, null],
    ['31.02.2026', '50.00', 'USD', 'x', null, null],
    ['07.10.2026', 'n/a', 'USD', 'y', null, null],
    ['08.10.2026', '0', 'USD', 'z', null, null],
    ['09.10.2026', '10.00', 'dollars', 'w', null, null],
    ['Итого', '1,200.00', null, null, null, null],
    [46300, 99.5, 860, 'serial', 'Beta', null],
  ]

  it('keeps credits, skips debits and service rows, and lists errors by sheet row', () => {
    const r = applyMapping(ROWS, SIGNED)
    expect(r.lines).toEqual([
      { line_no: 2, value_date: '2026-10-05', amount: 1200, currency: 'USD', purpose: 'Premium TCI-2026-0001', reference: 'R-1', payer: 'Alpha LLC' },
      { line_no: 10, value_date: '2026-10-05', amount: 99.5, currency: 'UZS', purpose: 'serial', reference: null, payer: 'Beta' },
    ])
    expect(r.debits).toBe(1)
    expect(r.skipped).toBe(2)
    expect(r.errors).toEqual([
      { line_no: 5, reason: 'dateInvalid', value: '31.02.2026' },
      { line_no: 6, reason: 'amountInvalid', value: 'n/a' },
      { line_no: 7, reason: 'amountZero', value: '0' },
      { line_no: 8, reason: 'currencyInvalid', value: 'dollars' },
    ])
  })

  it('lists a debit as an error when the file should hold incoming payments only', () => {
    const r = applyMapping(ROWS, { ...SIGNED, skip_debits: false })
    expect(r.debits).toBe(0)
    expect(r.errors[0]).toEqual({ line_no: 3, reason: 'debit', value: '-300.00' })
  })

  it('reads split credit / debit columns and a fixed currency', () => {
    const rows = [
      ['Дата', 'Дебет', 'Кредит', 'Назначение'],
      ['05.10.2026', null, '1 000,00', 'a'],
      ['05.10.2026', '200,00', null, 'b'],
      ['05.10.2026', null, null, 'c'],
      ['05.10.2026', null, '(5,00)', 'd'],
    ]
    const m: BankMapping = {
      ...SIGNED,
      columns: { value_date: 'Дата', credit: 'Кредит', debit: 'Дебет', purpose: 'Назначение' },
      amount_layout: 'split',
      fixed_currency: 'UZS',
    }
    expect(mappingProblems(m, headerLabels(rows[0]))).toEqual([])
    const r = applyMapping(rows, m)
    expect(r.lines).toEqual([
      { line_no: 2, value_date: '2026-10-05', amount: 1000, currency: 'UZS', purpose: 'a', reference: null, payer: null },
    ])
    expect(r.debits).toBe(2)
    expect(r.errors).toEqual([{ line_no: 4, reason: 'amountMissing', value: null }])
  })

  it('names what the mapping is missing', () => {
    const headers = ['Date', 'Amount']
    expect(mappingProblems({ ...SIGNED, columns: {} }, headers)).toEqual(['dateColumn', 'amountColumn', 'currency'])
    expect(mappingProblems({ ...SIGNED, columns: { value_date: 'Date', amount: 'Sum' }, fixed_currency: 'USD' }, headers)).toEqual([
      'columnNotFound',
    ])
    expect(mappingProblems({ ...SIGNED, amount_layout: 'split', columns: { value_date: 'Date' }, fixed_currency: 'USD' }, headers)).toEqual([
      'creditColumn',
    ])
  })
})

describe('reading files', () => {
  const toBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer

  it('decodes UTF-8 with a byte-order mark, and Windows-1251', () => {
    const utf8 = new TextEncoder().encode('﻿Дата;Сумма')
    expect(decodeText(toBuffer(utf8))).toBe('Дата;Сумма')
    // «Дата» in Windows-1251
    expect(decodeText(toBuffer(new Uint8Array([0xc4, 0xe0, 0xf2, 0xe0])))).toBe('Дата')
  })

  it('reads a semicolon CSV without interpreting its values', async () => {
    const csv = 'Дата;Сумма;Назначение\n05.10.2026;"1 250,00";Оплата\n'
    const sheet = await readStatementFile(toBuffer(new TextEncoder().encode(csv)), 'statement.csv')
    expect(sheet.rows[0]).toEqual(['Дата', 'Сумма', 'Назначение'])
    expect(sheet.rows[1]).toEqual(['05.10.2026', '1 250,00', 'Оплата'])
  })

  it('reads a workbook with its numbers and date serials, rows numbered as in Excel', async () => {
    const XLSX = await import('xlsx')
    // A table that starts at B3, under two blank rows, as statements often do.
    const ws = XLSX.utils.aoa_to_sheet([])
    XLSX.utils.sheet_add_aoa(ws, [['Date', 'Amount'], [46300, 1250.5]], { origin: 'B3' })
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Statement')
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const sheet = await readStatementFile(out, 'statement.xlsx')
    expect(sheet.rows[2]).toEqual([null, 'Date', 'Amount'])
    expect(sheet.rows[3]).toEqual([null, 46300, 1250.5])
    expect(detectHeaderRow(sheet.rows)).toBe(2)
    expect(headerLabels(sheet.rows[2])).toEqual(['#A', 'Date', 'Amount'])
  })
})

describe('the line vocabulary mirrors migration 0056', () => {
  it('has every bank line status of tci.bank_line_status', () => {
    const block = /create type tci\.bank_line_status as enum \(([\s\S]*?)\);/.exec(M56)?.[1] ?? ''
    const values = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect([...BANK_LINE_STATUSES].sort()).toEqual(values.sort())
  })

  it('labels every match reason the matcher writes', () => {
    for (const reason of MATCH_REASONS) {
      if (reason === 'duplicate') expect(M56).toContain("v_reason := 'duplicate'")
      else if (reason === 'assigned') expect(M56).toContain("set match_reason = 'assigned'")
      else expect(M56).toMatch(new RegExp(`reason :?= '${reason}'`))
    }
    const written = new Set([...M56.matchAll(/reason := '([a-z_]+)'/g)].map((m) => m[1]))
    for (const r of written) expect(MATCH_REASONS as readonly string[]).toContain(r)
  })

  it('maps every per-line answer of confirm_bank_lines to a readable key', () => {
    expect(M56).toContain("result := 'statement_line_not_matched'")
    expect(M56).toContain("return 'statement_line_resolved'")
    expect(M56).toContain("result := coalesce(v_refusal, 'recorded')")
    for (const code of Object.keys(LINE_RESULT_KEYS)) expect(M56).toContain(`'${code}`)
    expect(lineResultKey('payment_exceeds_outstanding')).toBe('premium.errors.exceedsOutstanding')
    expect(lineResultKey('statement_line_not_matched')).toBe('premium.bank.errors.lineNotMatched')
    expect(lineResultKey('something new')).toBe('common.somethingWentWrong')
  })
})

describe('the screen\'s choices', () => {
  const imp = (id: string, open: number) => ({ id, counts: { ...emptyCounts(), unmatched: open, confirmed: 1 } })

  it('opens the import the address names, else the newest with work, else the newest', () => {
    const list = [imp('new', 0), imp('older', 2), imp('oldest', 1)]
    expect(pickImport(list, 'oldest')?.id).toBe('oldest')
    expect(pickImport(list, null)?.id).toBe('older')
    expect(pickImport(list, 'stale-id')?.id).toBe('older')
    expect(pickImport([imp('a', 0), imp('b', 0)], null)?.id).toBe('a')
    expect(pickImport([], 'x')).toBeNull()
  })

  it('puts every status in one section', () => {
    expect(BANK_LINE_STATUSES.map(sectionOf)).toEqual(['matched', 'suggested', 'unmatched', 'processed', 'processed', 'processed'])
  })
})
