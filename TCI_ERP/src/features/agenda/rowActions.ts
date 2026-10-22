/** The overflow menu of a row (pure): comment, open the object, bring a
 * snoozed task back, and «done» only for the manual types. */

import type { MenuAction } from '../../components/ui'
import type { AgendaRow } from './board'
import { canCompleteByHand, isSnoozed, taskLink } from './catalogue'

export interface RowActionHandlers {
  now: Date
  setCommentingKey: (key: string | null) => void
  onComplete: (row: AgendaRow) => void
  onUnsnooze: (row: AgendaRow) => void
}

export function rowActions(
  row: AgendaRow,
  ctx: RowActionHandlers,
  t: (key: string) => string,
  navigate: (to: string) => void,
): MenuAction[] {
  const object = taskLink({ ...row.lead, task_type: row.lead.task_type })
  const actions: MenuAction[] = [
    { key: 'comment', label: t('agenda.comments.add'), onSelect: () => ctx.setCommentingKey(row.key) },
  ]
  if (object) actions.push({ key: 'object', label: t('agenda.openObject'), onSelect: () => navigate(object) })
  if (row.tasks.some((task) => isSnoozed(task, ctx.now)))
    actions.push({ key: 'unsnooze', label: t('agenda.snooze.undo'), onSelect: () => ctx.onUnsnooze(row) })
  if (canCompleteByHand(row.lead.task_type))
    actions.push({ key: 'done', label: t('agenda.markDone'), onSelect: () => ctx.onComplete(row) })
  return actions
}

