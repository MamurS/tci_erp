/**
 * Reading a bank statement in the browser (Prompt 23, migration 0056).
 *
 * The database never sees the file: the browser reads the CSV / Excel sheet,
 * applies the bank's column mapping (stored as `tci.bank_statement_profiles.
 * mapping`, whose shape is defined HERE — the server only keeps it) and sends
 * the incoming payments to `tci.import_bank_statement` as
 * `[{ line_no, value_date, amount, currency, purpose, reference, payer }]`.
 * Matching against policies and invoices is the server's job.
 *
 * Everything below is pure except `readStatementFile`, which lazily loads the
 * spreadsheet reader so it stays out of the main bundle.
 */

// ---------------------------------------------------------------------------
// The mapping (what a saved bank layout holds)
// ---------------------------------------------------------------------------

/** The fields a statement column can feed. */
export const BANK_FIELDS = ['value_date', 'amount', 'credit', 'debit', 'currency', 'purpose', 'reference', 'payer'] as const
export type BankField = (typeof BANK_FIELDS)[number]

/** Day first, ISO, or month first. ISO dates and Excel date cells are read
 * whatever the format says; the format decides the ambiguous `04/03/2026`. */
export const DATE_FORMATS = ['DD.MM.YYYY', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'] as const
export type DateFormat = (typeof DATE_FORMATS)[number]

/** `auto` reads each amount on its own (see `guessDecimal`). */
export const DECIMAL_SEPARATORS = ['auto', '.', ','] as const
export type DecimalSeparator = (typeof DECIMAL_SEPARATORS)[number]

/** One signed amount column (a minus or parentheses is a debit), or a
 * credit column and a debit column. */
export const AMOUNT_LAYOUTS = ['signed', 'split'] as const
export type AmountLayout = (typeof AMOUNT_LAYOUTS)[number]

export interface BankMapping {
  version: 1
  /** The sheet row (1-based, as Excel numbers it) holding the column names. */
  header_row: number
  /** For each field, the column's name as `headerLabels` reads it. */
  columns: Partial<Record<BankField, string>>
  amount_layout: AmountLayout
  /** The currency of every line when the file has no currency column. */
  fixed_currency: string | null
  date_format: DateFormat
  decimal_separator: DecimalSeparator
  /** true: outgoing payments are skipped and counted (a full statement);
   * false: the file should hold incoming payments only, and an outgoing one
   * is listed as an error. */
  skip_debits: boolean
}

/** The most lines one import may carry (tci.import_statement_lines). */
export const MAX_STATEMENT_LINES = 5000

/** What the server takes: one incoming payment. */
export interface StatementLine {
  /** The sheet row it came from, so «line 17» is row 17 of the file. */
  line_no: number
  value_date: string
  amount: number
  currency: string
  purpose: string | null
  reference: string | null
  payer: string | null
}

export type RowErrorReason =
  | 'dateMissing'
  | 'dateInvalid'
  | 'amountMissing'
  | 'amountInvalid'
  | 'amountZero'
  | 'currencyMissing'
  | 'currencyInvalid'
  | 'debit'

export interface RowError {
  line_no: number
  reason: RowErrorReason
  /** What the cell held, to show beside the reason. */
  value: string | null
}

/** Why the mapping cannot be applied yet. */
export type MappingProblem =
  | 'noHeader'
  | 'dateColumn'
  | 'amountColumn'
  | 'creditColumn'
  | 'currency'
  | 'columnNotFound'

export interface StatementParse {
  lines: StatementLine[]
  /** Outgoing payments skipped (skip_debits). */
  debits: number
  /** Empty rows and service rows (totals, balances) skipped. */
  skipped: number
  errors: RowError[]
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export type Cell = unknown

function isBlank(cell: Cell): boolean {
  return cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '')
}

function cellText(cell: Cell): string {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'string') return cell.replace(/\s+/g, ' ').trim()
  if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell)
  return ''
}

/** A free-text field: one line, at most 1000 characters, null when empty. */
function textField(cell: Cell): string | null {
  const text = cellText(cell)
  return text ? text.slice(0, 1000) : null
}

