/**
 * NOA lateness — pure mirror of tci.noa_deadline and the derivations in
 * tci.v_overdue_notifications (migration 0028).
 *
 * This exists so the portal can warn the policyholder BEFORE they file, not
 * after. A late notification can prejudice cover, which is the single most
 * expensive thing a policyholder can do by accident.
 *
 * Lateness is judged at the REPORTING date, never at today: an NOA filed on
 * time does not become late because the file stayed open.
 */

import type { NoaStatus } from './types'

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function diffDays(later: string, earlier: string): number {
  const a = Date.parse(`${later.slice(0, 10)}T00:00:00Z`)
  const b = Date.parse(`${earlier.slice(0, 10)}T00:00:00Z`)
  return Math.round((a - b) / 86_400_000)
}

/** The last day an overdue account can be notified without prejudicing cover. */
export function noaDeadline(
  firstDueDate: string,
  maxExtensionPeriodDays: number | null,
  noaWindowDays: number | null,
): string {
  return addDays(firstDueDate, (maxExtensionPeriodDays ?? 0) + (noaWindowDays ?? 0))
}

export function daysPastDue(firstDueDate: string, today: string): number {
  return diffDays(today, firstDueDate)
}

/** Would a filing made on `reportedOn` be late? */
export function isReportedLate(
  firstDueDate: string,
  maxExtensionPeriodDays: number | null,
  noaWindowDays: number | null,
  reportedOn: string,
): boolean {
  return reportedOn.slice(0, 10) > noaDeadline(firstDueDate, maxExtensionPeriodDays, noaWindowDays)
}

export function daysLate(
  firstDueDate: string,
  maxExtensionPeriodDays: number | null,
  noaWindowDays: number | null,
  reportedOn: string,
): number {
  return diffDays(reportedOn, noaDeadline(firstDueDate, maxExtensionPeriodDays, noaWindowDays))
}

/** Only an open notification can be resolved, and never back to open —
 * mirrors tci.resolve_overdue_notification. */
export function canResolve(status: NoaStatus): boolean {
  return status === 'open'
}

export const RESOLUTION_STATUSES: readonly NoaStatus[] = [
  'resolved_paid',
  'escalated_to_claim',
  'withdrawn',
]
