/**
 * Admin › Риски › the OECD Country Risk Classification import (migration
 * 0085, tci.import_country_risk) — the pure reading of a file.
 *
 * The accepted format (said on the card too):
 *   * CSV (comma, semicolon or tab; UTF-8 with or without a byte-order mark,
 *     or Windows-1251) or an Excel workbook (.xlsx / .xls, its first sheet
 *     that holds anything);
 *   * a header row — lines above it (a title, «Valid as of 28 June 2026»)
 *     are allowed and are where the file's date is looked for;
 *   * a column of ISO 3166-1 ALPHA-2 codes (UZ, DE) — headers such as
 *     «code», «ISO», «country_code», «Код» — and a column of OECD categories
 *     0–7, whole numbers — «category», «classification», «Категория»; any
 *     other column is ignored;
 *   * «-», «—», «n/a» or an empty category = the country is NOT CLASSIFIED:
 *     it is left out of the import (the database reads a country missing from
 *     the list as not classified, never as 0) and counted.
 * Alpha-3 codes (UZB) are refused by name: the reference list holds alpha-2
 * codes only, and guessing a mapping is not worth a wrong category.
 *
 * Nothing here talks to the server; the server still refuses unknown codes,
 * bad categories and duplicates by itself (0085).
 */

export const OECD_FILE_TYPES = '.csv,.txt,.xlsx,.xls'

/** One classified country of the file. `row` is the spreadsheet row (1-based). */
export interface OecdRow {
  row: number
  country_code: string
  category: number
  warnings: OecdWarning[]
}

/** Non-blocking: the row is imported, as shown. */
export type OecdWarning = 'lowercase'

export type OecdErrorKind =
  | 'empty'
  | 'no_code_column'
  | 'no_category_column'
  | 'code_missing'
  | 'code_invalid'
  | 'alpha3'
  | 'category_invalid'
  | 'duplicate'

export interface OecdError {
  kind: OecdErrorKind
  /** The spreadsheet row (1-based); absent for a file-level problem. */
  row?: number
  /** The cell as written. */
  value?: string
  /** For a duplicate: the code and where it first appeared. */
  code?: string
  firstRow?: number
}

export interface OecdParse {
  rows: OecdRow[]
  errors: OecdError[]
  /** Countries in the file with no category («-», empty): not classified, left out. */
  skipped: number
  skippedCodes: string[]
  /** The header row's index in `rows` (0-based), or null when none was found. */
  headerIndex: number | null
}

// ---------------------------------------------------------------------------
// Cells and headers
// ---------------------------------------------------------------------------

function cellText(cell: unknown): string {
  if (cell === null || cell === undefined) return ''
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? '' : isoOfLocalDate(cell)
  return String(cell).replace(/^\uFEFF/, '').trim()
}

