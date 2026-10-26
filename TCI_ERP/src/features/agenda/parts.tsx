/**
 * The small pieces every Agenda row and the triage panel share: the type
 * tag, the due label, the owner avatar, the snooze menu and the comment
 * composer. Used only by the Agenda.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Users, Zap } from 'lucide-react'

import { ActionsMenu, Button, DateInput, Field, Modal, Textarea, badgeClassName } from '../../components/ui'
import { todayIso } from '../../components/ui/dateEntry'
import { formatDue } from '../../lib/format'
import { refusalKey } from '../../lib/refusals'
import type { StaffMember } from '../data/types'
import { useAddTaskComment, useSnoozeTask } from './api'
import { dueState } from './board'
import type { Bucket } from './board'
import { TAG_TONE, TASK_TAG } from './families'
import { nextMonday, TASHKENT } from './snooze'
import type { Task, TaskType } from './types'

// The `sm` badge (DESIGN.md «Badges») in the Agenda's own tones. Text stays
// ≥ 4.5:1: the amber token is too light for text on white, so amber is the
// tag's fill and ring, never its letters.
const TAG_CLASSES = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  warn: 'bg-warn-50 text-slate-800 ring-warn-500/45',
  neg: 'bg-neg-50 text-neg-600 ring-neg-500/20',
} as const

/** The small type tag; ⚡ when the task was generated automatically. In
 * the list it sits in a fixed column (rowGrid.ts) sized for the widest
 * label: should one still not fit, it is cut with an ellipsis and its
 * tooltip names it in full — the column never widens. */
export function TypeTag({ type, automatic, groupLimit }: { type: TaskType; automatic: boolean; groupLimit?: boolean }) {
  const { t } = useTranslation()
  const tag = TASK_TAG[type]
  const label = t(groupLimit ? 'agenda.tags.groupLimit' : `agenda.tags.${tag}`)
  return (
    <span
      data-agenda-tag
      data-badge="sm"
      className={badgeClassName('sm', TAG_CLASSES[TAG_TONE[tag]])}
      title={automatic ? `${label} · ${t('agenda.auto')}` : label}
    >
      {automatic && <Zap aria-label={t('agenda.auto')} className="size-3 shrink-0" strokeWidth={2.4} />}
      <span className="min-w-0 truncate">{label}</span>
    </span>
  )
}

// Overdue is red (neg-600 passes 4.5:1); today is dark and bold — its amber
// is the row's stripe, since the amber token fails contrast as text.
const DUE_TONE: Record<Bucket, string> = {
  overdue: 'text-neg-600',
  today: 'text-slate-900',
  week: 'text-slate-600',
  later: 'text-slate-600',
}

/** «59 days» late / «today» / «in 2 days»; the date itself in the tooltip. */
export function DueLabel({ dueAt, bucket, now, compact = false }: { dueAt: string | null; bucket: Bucket; now: Date; compact?: boolean }) {
  const { t, i18n } = useTranslation()
  const state = dueState(dueAt, now)
  if (state.kind === 'none' || !dueAt) return null
  const text =
    state.kind === 'overdue'
      ? t(compact ? 'agenda.due.daysShort' : 'agenda.due.days', { count: state.days })
      : state.kind === 'today'
        ? t('agenda.due.today')
        : t(compact ? 'agenda.due.daysShort' : 'agenda.due.inDays', { count: state.days })
  return (
    <span
      className={`num shrink-0 text-small font-semibold whitespace-nowrap tabular-nums ${DUE_TONE[bucket]}`}
      title={t(state.kind === 'overdue' ? 'agenda.overdueSince' : 'agenda.dueBy', { moment: formatDue(dueAt, i18n.language) })}
    >
      {text}
    </span>
  )
}

function initials(text: string): string {
  const words = text.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean)
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '·'
}

