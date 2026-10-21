/** Snooze arithmetic and wording (pure). */

import type { TFunction } from 'i18next'

import { todayIso } from '../../components/ui/dateEntry'
import { formatDue } from '../../lib/format'
import type { StaffMember } from '../data/types'
import type { Task } from './types'

export const TASHKENT = '+05:00'

/** Monday 00:00 Tashkent of next week. */
export function nextMonday(now: Date): Date {
  const today = todayIso(now)
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7 // Monday = 0
  const monday = new Date(Date.parse(`${today}T00:00:00Z`) + (7 - weekday) * 86_400_000).toISOString().slice(0, 10)
  return new Date(`${monday}T00:00:00${TASHKENT}`)
}

export function snoozedText(
  task: Pick<Task, 'snoozed_until' | 'snoozed_by'>,
  t: TFunction,
  locale: string,
  staff: Map<string, StaffMember> | undefined,
): string | null {
  if (!task.snoozed_until) return null
  const by = task.snoozed_by ? staff?.get(task.snoozed_by) : undefined
  const who = by ? (by.full_name?.trim() || by.email) : null
  return t(who ? 'agenda.snooze.untilBy' : 'agenda.snooze.untilOnly', {
    moment: formatDue(task.snoozed_until, locale),
    name: who ?? '',
  })
}
