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
  return value < 0 ? `-${body}` : body
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

export { EM_DASH }