/** A column letter: 0 → A, 27 → AB. */
export function columnLetter(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/** The names a mapping refers to columns by: the header text, `#C` for a
 * column with no header, and `Name #2` for the second column of one name. */
export function headerLabels(row: readonly Cell[] | undefined): string[] {
  const seen = new Map<string, number>()
  return (row ?? []).map((cell, i) => {
    const text = cellText(cell)
    if (!text) return `#${columnLetter(i)}`
    const n = (seen.get(text) ?? 0) + 1
    seen.set(text, n)
    return n === 1 ? text : `${text} #${n}`
  })
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/** Rounded to cents without the binary drift of `Math.round(x * 100) / 100`. */
function roundCents(value: number): number {
  const r = Number(`${Math.round(Number(`${value}e2`))}e-2`)
  return Object.is(r, -0) ? 0 : r
}

/**
 * Which of `.` and `,` is the decimal separator of one amount (digits and
 * separators only), or null for a whole number:
 * both present → the last one; one of them twice or more → it groups
 * thousands, so the other is decimal; once, followed by exactly three digits
 * and not after a lone zero → thousands (`1,234`, `1.234`); otherwise decimal.
 */
export function guessDecimal(digits: string): '.' | ',' | null {
  const dot = digits.lastIndexOf('.')
  const comma = digits.lastIndexOf(',')
  if (dot >= 0 && comma >= 0) return dot > comma ? '.' : ','
  const sep = dot >= 0 ? '.' : comma >= 0 ? ',' : null
  if (!sep) return null
  const parts = digits.split(sep)
  const other = sep === '.' ? ',' : '.'
  if (parts.length > 2) return other
  const [whole = '', fraction = ''] = parts
  if (fraction.length === 3 && whole !== '0' && whole !== '') return other
  return sep
}

/**
 * A signed amount from a cell: negative for a debit (a minus before or after
 * the number, a Unicode minus, or parentheses), null when the cell holds no
 * readable amount. Spaces, no-break spaces and apostrophes group thousands;
 * letters and currency signs around the number (`1 250 000,00 UZS`, `$120`)
 * are dropped. With an explicit decimal separator the other one may only
 * group thousands (three digits a group) — `1234,56` read with `.` is
 * unreadable, never 123456.
 */
export function parseAmount(raw: Cell, decimal: DecimalSeparator = 'auto'): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? roundCents(raw) : null
  if (typeof raw !== 'string') return null
  let s = raw.trim()
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  s = s
    .replace(/[−‒–—]/g, '-')
    .replace(/[\p{L}\p{Sc}]/gu, '')
    .replace(/[\s\u00a0\u202f'\u2019\u2018`\u00b4]/g, '')
  if (s.startsWith('+')) s = s.slice(1)
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  } else if (s.endsWith('-')) {
    negative = !negative
    s = s.slice(0, -1)
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null

  const dec = decimal === 'auto' ? guessDecimal(s) : decimal
  const thousands = dec === ',' ? '.' : ','
  const groups = s.split(thousands)
  if (groups.length > 1) {
    // Every group after the first is exactly three digits (the last one up
    // to the decimal separator).
    const ok = groups.every((g, i) => {
      if (i === 0) return /^\d{1,3}$/.test(g) || (groups.length === 1 && /^\d+/.test(g))
      const intPart = i === groups.length - 1 && dec ? g.split(dec)[0] ?? '' : g
      return /^\d{3}$/.test(intPart)
    })
    if (!ok) return null
  }
  let plain = groups.join('')
  if (dec) {
    if (plain.split(dec).length > 2) return null
    plain = plain.replace(dec, '.')
  }
  if (!/^\d+(\.\d+)?$/.test(plain) && !/^\.\d+$/.test(plain)) return null
  const value = roundCents(Number(plain))
  return negative && value !== 0 ? -value : value
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function isoDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** An Excel date serial (days since 30 Dec 1899; the time of day ignored). */
export function fromExcelSerial(serial: number): string | null {
  if (!Number.isFinite(serial)) return null
  const days = Math.floor(serial)
  // 61 = 1 March 1900; below it Excel's phantom 29 Feb 1900 shifts the count.
  if (days < 61 || days > 2958465) return null
  const date = new Date(Date.UTC(1899, 11, 30) + days * 86_400_000)
  return isoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

/**
 * The ISO date (`YYYY-MM-DD`) of a cell, or null. An Excel date (a number,
 * or five digits typed in a text file), an ISO date and a date with a time
 * after it are read whatever the format; `DD.MM.YYYY` / `DD/MM/YYYY` /
 * `MM/DD/YYYY` decide which of two small numbers is the day. Two-digit years
 * are 20YY. A date that does not exist (31.02) is null.
 */
export function parseDate(raw: Cell, format: DateFormat): string | null {
  if (typeof raw === 'number') return fromExcelSerial(raw)
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : isoDate(raw.getFullYear(), raw.getMonth() + 1, raw.getDate())
  }
  if (typeof raw !== 'string') return null
  const s = raw.trim().split(/[\sT]/)[0] ?? ''
  if (!s) return null
  if (/^\d{5}(\.\d+)?$/.test(s)) return fromExcelSerial(Number(s))
  const iso = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s)
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const short = /^(\d{1,2})[-./](\d{1,2})[-./](\d{2}|\d{4})$/.exec(s)
  if (!short) return null
  const a = Number(short[1])
  const b = Number(short[2])
  const year = short[3]!.length === 2 ? 2000 + Number(short[3]) : Number(short[3])
  return format === 'MM/DD/YYYY' ? isoDate(year, a, b) : isoDate(year, b, a)
}

/** The date format a column of values is most likely written in: a slash
 * date whose first number is over 12 is day first, one whose second number
 * is over 12 is month first; day first otherwise (the custom in the
 * countries we serve). */
export function guessDateFormat(values: readonly Cell[]): DateFormat {
  let slash = false
  let dot = false
  let iso = false
  for (const v of values) {
    if (typeof v !== 'string') continue
    const s = v.trim().split(/[\sT]/)[0] ?? ''
    if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(s)) iso = true
    const m = /^(\d{1,2})([-./])(\d{1,2})[-./](\d{2}|\d{4})$/.exec(s)
    if (!m) continue
    if (m[2] === '/') {
      slash = true
      if (Number(m[1]) > 12) return 'DD/MM/YYYY'
      if (Number(m[3]) > 12) return 'MM/DD/YYYY'
    } else dot = true
  }
  if (slash) return 'DD/MM/YYYY'
  if (dot) return 'DD.MM.YYYY'
  if (iso) return 'YYYY-MM-DD'
  return 'DD.MM.YYYY'
}

// ---------------------------------------------------------------------------
// Currencies
// ---------------------------------------------------------------------------

const CURRENCY_ALIASES: Record<string, string> = {
  $: 'USD',
  US$: 'USD',
  '840': 'USD',
  'ДОЛЛАР США': 'USD',
  '€': 'EUR',
  '978': 'EUR',
  ЕВРО: 'EUR',
  "SO'M": 'UZS',
  'SO‘M': 'UZS',
  SOM: 'UZS',
  SUM: 'UZS',
  СУМ: 'UZS',
  СЎМ: 'UZS',
  '860': 'UZS',
  '₽': 'RUB',
  РУБ: 'RUB',
  RUR: 'RUB',
  '643': 'RUB',
}

/** An ISO currency code from a cell: the code itself, a sign, the ISO numeric
 * code banks in the region print (860, 840, 978, 643), or the local word. */
export function normalizeCurrency(raw: Cell): string | null {
  const text = cellText(raw).toUpperCase().replace(/\.$/, '')
  if (!text) return null
  const alias = CURRENCY_ALIASES[text]
  if (alias) return alias
  return /^[A-Z]{3}$/.test(text) ? text : null
}

// ---------------------------------------------------------------------------
// Header and column detection (a first guess for a new layout)
// ---------------------------------------------------------------------------

/** Lower case, letters and digits only, single spaces. */
function normalizeHeader(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’ʻʼ'`´]/g, '')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Words a bank prints over each column, in en / ru / uz. */
const FIELD_WORDS: Record<BankField, readonly string[]> = {
  value_date: ['дата валютирования', 'дата операции', 'дата проводки', 'value date', 'booking date', 'date', 'дата', 'sana', 'sanasi'],
  credit: ['кредит', 'credit', 'приход', 'поступление', 'зачисление', 'kirim', 'kredit'],
  debit: ['дебет', 'debit', 'расход', 'списание', 'chiqim'],
  amount: ['сумма', 'amount', 'summa', 'сумма операции'],
  currency: ['валюта', 'currency', 'valyuta', 'ccy'],
  purpose: ['назначение платежа', 'назначение', 'payment details', 'purpose', 'details', 'description', 'narrative', 'tolov maqsadi', 'maqsadi', 'maqsad'],
  reference: ['номер документа', 'номер док', 'документ', 'reference', 'ref', 'doc no', 'hujjat raqami', 'hujjat'],
  payer: ['наименование плательщика', 'плательщик', 'корреспондент', 'контрагент', 'отправитель', 'payer', 'counterparty', 'sender', 'tolovchi'],
}

/** A column that merely mentions the payer (their tax number, account or bank). */
const NOT_A_NAME = ['инн', 'inn', 'stir', 'счет', 'account', 'банк', 'bank', 'мфо', 'mfo', 'bik', 'бик']

/** The order fields claim columns in: «Сумма по кредиту» is a credit before
 * it is an amount, «Дата документа» a date before a document number. */
const CLAIM_ORDER: readonly BankField[] = ['credit', 'debit', 'value_date', 'currency', 'payer', 'purpose', 'reference', 'amount']

function headerScore(header: string, field: BankField): number {
  const h = normalizeHeader(header)
  if (!h || header.startsWith('#')) return 0
  if (field === 'payer' && NOT_A_NAME.some((w) => h.split(' ').includes(w))) return 0
  let best = 0
  for (const word of FIELD_WORDS[field]) {
    const w = normalizeHeader(word)
    if (h === w) best = Math.max(best, 3)
    else if (h.startsWith(`${w} `) || h.endsWith(` ${w}`)) best = Math.max(best, 2)
    else if (` ${h} `.includes(` ${w} `)) best = Math.max(best, 1)
  }
  return best
}

/** Each field's most likely column among `headers` (none used twice). */
export function guessColumns(headers: readonly string[]): Partial<Record<BankField, string>> {
  const out: Partial<Record<BankField, string>> = {}
  const used = new Set<string>()
  for (const field of CLAIM_ORDER) {
    let best: string | null = null
    let bestScore = 0
    for (const h of headers) {
      if (used.has(h)) continue
      const score = headerScore(h, field)
      if (score > bestScore) {
        best = h
        bestScore = score
      }
    }
    if (best) {
      out[field] = best
      used.add(best)
    }
  }
  return out
}

/**
 * The row (0-based) most likely to hold the column names, among the first 30:
 * the one with the most header words, then the most text cells; a row of
 * numbers or dates is never a header. Statements often open with the account,
 * the period and the balance before the table starts.
 */
export function detectHeaderRow(rows: readonly (readonly Cell[])[]): number {
  let best = -1
  let bestScore = -1
  const limit = Math.min(rows.length, 30)
  for (let i = 0; i < limit; i++) {
    const row = rows[i] ?? []
    const texts = row.filter(
      (c) => typeof c === 'string' && c.trim() !== '' && parseAmount(c) === null && parseDate(c, 'DD.MM.YYYY') === null,
    ) as string[]
    if (texts.length < 2) continue
    const words = texts.filter((t) => BANK_FIELDS.some((f) => headerScore(t, f) > 0)).length
    const score = words * 100 + texts.length
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  }
  return best < 0 ? 0 : best
}

/** A first mapping for a file no layout exists for yet. */
export function guessMapping(rows: readonly (readonly Cell[])[]): BankMapping {
  const headerIndex = detectHeaderRow(rows)
  const headers = headerLabels(rows[headerIndex])
  const columns = guessColumns(headers)
  const split = Boolean(columns.credit)
  if (split) delete columns.amount
  else {
    delete columns.credit
    delete columns.debit
  }
  const dateIndex = columns.value_date ? headers.indexOf(columns.value_date) : -1
  const dateValues = dateIndex >= 0 ? rows.slice(headerIndex + 1, headerIndex + 51).map((r) => r[dateIndex]) : []
  return {
    version: 1,
    header_row: headerIndex + 1,
    columns,
    amount_layout: split ? 'split' : 'signed',
    fixed_currency: null,
    date_format: guessDateFormat(dateValues),
    decimal_separator: 'auto',
    skip_debits: true,
  }
}

/** A stored mapping, checked: null when it is not one this screen wrote. */
export function readMapping(value: unknown): BankMapping | null {
  if (!value || typeof value !== 'object') return null
  const m = value as Record<string, unknown>
  const columns = m.columns
  if (!columns || typeof columns !== 'object') return null
  const cols: Partial<Record<BankField, string>> = {}
  for (const field of BANK_FIELDS) {
    const v = (columns as Record<string, unknown>)[field]
    if (typeof v === 'string' && v) cols[field] = v
  }
  const headerRow = Number(m.header_row)
  if (!Number.isInteger(headerRow) || headerRow < 1) return null
  const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
    (allowed as readonly unknown[]).includes(v) ? (v as T) : fallback
  const fixed = typeof m.fixed_currency === 'string' ? normalizeCurrency(m.fixed_currency) : null
  return {
    version: 1,
    header_row: headerRow,
    columns: cols,
    amount_layout: pick(m.amount_layout, AMOUNT_LAYOUTS, 'signed'),
    fixed_currency: fixed,
    date_format: pick(m.date_format, DATE_FORMATS, 'DD.MM.YYYY'),
    decimal_separator: pick(m.decimal_separator, DECIMAL_SEPARATORS, 'auto'),
    skip_debits: m.skip_debits !== false,
  }
}

/** What stops the mapping from being applied to a file with these headers. */
export function mappingProblems(mapping: BankMapping, headers: readonly string[]): MappingProblem[] {
  const out: MappingProblem[] = []
  if (!headers.length) out.push('noHeader')
  const missing = (field: BankField) => {
    const name = mapping.columns[field]
    return !name || !headers.includes(name)
  }
  if (!mapping.columns.value_date) out.push('dateColumn')
  if (mapping.amount_layout === 'signed' && !mapping.columns.amount) out.push('amountColumn')
  if (mapping.amount_layout === 'split' && !mapping.columns.credit) out.push('creditColumn')
  if (!mapping.columns.currency && !mapping.fixed_currency) out.push('currency')
  const used: BankField[] = BANK_FIELDS.filter((f) => {
    if (!mapping.columns[f]) return false
    if (mapping.amount_layout === 'signed') return f !== 'credit' && f !== 'debit'
    return f !== 'amount'
  })
  if (used.some(missing)) out.push('columnNotFound')
  return out
}

// ---------------------------------------------------------------------------
// Applying a mapping
// ---------------------------------------------------------------------------

/** Words in the date column of a totals or balance row. */
const SERVICE_ROW = /итог|всего|оборот|сальдо|остаток|total|balance|turnover|jami|qoldiq/i

/**
 * The incoming payments of a sheet read with a mapping. Rows below the header
 * row are read one by one: an empty row or a totals / balance row is skipped;
 * an outgoing payment is skipped and counted (or listed as an error when the
 * layout says the file holds incoming payments only); a row whose date,
 * amount or currency cannot be read is listed with its sheet row number and
 * the reason, and not imported.
 */
export function applyMapping(rows: readonly (readonly Cell[])[], mapping: BankMapping): StatementParse {
  const headerIndex = mapping.header_row - 1
  const headers = headerLabels(rows[headerIndex])
  const col = (field: BankField): number => {
    const name = mapping.columns[field]
    return name ? headers.indexOf(name) : -1
  }
  const at = (row: readonly Cell[], field: BankField): Cell => {
    const i = col(field)
    return i >= 0 ? row[i] : null
  }
  const amountFields: BankField[] = mapping.amount_layout === 'split' ? ['credit', 'debit'] : ['amount']
  const mapped: BankField[] = ['value_date', ...amountFields, 'currency', 'purpose', 'reference', 'payer']

  const out: StatementParse = { lines: [], debits: 0, skipped: 0, errors: [] }
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i] ?? []
    const line_no = i + 1
    if (mapped.every((f) => isBlank(at(row, f)))) {
      out.skipped++
      continue
    }
    const dateCell = at(row, 'value_date')
    if (typeof dateCell === 'string' && SERVICE_ROW.test(dateCell)) {
      out.skipped++
      continue
    }

    // The amount and its direction.
    let amount: number | null = null
    let debit = false
    let amountError: RowErrorReason | null = null
    let amountRaw: Cell
    if (mapping.amount_layout === 'split') {
      const credit = at(row, 'credit')
      const debitCell = at(row, 'debit')
      const c = isBlank(credit) ? null : parseAmount(credit, mapping.decimal_separator)
      const d = isBlank(debitCell) ? null : parseAmount(debitCell, mapping.decimal_separator)
      amountRaw = isBlank(credit) ? debitCell : credit
      if (!isBlank(credit) && c === null) amountError = 'amountInvalid'
      else if (c !== null && c > 0) amount = c
      else if (c !== null && c < 0) debit = true
      else if (!isBlank(debitCell) && d === null) amountError = 'amountInvalid'
      else if (d !== null && d !== 0) debit = true
      else amountError = c === 0 || d === 0 ? 'amountZero' : 'amountMissing'
    } else {
      amountRaw = at(row, 'amount')
      const a = isBlank(amountRaw) ? null : parseAmount(amountRaw, mapping.decimal_separator)
      if (isBlank(amountRaw)) amountError = 'amountMissing'
      else if (a === null) amountError = 'amountInvalid'
      else if (a === 0) amountError = 'amountZero'
      else if (a < 0) debit = true
      else amount = a
    }

    if (debit) {
      if (mapping.skip_debits) out.debits++
      else out.errors.push({ line_no, reason: 'debit', value: cellText(amountRaw) || null })
      continue
    }

    const value_date = isBlank(dateCell) ? null : parseDate(dateCell, mapping.date_format)
    if (value_date === null) {
      out.errors.push({ line_no, reason: isBlank(dateCell) ? 'dateMissing' : 'dateInvalid', value: cellText(dateCell) || null })
      continue
    }
    if (amountError || amount === null) {
      out.errors.push({ line_no, reason: amountError ?? 'amountMissing', value: cellText(amountRaw) || null })
      continue
    }
    const currencyCell = col('currency') >= 0 ? at(row, 'currency') : null
    const currency = col('currency') >= 0 && !isBlank(currencyCell) ? normalizeCurrency(currencyCell) : mapping.fixed_currency
    if (!currency) {
      const blank = isBlank(currencyCell)
      out.errors.push({ line_no, reason: blank ? 'currencyMissing' : 'currencyInvalid', value: cellText(currencyCell) || null })
      continue
    }

    out.lines.push({
      line_no,
      value_date,
      amount,
      currency,
      purpose: textField(at(row, 'purpose')),
      reference: textField(at(row, 'reference')),
      payer: textField(at(row, 'payer')),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------

export interface StatementSheet {
  /** Row i is sheet row i + 1; column j is sheet column `columnLetter(j)`. */
  rows: Cell[][]
}

export const STATEMENT_FILE_TYPES = '.csv,.txt,.xlsx,.xls'

/** A text file's characters: UTF-8 (with or without a byte-order mark), or
 * Windows-1251 when it is not valid UTF-8 — what banks in the region export. */
export function decodeText(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  } catch {
    return new TextDecoder('windows-1251').decode(bytes)
  }
}

/**
 * The first sheet that holds anything, as rows of raw cells. A text file is
 * decoded first and read as text (values are NOT interpreted: «05.10.2026»
 * and «1 250,00» stay strings for parseDate / parseAmount); a workbook keeps
 * its numbers and its date serials. The reader is loaded on first use.
 */
export async function readStatementFile(data: ArrayBuffer, fileName: string): Promise<StatementSheet> {
  const XLSX = await import('xlsx')
  const text = /\.(csv|txt|tsv)$/i.test(fileName)
  const book = text ? XLSX.read(decodeText(data), { type: 'string', raw: true }) : XLSX.read(data, { type: 'array' })
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name]
    if (!sheet || !sheet['!ref']) continue
    const range = XLSX.utils.decode_range(sheet['!ref'])
    const body = XLSX.utils.sheet_to_json<Cell[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true })
    if (!body.some((r) => r.some((c) => !isBlank(c)))) continue
    const lead: Cell[] = Array.from({ length: range.s.c }, () => null)
    const rows: Cell[][] = [
      ...Array.from({ length: range.s.r }, () => [] as Cell[]),
      ...body.map((r) => [...lead, ...r]),
    ]
    return { rows }
  }
  return { rows: [] }
}