function normaliseHeader(cell: unknown): string {
  return cellText(cell)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/["'«»:]/g, '')
    .replace(/[\s_\-./()]+/g, ' ')
    .trim()
}

const CODE_EXACT = new Set([
  'code',
  'iso',
  'iso code',
  'iso2',
  'iso 2',
  'iso alpha 2',
  'iso 3166',
  'iso 3166 1',
  'alpha 2',
  'alpha2',
  'alpha 2 code',
  'country code',
  'iso country code',
  'country iso',
  'country iso code',
  'cc',
  'код',
  'код страны',
  'iso код',
  'код iso',
  'kod',
  'mamlakat kodi',
])
const CODE_CONTAINS = ['iso', 'code', 'код', 'kod']

const CATEGORY_EXACT = new Set([
  'category',
  'classification',
  'oecd category',
  'oecd classification',
  'country risk category',
  'country risk classification',
  'prevailing classification',
  'current classification',
  'risk category',
  'crc',
  'категория',
  'классификация',
  'категория оэср',
  'категория риска',
  'toifa',
  'ihtt toifasi',
])
const CATEGORY_CONTAINS = ['categor', 'classif', 'категор', 'классиф', 'toifa']

/** How strongly a header names the code (2 exact, 1 contains, 0 not). */
function codeScore(h: string): number {
  if (!h) return 0
  if (CODE_EXACT.has(h)) return 2
  // «classification code» names the category first.
  if (CATEGORY_CONTAINS.some((w) => h.includes(w))) return 0
  return CODE_CONTAINS.some((w) => h.includes(w)) ? 1 : 0
}

function categoryScore(h: string): number {
  if (!h) return 0
  if (CATEGORY_EXACT.has(h)) return 2
  return CATEGORY_CONTAINS.some((w) => h.includes(w)) ? 1 : 0
}

/** The best-scoring column (earliest on a tie), or -1. */
function bestColumn(headers: string[], score: (h: string) => number, except = -1): number {
  let best = -1
  let bestScore = 0
  headers.forEach((h, i) => {
    if (i === except) return
    const s = score(h)
    if (s > bestScore) {
      best = i
      bestScore = s
    }
  })
  return best
}

/** How far down a header row is looked for (a title block above it is fine). */
const HEADER_SCAN = 30

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** A category cell that says «not classified». */
const UNCLASSIFIED = new Set([
  '',
  '-',
  '–',
  '—',
  '−',
  'n/a',
  'na',
  'n a',
  'n.a.',
  'nc',
  'not classified',
  'unclassified',
  'не классифицирована',
  'не классифицирован',
  'нет',
  'tasniflanmagan',
])

function isUnclassified(cell: unknown): boolean {
  return UNCLASSIFIED.has(cellText(cell).toLowerCase())
}

/** A whole category 0–7, or null. «3», 3, «3.0» and «3,0» are 3. */
export function parseCategory(cell: unknown): number | null {
  if (typeof cell === 'number') return Number.isInteger(cell) && cell >= 0 && cell <= 7 ? cell : null
  const text = cellText(cell).replace(',', '.')
  const m = /^(\d+)(?:\.0+)?$/.exec(text)
  if (!m) return null
  const n = Number.parseInt(m[1]!, 10)
  return n >= 0 && n <= 7 ? n : null
}

// ---------------------------------------------------------------------------
// The file
// ---------------------------------------------------------------------------

/**
 * The classification out of a sheet's rows (cells as read: strings,
 * numbers, dates, null). Finds the header row, reads every row below it,
 * and reports every problem at once instead of stopping at the first.
 */
export function parseOecdRows(rows: readonly (readonly unknown[])[]): OecdParse {
  const out: OecdParse = { rows: [], errors: [], skipped: 0, skippedCodes: [], headerIndex: null }
  if (!rows.some((r) => r.some((c) => cellText(c) !== ''))) {
    out.errors.push({ kind: 'empty' })
    return out
  }

  let codeCol = -1
  let categoryCol = -1
  let sawCode = false
  for (let i = 0; i < Math.min(rows.length, HEADER_SCAN); i++) {
    const headers = (rows[i] ?? []).map(normaliseHeader)
    const category = bestColumn(headers, categoryScore)
    const code = bestColumn(headers, codeScore, category)
    if (code >= 0) sawCode = true
    if (code >= 0 && category >= 0) {
      out.headerIndex = i
      codeCol = code
      categoryCol = category
      break
    }
  }
  if (out.headerIndex === null) {
    out.errors.push({ kind: sawCode ? 'no_category_column' : 'no_code_column' })
    return out
  }

  const seen = new Map<string, number>()
  const remember = (code: string, row: number): boolean => {
    const first = seen.get(code)
    if (first !== undefined) {
      out.errors.push({ kind: 'duplicate', row, code, firstRow: first })
      return false
    }
    seen.set(code, row)
    return true
  }

  for (let i = out.headerIndex + 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    const row = i + 1
    const rawCode = cellText(r[codeCol])
    const catCell = r[categoryCol]
    const noCategory = isUnclassified(catCell)
    if (!rawCode && noCategory) continue // a blank row, or a note in another column
    if (!rawCode) {
      out.errors.push({ kind: 'code_missing', row, value: cellText(catCell) })
      continue
    }
    const code = rawCode.toUpperCase()
    if (!/^[A-Z]{2}$/.test(code)) {
      if (/^[A-Z]{3}$/.test(code)) out.errors.push({ kind: 'alpha3', row, value: rawCode })
      // A line of text under the table (a footnote) has no category: not a country.
      else if (!noCategory) out.errors.push({ kind: 'code_invalid', row, value: rawCode })
      continue
    }
    if (!remember(code, row)) continue
    if (noCategory) {
      out.skipped += 1
      out.skippedCodes.push(code)
      continue
    }
    const category = parseCategory(catCell)
    if (category === null) {
      out.errors.push({ kind: 'category_invalid', row, value: cellText(catCell), code })
      continue
    }
    out.rows.push({
      row,
      country_code: code,
      category,
      warnings: rawCode === code ? [] : ['lowercase'],
    })
  }
  if (out.rows.length === 0 && out.errors.length === 0) out.errors.push({ kind: 'empty' })
  return out
}

/** What tci.import_country_risk takes. */
export function importPayload(parse: OecdParse): { country_code: string; category: number }[] {
  return parse.rows.map((r) => ({ country_code: r.country_code, category: r.category }))
}

/** The codes of the file the reference list does not hold (the server
 * refuses them by name too — this says so before anything is sent). */
export function unknownCodes(parse: OecdParse, known: ReadonlySet<string>): string[] {
  return [...parse.rows.map((r) => r.country_code), ...parse.skippedCodes].filter((c) => !known.has(c))
}

/** The codes a refusal named (`country_import_unknown` carries them in its
 * detail, comma-separated). */
export function refusedCodes(error: unknown): string[] {
  const e = error as { message?: unknown; details?: unknown } | null
  const source =
    typeof e?.details === 'string' && e.details
      ? e.details
      : typeof e?.message === 'string'
        ? e.message.replace(/^.*?:\s*/, '')
        : ''
  return source
    .split(/[,\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z0-9]{1,8}$/.test(c))
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** The delimiter of a CSV text: Excel's «sep=;» line, else the commonest of
 * semicolon, tab and comma on the first line (a tie is a comma). */
function delimiterOf(text: string): { delimiter: string; skipFirst: boolean } {
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? ''
  const sep = /^sep=(.)$/i.exec(firstLine.trim())
  if (sep) return { delimiter: sep[1]!, skipFirst: true }
  const unquoted = firstLine.replace(/"[^"]*"/g, '')
  const count = (c: string) => unquoted.split(c).length - 1
  const candidates: [string, number][] = [
    [',', count(',')],
    [';', count(';')],
    ['\t', count('\t')],
  ]
  const [best] = candidates.reduce((a, b) => (b[1] > a[1] ? b : a))
  return { delimiter: best, skipFirst: false }
}

/** A CSV text as rows of strings: quoted fields («"a;b"», doubled quotes),
 * CRLF / LF / CR line ends, a byte-order mark dropped. */
export function parseCsvText(input: string): string[][] {
  let text = input.replace(/^\uFEFF/, '')
  const { delimiter, skipFirst } = delimiterOf(text)
  if (skipFirst) text = text.replace(/^[^\r\n]*(\r\n|\n|\r)?/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }
  while (i < text.length) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
      } else field += c
      i += 1
      continue
    }
    if (c === '"' && field === '') quoted = true
    else if (c === delimiter) endField()
    else if (c === '\r') {
      endRow()
      if (text[i + 1] === '\n') i += 1
    } else if (c === '\n') endRow()
    else field += c
    i += 1
  }
  if (field !== '' || row.length > 0) endRow()
  return rows
}

