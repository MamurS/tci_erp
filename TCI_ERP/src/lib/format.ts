/**
 * Number formatting per DESIGN.md. Null renders as an em dash, never as 0.
 * This module is the ONLY number formatter in the app.
 *
 * Separators (owner's decision, 2026-10-21): thousands are grouped with a
 * comma and decimals take a point — 1,000,000.50 — in every UI language,
 * on screen, in reports and while typing (components/ui/amount.ts reads the
 * same two constants). Before that ru/uz used a space and a decimal comma.
 */

const EM_DASH = '—'

export const THOUSANDS_SEPARATOR = ','
export const DECIMAL_SEPARATOR = '.'

function groupThousands(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS_SEPARATOR)
}

/** Format a monetary/statement amount. Default 0 decimals. */
export function formatAmount(
  value: number | null | undefined,
  // Kept for the callers: separators no longer depend on the language.
  _locale: string,
  decimals = 0,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH
  const abs = Math.abs(value)
  const fixed = abs.toFixed(decimals)
  const [intPart, fracPart] = fixed.split('.')
  const grouped = groupThousands(intPart)
  const body = fracPart ? `${grouped}${DECIMAL_SEPARATOR}${fracPart}` : grouped
  // A value that rounds to zero is zero: never print "-0.00".
  return value < 0 && /[1-9]/.test(fixed) ? `-${body}` : body
}

/**
 * An amount in a generated LEGAL document (policy wording): the notation of
 * the document's language, as contracts in Uzbekistan are written — a space
 * between thousands and a decimal comma in ru/uz (1 000 000,00), the comma
 * and point in en. The screens use formatAmount.
 */
export function formatDocumentAmount(value: number | null | undefined, locale: string, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH
  const national = locale === 'ru' || locale === 'uz'
  const body = formatAmount(value, locale, decimals)
  if (!national) return body
  return body.replace(/[,.]/g, (ch) => (ch === THOUSANDS_SEPARATOR ? '\u00a0' : ','))
}

/** Percentages: 1 decimal place. `value` is a fraction (0.153 -> "15.3%"). */
export function formatPercent(
  value: number | null | undefined,
  locale: string,
  decimals = 1,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH
  return `${formatAmount(value * 100, locale, decimals)}%`
}

/** A premium RATE stored as a percentage (tci policies keep 0.18 for 0.18%),
 * to three significant decimals: 0.18 -> "0.18%", 0.125 -> "0.125%". Never
 * pass it to formatPercent, which expects a fraction and shows 18%. */
export function formatRate(pct: number | string | null | undefined, locale: string): string {
  const value = pct === null || pct === undefined || pct === '' ? null : Number(pct)
  if (value === null || !Number.isFinite(value)) return EM_DASH
  const decimals = Math.round(value * 1000) % 10 !== 0 ? 3 : 2
  return `${formatAmount(value, locale, decimals)}%`
}

/** Ratio value like 1.63 (2 decimals). */
export function formatRatio(value: number | null | undefined, locale: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH
  return formatAmount(value, locale, 2)
}

/** Whole days. */
export function formatDays(value: number | null | undefined, locale: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH
  return formatAmount(value, locale, 0)
}

export const UZ_MONTHS_SHORT = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek']

function tashkentParts(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: 'numeric',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Tashkent',
  }).formatToParts(date)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { year: part('year'), month: Number(part('month')), day: part('day'), time: `${part('hour')}:${part('minute')}` }
}

/**
 * THE screen date: day, short month, year — "05 Oct 2026" / "05 окт. 2026" /
 * "05-okt 2026". One format everywhere, never ISO in one cell and dd/mm in
 * the next; the month is spelled so 05/10 and 10/05 cannot be confused. A
 * plain ISO date ("2026-10-05") is a calendar date and is shown as written.
 */
export function formatDate(value: string | Date | null | undefined, locale: string): string {
  if (value === null || value === undefined || value === '') return EM_DASH
  const plain = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date = typeof value === 'string' ? new Date(plain ? `${value}T12:00:00+05:00` : value) : value
  if (Number.isNaN(date.getTime())) return EM_DASH
  const { year, month, day } = tashkentParts(date)
  if (locale === 'uz') return `${day}-${UZ_MONTHS_SHORT[month - 1]} ${year}`
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Tashkent',
  })
    .format(date)
    .replace(/\s?г\.$/, '')
}

export const UZ_MONTHS_LONG = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr']

/**
 * A reporting period as a person names it: a calendar month is "September
 * 2026" / "сентябрь 2026" / "2026-yil sentabr", a calendar quarter "Q3 2026" /
 * "III кв. 2026" / "2026-yil III chorak", anything else a date range.
 */
