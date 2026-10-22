/**
 * Formatting for the commercial offer DOCUMENT (src/features/offers/kp). Pure:
 * no DOM, no i18n instance — the renderer is a function of its inputs, so a
 * future server-side PDF can repeat it value for value.
 *
 * Every value that reaches HTML goes through escapeHtml(), including numbers
 * already formatted. Numbers and dates are formatted only from TYPED values
 * (a number, an ISO date); anything else prints the em dash, never a raw
 * string from the data. Amounts use the document's own notation
 * (formatDocumentAmount: «1 000 000,50» in ru/uz, «1,000,000.50» in en), the
 * same rule as the generated policy wording.
 */

import { EM_DASH, formatDocumentAmount, formatLongDate } from '../../../lib/format'

export type DocLang = 'ru' | 'en' | 'uz'

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** The ONLY way a dynamic value enters the offer's HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch)
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** A plain trimmed string from the data, or null (an empty string is null). */
export function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/** An amount: whole numbers without decimals, otherwise two. */
export function docAmount(v: unknown, lang: DocLang): string {
  if (!isNumber(v)) return EM_DASH
  return formatDocumentAmount(v, lang, Number.isInteger(v) ? 0 : 2)
}

/** An amount with its currency code after it («1 000 000 USD»). */
export function docMoney(v: unknown, lang: DocLang, currency: unknown): string {
  if (!isNumber(v)) return EM_DASH
  const ccy = text(currency)
  return ccy ? `${docAmount(v, lang)}\u00a0${ccy}` : docAmount(v, lang)
}

/** A percentage stored as a percentage (90 → «90%», 87.5 → «87,5%»). */
export function docPercent(v: unknown, lang: DocLang): string {
  if (!isNumber(v)) return EM_DASH
  const decimals = Number.isInteger(v) ? 0 : Math.round(v * 100) % 10 === 0 ? 1 : 2
  return `${formatDocumentAmount(v, lang, decimals)}%`
}

/** A premium RATE stored as a percentage of turnover, to three significant
 * decimals as formatRate does: 0.18 → «0,18%», 0.125 → «0,125%». */
export function docRate(v: unknown, lang: DocLang): string {
  if (!isNumber(v)) return EM_DASH
  const decimals = Math.round(v * 1000) % 10 !== 0 ? 3 : 2
  return `${formatDocumentAmount(v, lang, decimals)}%`
}

/** Days with the language's own plural: «90 дней», «1 day», «90 kun». */
export function docDays(v: unknown, lang: DocLang): string {
  if (!isNumber(v) || !Number.isInteger(v)) return EM_DASH
  const n = formatDocumentAmount(v, lang, 0)
  if (lang === 'en') return `${n}\u00a0${v === 1 ? 'day' : 'days'}`
  if (lang === 'uz') return `${n}\u00a0kun`
  const mod10 = v % 10
  const mod100 = v % 100
  const word =
    mod10 === 1 && mod100 !== 11 ? 'день' : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? 'дня' : 'дней'
  return `${n}\u00a0${word}`
}

/** A calendar date in words, in Tashkent: «22 октября 2026 г.», «22 October
 * 2026», «2026-yil 22-oktabr». Only an ISO date or timestamp is accepted. */
export function docDate(v: unknown, lang: DocLang): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return EM_DASH
  // A plain date is the day in Tashkent: anchor it at noon there.
  const value = /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00+05:00` : v
  return formatLongDate(value, lang)
}

/** A whole count with the document's grouping (12, «1 200»). */
export function docCount(v: unknown, lang: DocLang): string {
  if (!isNumber(v) || !Number.isInteger(v)) return EM_DASH
  return formatDocumentAmount(v, lang, 0)
}

export { EM_DASH }