// ---------------------------------------------------------------------------
// The file's date
// ---------------------------------------------------------------------------

const EN_MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]
const RU_MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]

function monthIndex(name: string): number {
  const n = name.toLowerCase().replace(/\.$/, '')
  const en = EN_MONTHS.findIndex((m) => m === n || (n.length >= 3 && m.startsWith(n)))
  if (en >= 0) return en + 1
  const ru = RU_MONTHS.indexOf(n)
  return ru >= 0 ? ru + 1 : 0
}

function isoOf(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function isoOfLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The first date written in a piece of text: 2026-06-28, 28.06.2026,
 * 28/06/2026 (day first), «28 June 2026», «June 28, 2026», «28 июня 2026». */
export function dateInText(text: string): string | null {
  const patterns: [RegExp, (m: RegExpExecArray) => string | null][] = [
    [/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/, (m) => isoOf(+m[1]!, +m[2]!, +m[3]!)],
    [/(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)/, (m) => isoOf(+m[3]!, +m[2]!, +m[1]!)],
    [
      /(?<!\d)(\d{1,2})\s+([A-Za-zА-Яа-яЁё]{3,}\.?)\s+(\d{4})(?!\d)/,
      (m) => {
        const month = monthIndex(m[2]!)
        return month ? isoOf(+m[3]!, month, +m[1]!) : null
      },
    ],
    [
      /([A-Za-z]{3,}\.?)\s+(\d{1,2}),?\s+(\d{4})(?!\d)/,
      (m) => {
        const month = monthIndex(m[1]!)
        return month ? isoOf(+m[3]!, month, +m[2]!) : null
      },
    ],
  ]
  let found: { at: number; iso: string } | null = null
  for (const [re, toIso] of patterns) {
    const m = re.exec(text)
    if (!m) continue
    const iso = toIso(m)
    if (iso && (found === null || m.index < found.at)) found = { at: m.index, iso }
  }
  return found?.iso ?? null
}

/**
 * The file's own date, to suggest as the effective date: the first date in
 * the lines above the header row (a date cell of a workbook counts), else in
 * the file name. Null when there is none — the screen then suggests today.
 */
export function findFileDate(
  rows: readonly (readonly unknown[])[],
  headerIndex: number | null,
  fileName: string,
): string | null {
  const above = rows.slice(0, headerIndex ?? Math.min(rows.length, 5))
  for (const r of above)
    for (const cell of r) {
      if (cell instanceof Date && !Number.isNaN(cell.getTime())) return isoOfLocalDate(cell)
      const iso = dateInText(cellText(cell))
      if (iso) return iso
    }
  return dateInText(fileName.replace(/[_]+/g, ' '))
}

// ---------------------------------------------------------------------------
// Reading the bytes (the workbook reader is loaded on first use)
// ---------------------------------------------------------------------------

/** UTF-8 (with or without a byte-order mark), else Windows-1251. */
export function decodeCsvBytes(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
  } catch {
    return new TextDecoder('windows-1251').decode(bytes)
  }
}

/** The rows of a CSV text or of a workbook's first non-empty sheet. */
export async function readOecdFile(data: ArrayBuffer, fileName: string): Promise<unknown[][]> {
  if (/\.(csv|txt|tsv)$/i.test(fileName)) return parseCsvText(decodeCsvBytes(data))
  const XLSX = await import('xlsx')
  const book = XLSX.read(data, { type: 'array', cellDates: true })
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name]
    if (!sheet || !sheet['!ref']) continue
    const body = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: true })
    if (body.some((r) => r.some((c) => cellText(c) !== ''))) return body
  }
  return []
}