export function formatPeriod(start: string, end: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-01$/.exec(start)
  const e = /^(\d{4})-(\d{2})-(\d{2})$/.exec(end)
  if (m && e) {
    const year = Number(m[1])
    const month = Number(m[2])
    const lastDay = (y: number, mo: number) => new Date(Date.UTC(y, mo, 0)).getUTCDate()
    const span = (Number(e[1]) - year) * 12 + Number(e[2]) - month
    const endsMonth = Number(e[3]) === lastDay(Number(e[1]), Number(e[2]))
    if (endsMonth && span === 0) {
      if (locale === 'uz') return `${year}-yil ${UZ_MONTHS_LONG[month - 1]}`
      return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
        .format(new Date(Date.UTC(year, month - 1, 15)))
        .replace(/\s?г\.$/, '')
    }
    if (endsMonth && span === 2 && (month - 1) % 3 === 0) {
      const q = (month - 1) / 3 + 1
      const roman = ['I', 'II', 'III', 'IV'][q - 1]
      if (locale === 'ru') return `${roman} кв. ${year}`
      if (locale === 'uz') return `${year}-yil ${roman} chorak`
      return `Q${q} ${year}`
    }
  }
  return `${formatDate(start, locale)} — ${formatDate(end, locale)}`
}

/** Date-time as an Asia/Tashkent reader sees it (DESIGN.md: store UTC,
 * display Tashkent), minute precision, in the formatDate style. */
export function formatMoment(value: string | Date, locale: string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return EM_DASH
  return `${formatDate(date, locale)}, ${tashkentParts(date).time}`
}

/** A deadline: a timestamp at UTC midnight is a calendar DATE that was stored
 * as a timestamp (an instalment due, a declaration due), and showing it as
 * "05:00" Tashkent time is noise — it is shown as a date. Anything else keeps
 * its time. */
export function formatDue(value: string, locale: string): string {
  return /T00:00(:00(\.0+)?)?(Z|\+00(:00)?)$/.test(value) ? formatDate(value, locale) : formatMoment(value, locale)
}

export { EM_DASH }

const COMPACT_STEPS: { min: number; suffix: Record<'en' | 'ru' | 'uz', string> }[] = [
  { min: 1e12, suffix: { en: 'T', ru: ' трлн', uz: ' trln' } },
  { min: 1e9, suffix: { en: 'B', ru: ' млрд', uz: ' mlrd' } },
  { min: 1e6, suffix: { en: 'M', ru: ' млн', uz: ' mln' } },
  { min: 1e3, suffix: { en: 'K', ru: ' тыс.', uz: ' ming' } },
]

/**
 * Compact amount for prose and key figures: 261 369 829 000 → "261.37B"
 * (en) / "261,37 млрд" (ru) / "261,37 mlrd" (uz). Below 1 000 the plain
 * amount. Null renders as an em dash, never as 0.
 */
export function formatCompact(
  value: number | null | undefined,
  locale: string,
  decimals = 2,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH
  const lang = locale === 'ru' || locale === 'uz' ? locale : 'en'
  const abs = Math.abs(value)
  const step = COMPACT_STEPS.find((s) => abs >= s.min)
  if (!step) return formatAmount(value, locale, 0)
  return `${formatAmount(value / step.min, locale, decimals)}${step.suffix[lang]}`
}

/** Calendar date for documents: "05 October 2026" / "05 октября 2026 г.",
 * as an Asia/Tashkent reader sees it. */
const UZ_MONTHS = [
  'yanvar',
  'fevral',
  'mart',
  'aprel',
  'may',
  'iyun',
  'iyul',
  'avgust',
  'sentabr',
  'oktabr',
  'noyabr',
  'dekabr',
]

export function formatLongDate(value: string | Date, locale: string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return EM_DASH
  if (locale === 'uz') {
    // Browsers ship no uz month names (Chromium prints "2026 M10 19").
    const parts = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: 'numeric',
      year: 'numeric',
      timeZone: 'Asia/Tashkent',
    }).formatToParts(date)
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
    return `${part('year')}-yil ${part('day')}-${UZ_MONTHS[Number(part('month')) - 1]}`
  }
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Tashkent',
  }).format(date)
}

/** A relative change with its sign: +47%, −9.6% (one decimal below 10%). */
export function formatSignedPercent(value: number, locale: string, decimals = 0): string {
  const abs = Math.abs(value)
  const body = formatPercent(abs, locale, abs < 0.1 ? 1 : decimals)
  // The sign belongs to the number SHOWN: a change that rounds to 0.0% is no
  // change, never "−0.0%" (DESIGN.md: no signed zero).
  if (isZeroChange(value)) return body
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${body}`
}

/** True when a relative change (a fraction) shows as 0.0%: it gets no sign,
 * no arrow and no colour. */
export function isZeroChange(value: number | null | undefined): boolean {
  return value !== null && value !== undefined && Math.round(Math.abs(value) * 1000) === 0
}