/** Who the task is for: a person's initials, or the department. */
export function OwnerAvatar({
  task,
  staff,
}: {
  task: Pick<Task, 'target_user' | 'target_role'>
  staff: Map<string, StaffMember> | undefined
}) {
  const { t } = useTranslation()
  if (task.target_user) {
    const member = staff?.get(task.target_user)
    const name = member ? (member.full_name?.trim() || member.email) : t('agenda.owner.person')
    return (
      <span
        title={name}
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-caption font-semibold text-slate-700"
      >
        {member ? initials(name) : '·'}
      </span>
    )
  }
  const role = task.target_role ? t(`roles.${task.target_role}`) : ''
  return (
    <span
      title={t('agenda.owner.department', { role })}
      className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600"
    >
      <Users aria-label={t('agenda.owner.department', { role })} className="size-3.5" />
    </span>
  )
}

// ---------------------------------------------------------------------------
// Snooze
// ---------------------------------------------------------------------------

/** «Snooze ▾»: 1 day, 3 days, next Monday, or a date. */
export function SnoozeMenu({
  taskIds,
  onDone,
  onError,
  compact = false,
}: {
  taskIds: readonly string[]
  onDone?: () => void
  onError: (message: string) => void
  compact?: boolean
}) {
  const { t } = useTranslation()
  const snooze = useSnoozeTask()
  const [picking, setPicking] = useState(false)
  const [date, setDate] = useState('')

  // One call for the whole row: the row leaves the board in the next frame
  // (optimistic, api.ts) instead of after one round trip per task.
  const run = async (until: Date) => {
    try {
      await snooze.mutateAsync({ taskIds, until })
      onDone?.()
    } catch (error) {
      onError(t(refusalKey(error)))
    }
  }

  const now = new Date()
  return (
    <>
      <ActionsMenu
        label={t('agenda.snooze.action')}
        size={compact ? 'sm' : 'md'}
        disabled={snooze.isPending}
        actions={[
          { key: '1d', label: t('agenda.snooze.oneDay'), onSelect: () => void run(new Date(now.getTime() + 86_400_000)) },
          { key: '3d', label: t('agenda.snooze.threeDays'), onSelect: () => void run(new Date(now.getTime() + 3 * 86_400_000)) },
          { key: 'mon', label: t('agenda.snooze.nextMonday'), onSelect: () => void run(nextMonday(now)) },
          { key: 'pick', label: t('agenda.snooze.pickDate'), onSelect: () => setPicking(true) },
        ]}
      />
      <Modal
        open={picking}
        title={t('agenda.snooze.pickTitle')}
        onClose={() => setPicking(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPicking(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!date || snooze.isPending}
              onClick={() => {
                setPicking(false)
                void run(new Date(`${date}T00:00:00${TASHKENT}`))
              }}
            >
              {t('agenda.snooze.action')}
            </Button>
          </>
        }
      >
        <Field label={t('agenda.snooze.until')} hint={t('agenda.snooze.pickHint')}>
          <DateInput value={date} onChange={setDate} min={todayIso(new Date(now.getTime() + 86_400_000))} autoFocus />
        </Field>
      </Modal>
    </>
  )
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/** A comment box: Ctrl/⌘ Enter sends, Escape closes. */
export function CommentComposer({
  taskId,
  onClose,
  onError,
  autoFocus = true,
}: {
  taskId: string
  onClose: () => void
  onError: (message: string) => void
  autoFocus?: boolean
}) {
  const { t } = useTranslation()
  const add = useAddTaskComment()
  const [body, setBody] = useState('')

  const send = async () => {
    if (!body.trim()) return
    try {
      await add.mutateAsync({ taskId, body })
      setBody('')
      onClose()
    } catch (error) {
      onError(t(refusalKey(error)))
    }
  }

  return (
    <div
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape') onClose()
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send()
      }}
    >
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={2000}
        autoFocus={autoFocus}
        placeholder={t('agenda.comments.placeholder')}
        aria-label={t('agenda.comments.placeholder')}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-caption text-slate-600">{t('agenda.comments.hint')}</span>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" disabled={!body.trim()} loading={add.isPending} onClick={() => void send()}>
            {t('agenda.comments.send')}
          </Button>
        </div>
      </div>
    </div>
  )
}
