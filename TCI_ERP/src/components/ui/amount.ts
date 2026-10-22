/**
 * Amount entry (pure, tested): what the person typed becomes a grouped
 * display (1,000,000.50) while the value kept is a plain decimal string
 * ("1000000.50") that parses without surprises. The separators are the
 * application's own (format.ts), so a typed amount looks exactly like the
 * same amount in a table.
 */

import { DECIMAL_SEPARATOR, THOUSANDS_SEPARATOR } from '../../lib/format'

/**
 * The plain value of what was typed or pasted: digits, at most one decimal
 * point and `decimals` places, an optional leading minus. Grouping
 * separators and spaces are dropped; a comma counts as the decimal mark only
 * when it is plainly one ("1234,5" — a European paste), never in "1,234".
 */
export function cleanAmount(input: string, decimals = 2, allowNegative = false): string {
  let text = input.replace(/[\s\u00a0\u202f']/g, '')
  const negative = allowNegative && text.trim().startsWith('-')
  if (!text.includes(DECIMAL_SEPARATOR) && /^-?\d+,\d{1,2}$/.test(text)) text = text.replace(',', DECIMAL_SEPARATOR)
  text = text.split(THOUSANDS_SEPARATOR).join('')
  const [intRaw = '', ...rest] = text.split(DECIMAL_SEPARATOR)
  const intPart = intRaw.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  const hasPoint = decimals > 0 && rest.length > 0
  const frac = hasPoint ? rest.join('').replace(/\D/g, '').slice(0, decimals) : ''
  const body = hasPoint ? `${intPart || '0'}${DECIMAL_SEPARATOR}${frac}` : intPart
  return negative && body ? `-${body}` : body
}

/** The grouped display of a plain value; a trailing point stays while typing. */
export function groupAmount(plain: string): string {
  if (!plain) return ''
  const negative = plain.startsWith('-')
  const [intPart = '', frac] = (negative ? plain.slice(1) : plain).split(DECIMAL_SEPARATOR)
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, THOUSANDS_SEPARATOR)
  return `${negative ? '-' : ''}${grouped}${frac !== undefined ? `${DECIMAL_SEPARATOR}${frac}` : ''}`
}

/** The number a plain value stands for, or null when nothing was entered. */
export function parseAmount(plain: string): number | null {
  if (!plain || plain === '-') return null
  const n = Number(plain)
  return Number.isFinite(n) ? n : null
}

/** A number (from the database) as the plain value the input edits. */
export function amountToPlain(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return ''
  return String(n)
}

/**
 * Where the caret goes after regrouping: after the same number of
 * significant characters (digits and the point) it was after before.
 */
export function caretAfterGrouping(display: string, significantBefore: number): number {
  if (significantBefore <= 0) return display.startsWith('-') ? 1 : 0
  let seen = 0
  for (let i = 0; i < display.length; i++) {
    if (/\d/.test(display[i]!) || display[i] === DECIMAL_SEPARATOR) seen++
    if (seen === significantBefore) return i + 1
  }
  return display.length
}

/** How many significant characters (digits, the point) precede position `at`. */
export function significantBefore(text: string, at: number): number {
  let n = 0
  for (let i = 0; i < Math.min(at, text.length); i++) {
    if (/\d/.test(text[i]!) || text[i] === DECIMAL_SEPARATOR) n++
  }
  return n
}
