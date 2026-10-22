/**
 * Date entry (pure, tested). A date is typed day first — 21.10.2026 in ru/uz,
 * 21/10/2026 in en (the British order, never the American) — whatever the
 * browser's own locale, and is kept as an ISO date (2026-10-21). The native
 * <input type="date"> showed «mm/dd/yyyy» in a Russian interface, where
 * «04/03/2026» reads as 4 March.
 */

import { UZ_MONTHS_LONG } from '../../lib/format'

export function dateSeparator(locale: string): string {
  return locale === 'en' ? '/' : '.'
}

/** The placeholder that shows the order: ДД.ММ.ГГГГ / KK.OO.YYYY / DD/MM/YYYY. */
export function datePattern(locale: string): string {
  if (locale === 'ru') return 'ДД.ММ.ГГГГ'
  if (locale === 'uz') return 'KK.OO.YYYY'
  return 'DD/MM/YYYY'
}

/** What was typed, reduced to digits and regrouped as DD.MM.YYYY so far. */
export function maskDate(typed: string, locale: string): string {
  const digits = typed.replace(/\D/g, '').slice(0, 8)
  const sep = dateSeparator(locale)
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean)
  // A separator appears as soon as its group is complete, so typing flows.
  let text = parts.join(sep)
  if (digits.length === 2 || digits.length === 4) text += sep
  return text
}

/** A complete, real date as ISO, or null (31.02.2026 is not a date). */
export function parseDate(masked: string): string | null {
  const digits = masked.replace(/\D/g, '')
  if (digits.length !== 8) return null
  const day = Number(digits.slice(0, 2))
  const month = Number(digits.slice(2, 4))
  const year = Number(digits.slice(4, 8))
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1) return null
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  return `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`
}

/** An ISO date shown for editing. */
export function isoToMasked(iso: string | null | undefined, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  if (!m) return ''
  const sep = dateSeparator(locale)
  return `${m[3]}${sep}${m[2]}${sep}${m[1]}`
}

export function todayIso(now: Date = new Date()): string {
  // Tashkent's calendar day (UTC+5, no DST), as every date in the product.
  const t = new Date(now.getTime() + 5 * 3600_000)
  return t.toISOString().slice(0, 10)
}

/** The 6×7 grid of a month, Monday first, as ISO dates (null outside the month). */
export function monthGrid(year: number, month0: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month0, 1))
  const lead = (first.getUTCDay() + 6) % 7 // Monday = 0
  const days = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
  const cells: (string | null)[] = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= days; d++) {
    cells.push(`${year}-${String(month0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  while (cells.length % 7) cells.push(null)
  return cells
}

/** «Октябрь 2026» / «Oktabr 2026» / «October 2026». */
export function monthTitle(year: number, month0: number, locale: string): string {
  if (locale === 'uz') {
    const name = UZ_MONTHS_LONG[month0] ?? ''
    return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`
  }
  const text = new Intl.DateTimeFormat(locale === 'ru' ? 'ru' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month0, 1)))
  // «октябрь 2026 г.» → «Октябрь 2026»
  const clean = text.replace(/\s*г\.$/, '')
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

const WEEKDAYS: Record<string, string[]> = {
  ru: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  uz: ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'],
  en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
}

export function weekdayNames(locale: string): string[] {
  return WEEKDAYS[locale] ?? WEEKDAYS.en!
}
