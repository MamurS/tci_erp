/**
 * Number formatting per DESIGN.md: space thousands separator with decimal
 * comma for ru/uz, standard en formatting for en. Null renders as an em
 * dash, never as 0. This module is the ONLY number formatter in the app.
 */

const EM_DASH = '—'

function groupThousands(intPart: string, separator: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, separator)
}

/** Format a monetary/statement amount. Default 0 decimals. */
export function formatAmount(
  value: number | null | undefined,
  locale: string,
  decimals = 0,
): string {
  if (value === null || value === undefined || Number.isNaN(value)) return EM_DASH
  const isRuUz = locale === 'ru' || locale === 'uz'
  const abs = Math.abs(value)
  const fixed = abs.toFixed(decimals)
  const [intPart, fracPart] = fixed.split('.')
  const grouped = groupThousands(intPart, isRuUz ? ' ' : ',')
  const decimalSep = isRuUz ? ',' : '.'
  const body = fracPart ? `${grouped}${decimalSep}${fracPart}` : grouped
  // A value that rounds to zero is zero: never print "-0.00".
  return value < 0 && /[1-9]/.test(fixed) ? `-${body}` : body
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

/** Date-time as an Asia/Tashkent reader sees it (DESIGN.md: store UTC,
 * display Tashkent), minute precision. */
export function formatMoment(value: string | Date, locale: string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return EM_DASH
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Tashkent',
  }).format(date)
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
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${body}`
}
