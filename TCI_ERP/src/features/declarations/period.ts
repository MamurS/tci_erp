/**
 * Declaration period arithmetic — pure mirror of tci.declaration_period_start
 * and tci.declaration_period_end (migration 0029).
 *
 * The UI needs this to say "your July declaration is due" without a round
 * trip, and to normalise a period the same way the database does before
 * asking for one. A contract test locks it to the migration text.
 *
 * Dates are handled as plain YYYY-MM-DD strings on purpose: a declaration
 * period is a calendar fact, not an instant, so no timezone may touch it.
 */

import type { DeclarationFrequency } from './types'

function parse(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return { y, m, d }
}

function iso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** First day of the period containing `asOf`, at the policy frequency. */
export function periodStart(asOf: string, frequency: DeclarationFrequency): string {
  const { y, m } = parse(asOf)
  if (frequency === 'monthly') return iso(y, m, 1)
  const quarterFirstMonth = m - ((m - 1) % 3)
  return iso(y, quarterFirstMonth, 1)
}

/** Last day of the period that begins at `start`. */
export function periodEnd(start: string, frequency: DeclarationFrequency): string {
  const { y, m } = parse(start)
  const span = frequency === 'monthly' ? 1 : 3
  const endMonthIndex = m - 1 + span - 1
  const endYear = y + Math.floor(endMonthIndex / 12)
  const endMonth = (endMonthIndex % 12) + 1
  return iso(endYear, endMonth, daysInMonth(endYear, endMonth))
}

/** The most recently CLOSED period — the one a policyholder now owes. */
export function lastClosedPeriodStart(asOf: string, frequency: DeclarationFrequency): string {
  const current = periodStart(asOf, frequency)
  const { y, m } = parse(current)
  const span = frequency === 'monthly' ? 1 : 3
  const prevIndex = m - 1 - span
  const prevYear = y + Math.floor(prevIndex / 12)
  const prevMonth = ((prevIndex % 12) + 12) % 12 + 1
  return iso(prevYear, prevMonth, 1)
}

/** A period label the UI can show: "2026-07" monthly, "2026-Q3" quarterly. */
export function periodLabel(start: string, frequency: DeclarationFrequency): string {
  const { y, m } = parse(start)
  if (frequency === 'monthly') return `${y}-${String(m).padStart(2, '0')}`
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`
}
