/**
 * Triage — a preview, not a workplace. The queue sits compact on the left;
 * the selected task on the right shows what is needed to understand it, and
 * its primary button goes to the screen where the task is DONE, deep-linked
 * with the task's context (destinations.ts), with the destination spelled
 * out under it. Nothing is decided, recalculated or edited here.
 *
 * A row that leaves the board while the page is open (done, snoozed, closed
 * by its object moving on) stays in the queue struck through until reload,
 * so the queue does not jump under the reader's eyes.
 */

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Check, CornerDownRight, Zap } from 'lucide-react'

import { Button, Card, LinkButton } from '../../components/ui'
import { formatDue, formatMoment } from '../../lib/format'
import type { StaffMember } from '../data/types'
import { useObjectEvents, useValidationComments, validationOrigin } from './api'
import type { LimitJustification, TaskSubjects } from './api'
import { dueState, rowBucket } from './board'
import type { AgendaRow, Bucket, Grouping, RowGroup } from './board'
import { canCompleteByHand, isSnoozed, taskLink } from './catalogue'
import { destinationFor } from './destinations'
import type { Crumb } from './destinations'
import { isAutomatic, paramComments, systemNote } from './notes'
import type { OriginAuthor } from './notes'
import { CommentComposer, OwnerAvatar, SnoozeMenu, TypeTag } from './parts'
import { snoozedText } from './snooze'
import { companyOf, personName, referenceOf, renderNote, rowTitle } from './rowText'
import { FamilyBody } from './triage/FamilyBody'
import type { TaskComment } from './types'
import { useFillViewport } from './useFillViewport'

interface TriageProps {
  groups: RowGroup[]
  /** How `groups` were built; a new grouping rebuilds the queue in its order. */
  grouping: Grouping
  now: Date
  subjects: TaskSubjects | undefined
  staff: Map<string, StaffMember> | undefined
  comments: TaskComment[]
  justifications: Map<string, LimitJustification> | undefined
  rateFor: (currency: string) => number | null
  handled: Map<string, number>
  onHandled: (row: AgendaRow) => void
  onError: (message: string) => void
  onComplete: (row: AgendaRow) => void
  onUnsnooze: (row: AgendaRow) => void
  /** The page's J/K hand the move to the queue. */
  registerMove: (fn: (delta: number) => void) => void
}

interface QueueEntry {
  row: AgendaRow
  group: string
  gone: boolean
}

const STRIPE: Record<Bucket, string> = {
  overdue: 'border-l-neg-500',
  today: 'border-l-warn-500',
  week: 'border-l-slate-300',
  later: 'border-l-slate-300',
}

export function TriageView(props: TriageProps) {
  const { groups, grouping, now, subjects, staff, handled, registerMove } = props
  const { t, i18n } = useTranslation()
  const locale = i18n.language

  // The queue keeps every row it has shown until reload; rows that left the
  // board are marked gone (struck through), new rows join their group.
  const [entries, setEntries] = useState<QueueEntry[]>([])
  const groupedBy = useRef(grouping)
  useEffect(() => {
    // A new grouping (the header's «Group by», kept across both views)
    // starts the queue afresh in the new groups' order: a row that left the
    // board has no group under the new key.
    const regrouped = groupedBy.current !== grouping
    groupedBy.current = grouping
    setEntries((previous) => {
      const current = groups.flatMap((g) => g.rows.map((row) => ({ row, group: g.key, gone: false })))
      if (regrouped) return current
      const live = new Map(current.map((e) => [e.row.key, e]))
      const kept = previous.map((e) => live.get(e.row.key) ?? { ...e, gone: true })
      const known = new Set(kept.map((e) => e.row.key))
      const added = current.filter((e) => !known.has(e.row.key))
      if (kept.length === 0) return current
      // Insert each new row after the last entry of its group.
      const out = [...kept]
      for (const entry of added) {
        const at = out.map((e) => e.group).lastIndexOf(entry.group)
        out.splice(at === -1 ? out.length : at + 1, 0, entry)
      }
      return out
    })
  }, [groups, grouping])

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const live = entries.filter((e) => !e.gone)
  const selected =
    entries.find((e) => e.row.key === selectedKey && !e.gone) ?? live[0] ?? null

  const move = (delta: number) => {
    if (!live.length) return
    const at = Math.max(0, live.findIndex((e) => e.row.key === selected?.row.key))
    const next = live[Math.max(0, Math.min(live.length - 1, at + delta))]
    if (next) setSelectedKey(next.row.key)
  }
  const moveRef = useRef(move)
  moveRef.current = move
  useEffect(() => registerMove((delta) => moveRef.current(delta)), [registerMove])

  // Keep the selected queue item in view as J/K moves.
  useEffect(() => {
    if (!selected) return
    // Inside the queue pane only, clear of its sticky group header (the
    // item's scroll margin); the page itself never scrolls for it.
    const item = document.querySelector<HTMLElement>(`[data-queue-key="${CSS.escape(selected.row.key)}"]`)
    const pane = item?.closest<HTMLElement>('[data-triage-scroll]')
    if (!item || !pane) return
    const margin = parseFloat(getComputedStyle(item).scrollMarginTop || '0')
    const top = item.getBoundingClientRect().top - pane.getBoundingClientRect().top
    const bottom = top + item.offsetHeight
    if (top < margin) pane.scrollTop += top - margin
    else if (bottom > pane.clientHeight) pane.scrollTop += bottom - pane.clientHeight
  }, [selected])

  const position = selected ? live.findIndex((e) => e.row.key === selected.row.key) + 1 : 0
  const groupOrder = [...new Set(entries.map((e) => e.group))]

  // Two panes as tall as the viewport allows, ending on one line; each
  // scrolls inside itself under its pinned header, never the page.
  const frame = useRef<HTMLDivElement>(null)
  const height = useFillViewport(frame)

  return (
    <div
      ref={frame}
      data-card-row
      style={height === null ? undefined : ({ '--triage-h': `${height}px` } as CSSProperties)}
      className="grid gap-5 lg:h-[var(--triage-h,36rem)] lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]"
    >
      <Card className="flex min-h-0 flex-col overflow-hidden" data-triage-pane="queue">
        <p data-triage-pane-head className="shrink-0 border-b border-slate-100 px-4 py-2.5 text-[12.5px] text-slate-600">
          {t('agenda.triage.position', { index: position, total: live.length })}
        </p>
        <div data-triage-scroll className="max-h-[60vh] min-h-0 flex-1 overflow-y-auto lg:max-h-none">
          {groupOrder.map((group) => {
            const inGroup = entries.filter((e) => e.group === group)
            const kind = groups.find((g) => g.key === group)?.kind ?? 'due'
            const label =
              kind === 'due'
                ? t(`agenda.buckets.${group}`)
                : kind === 'type'
                  ? t(`agenda.families.${group}`)
                  : group || t('agenda.noCompany')
            return (
              <div key={group}>
                <div
                  className={`sticky top-0 z-10 border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-[11.5px] font-bold tracking-[0.08em] uppercase ${
                    kind === 'due' && group === 'overdue' ? 'text-neg-600' : 'text-slate-700'
                  }`}
                >
                  {label} · {inGroup.filter((e) => !e.gone).length}
                </div>
                <ul>
                  {inGroup.map((entry) => (
                    <QueueItem
                      key={entry.row.key}
                      entry={entry}
                      selected={selected?.row.key === entry.row.key}
                      handledAt={handled.get(entry.row.key)}
                      onSelect={() => setSelectedKey(entry.row.key)}
                      now={now}
                      subjects={subjects}
                      locale={locale}
                    />
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </Card>

      {selected ? (
        <DetailPanel key={selected.row.key} row={selected.row} {...props} staff={staff} />
      ) : (
        <Card className="p-8 text-center text-sm text-slate-600" data-triage-pane="task">
          {t('agenda.triage.nothingSelected')}
        </Card>
      )}
    </div>
  )
}

function QueueItem({
  entry,
  selected,
  handledAt,
  onSelect,
  now,
  subjects,
  locale,
}: {
  entry: QueueEntry
  selected: boolean
  handledAt: number | undefined
  onSelect: () => void
  now: Date
  subjects: TaskSubjects | undefined
  locale: string
}) {
  const { t } = useTranslation()
  const { row, gone } = entry
  const bucket = rowBucket(row, now)
  const state = dueState(row.dueAt, now)
  const what =
    row.kind === 'collapsed'
      ? t(`agenda.row.collapsed.${row.displayType}`, { count: row.items.length })
      : rowTitle(row, t, locale, undefined, null)
  const company = companyOf(row.lead, subjects)
  const ref = referenceOf(row.lead, subjects)
  return (
    <li data-queue-key={row.key} className="scroll-mt-8">
      <button
        type="button"
        disabled={gone}
        onClick={onSelect}
        aria-current={selected ? 'true' : undefined}
        className={`flex w-full items-center gap-3 border-b border-l-[3px] border-b-slate-100 py-2.5 pr-4 pl-3.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:outline-none focus-visible:ring-inset ${
          selected ? 'border-l-accent-600 bg-accent-50' : `${STRIPE[bucket]} hover:bg-slate-50`
        } ${gone ? 'opacity-60' : ''}`}
      >
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[13.5px] font-semibold ${gone ? 'text-slate-600 line-through' : selected ? 'text-accent-700' : 'text-slate-900'}`}>
            {what}
          </span>
          <span className="block truncate text-[12px] text-slate-600">
            {gone
              ? t('agenda.triage.handled', { time: handledAt ? formatMoment(new Date(handledAt), locale).split(', ').slice(-1)[0] : '' })
              : [company, ref].filter(Boolean).join(' · ')}
          </span>
        </span>
        {gone ? (
          <Check aria-label={t('agenda.triage.handledLabel')} className="size-4 shrink-0 text-pos-500" />
        ) : (
          <span
            className={`num shrink-0 text-[12.5px] font-semibold tabular-nums ${
              bucket === 'overdue' ? 'text-neg-600' : 'text-slate-700'
            }`}
          >
            {state.kind === 'overdue'
              ? t('agenda.due.daysShort', { count: state.days })
              : state.kind === 'today'
                ? t('agenda.due.today')
                : state.kind === 'future'
                  ? t('agenda.due.daysShort', { count: state.days })
                  : ''}
          </span>
        )}
      </button>
    </li>
  )
}

// ---------------------------------------------------------------------------
// The detail panel
// ---------------------------------------------------------------------------

function crumbText(crumb: Crumb, t: (key: string, o?: Record<string, unknown>) => string): string {
  return 'text' in crumb ? crumb.text : t(crumb.key, crumb.params)
}

interface ThreadEntry {
  key: string
  who: string
  role: string | null
  at: string
  body: string
  system?: boolean
}

function DetailPanel({
  row,
  now,
  subjects,
  staff,
  comments,
  justifications,
  onHandled,
  onError,
  onComplete,
  onUnsnooze,
}: TriageProps & { row: AgendaRow }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const navigate = useNavigate()
  const lead = row.lead
  const [commenting, setCommenting] = useState(false)
  const bucket = rowBucket(row, now)
  const state = dueState(row.dueAt, now)
  const company = companyOf(lead, subjects)
  const reference = referenceOf(lead, subjects)
  const dest = destinationFor(row, { subject: company, reference })
  const object = taskLink({ ...lead, task_type: lead.task_type })
  const automatic = isAutomatic(lead)
  const snoozed = row.tasks.some((task) => isSnoozed(task, now))

  const { data: events } = useObjectEvents([lead.object_id])
  // A validation task's comments live on its step (0060).
  const { data: validationComments } = useValidationComments(
    lead.object_type === 'limit_validation' ? [lead.object_id] : [],
  )
  const source = events?.find((e) => e.id === lead.source_event_id)

  // Panel keys: Enter goes, O opens the object, C comments, S snoozes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return
      if (document.querySelector('[role="dialog"], [role="menu"]')) return
      const key = e.key.toLowerCase()
      if (e.key === 'Enter' && !(el instanceof HTMLButtonElement) && !(el instanceof HTMLAnchorElement)) {
        e.preventDefault()
        onHandled(row)
        navigate(dest.path)
      } else if (key === 'o' && object) {
        navigate(object)
      } else if (key === 'c') {
        e.preventDefault()
        setCommenting(true)
      } else if (key === 's') {
        e.preventDefault()
        document.querySelector<HTMLElement>('[data-triage-snooze] [aria-haspopup="menu"]')?.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // The thread: origin comments where they live, the system note, comments.
  const thread: ThreadEntry[] = []
  const authorLabel = (author: OriginAuthor) => t(`agenda.comments.authors.${author}`)
  for (const c of row.tasks.flatMap(paramComments)) {
    thread.push({ key: `p-${c.at}-${c.body}`, who: authorLabel(c.author), role: null, at: c.at, body: c.body })
  }
  const validationNote = validationOrigin(lead, validationComments)
  if (validationNote) {
    thread.push({
      key: `v-${lead.object_id}-${validationNote.side}`,
      who: personName(validationNote.author, staff) ?? authorLabel(validationNote.side),
      role: t(`agenda.comments.authors.${validationNote.side}`),
      at: validationNote.at,
      body: validationNote.body,
    })
  }
  const justification = lead.object_type === 'credit_limit_request' ? justifications?.get(lead.object_id) : undefined
  if (justification?.justification) {
    const fromClient = lead.params?.from_client === true
    thread.push({
      key: `j-${justification.id}`,
      who: fromClient ? (company ?? authorLabel('policyholder')) : (personName(justification.requested_by, staff) ?? authorLabel('requester')),
      role: fromClient ? t('agenda.comments.viaPortal') : t('agenda.comments.requester'),
      at: justification.created_at,
      body: justification.justification,
    })
  }
  const note = systemNote(lead)
  if (note && row.kind !== 'collapsed' && (automatic || lead.task_type === 'limit_escalated')) {
    thread.push({ key: 'system', who: t('agenda.comments.system'), role: null, at: lead.created_at, body: renderNote(note, t, locale, staff), system: true })
  }
  const ids = new Set(row.tasks.map((task) => task.id))
  for (const c of comments.filter((x) => ids.has(x.task_id))) {
    const member = staff?.get(c.author_id)
    thread.push({
      key: c.id,
      who: personName(c.author_id, staff) ?? t('agenda.note.someone'),
      role: member?.roles?.[0] ? t(`roles.${member.roles[0]}`) : null,
      at: c.created_at,
      body: c.body,
    })
  }
  thread.sort((a, b) => a.at.localeCompare(b.at))
  const humanCount = thread.filter((e) => !e.system).length

  const dueText =
    state.kind === 'overdue'
      ? t('agenda.triage.overdueBy', { count: state.days })
      : state.kind === 'today'
        ? t('agenda.triage.dueToday')
        : state.kind === 'future'
          ? t('agenda.triage.dueIn', { count: state.days })
          : null

  const provenance = automatic
    ? t('agenda.triage.createdAuto', { moment: formatMoment(lead.created_at, locale) })
    : source?.actor
      ? t('agenda.triage.raisedBy', {
          name: personName(source.actor, staff) ?? company ?? t('agenda.note.someone'),
          moment: formatMoment(source.created_at, locale),
        })
      : t('agenda.triage.created', { moment: formatMoment(lead.created_at, locale) })

  const owner = lead.target_user
    ? (personName(lead.target_user, staff) ?? t('agenda.owner.person'))
    : lead.target_role
      ? t(`roles.${lead.target_role}`)
      : null

  return (
    <Card className="flex min-h-0 min-w-0 flex-col overflow-hidden" data-triage-pane="task">
      <div data-triage-pane-head className="shrink-0 border-b border-slate-100 p-6 pb-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <TypeTag
            type={row.displayType}
            automatic={automatic}
            groupLimit={lead.task_type === 'limit_escalated' && lead.params?.reason === 'group_limit'}
          />
          {dueText && (
            <span className={`text-[13px] font-semibold ${bucket === 'overdue' ? 'text-neg-600' : 'text-slate-700'}`} title={row.dueAt ? formatDue(row.dueAt, locale) : undefined}>
              {dueText}
            </span>
          )}
          <span className="ml-auto">
            <OwnerAvatar task={lead} staff={staff} />
          </span>
        </div>
        <h2 className="mt-3 text-[20px] leading-snug font-semibold text-slate-900">
          {row.kind === 'collapsed'
            ? t(`agenda.row.collapsed.${row.displayType}`, { count: row.items.length })
            : rowTitle(row, t, locale, undefined, null)}
        </h2>
        <p className="mt-1 text-[13.5px] text-slate-600">
          {[
            company && object ? (
              <Link key="c" to={object} className="font-medium text-accent-600 hover:underline">
                {company}
              </Link>
            ) : (
              company
            ),
            reference,
            provenance,
            owner ? t('agenda.triage.assignedTo', { owner }) : null,
          ]
            .filter(Boolean)
            .map((part, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                {part}
              </span>
            ))}
        </p>
        {snoozed && <p className="mt-1 text-[13px] text-slate-600">{snoozedText(lead, t, locale, staff)}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <LinkButton to={dest.path} onClick={() => onHandled(row)}>
            {t(`agenda.goto.${dest.action}`)}
            <ArrowRight aria-hidden />
          </LinkButton>
          <Button variant="secondary" onClick={() => setCommenting(true)}>
            {t('agenda.comments.add')}
          </Button>
          {snoozed ? (
            <Button variant="secondary" onClick={() => onUnsnooze(row)}>
              {t('agenda.snooze.undo')}
            </Button>
          ) : (
            <span data-triage-snooze>
              <SnoozeMenu taskIds={row.tasks.map((task) => task.id)} onDone={() => onHandled(row)} onError={onError} />
            </span>
          )}
          {row.tasks.some((task) => canCompleteByHand(task.task_type)) && (
            <Button variant="secondary" onClick={() => onComplete(row)}>
              {t('agenda.markDone')}
            </Button>
          )}
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-1 text-[12.5px] text-slate-600">
          <CornerDownRight aria-hidden className="size-3.5 text-slate-500" />
          {t('agenda.dest.opens')}{' '}
          <span className="font-semibold text-accent-700">{dest.crumbs.map((c) => crumbText(c, t)).join(' › ')}</span>
          {dest.context && <span>{t(dest.context.key, dest.context.params)}</span>}
        </p>
      </div>

      <div data-triage-scroll className="min-h-0 flex-1 p-6 pt-5 lg:overflow-y-auto">
        <section aria-label={t('agenda.comments.title', { count: humanCount })}>
          <h3 className="mb-3 text-[11.5px] font-bold tracking-[0.08em] text-slate-600 uppercase">
            {t('agenda.comments.title', { count: humanCount })}
          </h3>
          <ol className="flex flex-col gap-3">
            {thread.map((entry) =>
              entry.system ? (
                <li key={entry.key} className="flex gap-3 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[13.5px] text-slate-700">
                  <Zap aria-hidden className="mt-0.5 size-4 shrink-0 text-slate-500" />
                  <span>
                    <span className="font-semibold text-slate-800">{t('agenda.comments.systemNote')}</span>
                    <span className="text-slate-600"> · {formatMoment(entry.at, locale)}</span>
                    <span className="mt-0.5 block">{entry.body}</span>
                  </span>
                </li>
              ) : (
                <li key={entry.key} className="flex gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-100 text-[11px] font-bold text-accent-700">
                    {entry.who.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3.5 py-2.5">
                    <p className="text-[12.5px] text-slate-600">
                      <span className="font-semibold text-slate-900">{entry.who}</span>
                      {entry.role && ` · ${entry.role}`} · {formatMoment(entry.at, locale)}
                    </p>
                    <p className="mt-1 text-[14px] whitespace-pre-line text-slate-800">{entry.body}</p>
                  </div>
                </li>
              ),
            )}
            {thread.length === 0 && !commenting && <li className="text-[13px] text-slate-600">{t('agenda.comments.none')}</li>}
          </ol>
          {commenting && (
            <div className="mt-3">
              <CommentComposer taskId={lead.id} onClose={() => setCommenting(false)} onError={onError} />
            </div>
          )}
        </section>

        <FamilyBody row={row} now={now} subjects={subjects} />

        <History events={events ?? []} staff={staff} />
      </div>
    </Card>
  )
}

function History({
  events,
  staff,
}: {
  events: { id: string; event_type: string; actor: string | null; payload: Record<string, unknown>; created_at: string }[]
  staff: Map<string, StaffMember> | undefined
}) {
  const { t, i18n } = useTranslation()
  const shown = events.filter((e) => !e.event_type.startsWith('task.')).slice(-8).reverse()
  if (shown.length === 0) return null
  return (
    <section className="mt-6 border-t border-slate-100 pt-5">
      <h3 className="mb-3 text-[11.5px] font-bold tracking-[0.08em] text-slate-600 uppercase">{t('agenda.history.title')}</h3>
      <ol className="flex flex-col gap-2">
        {shown.map((e) => (
          <li key={e.id} className="grid grid-cols-[9rem_1fr] gap-4 text-[13.5px]">
            <span className="text-slate-600 tabular-nums">{formatMoment(e.created_at, i18n.language)}</span>
            <span className="text-slate-800">
              {t(`agenda.history.events.${e.event_type.replace(/\./g, '_')}`, {
                defaultValue: t('agenda.history.events.other'),
                from: typeof e.payload?.from === 'string' ? t(`requests.statuses.${e.payload.from}`, { defaultValue: e.payload.from }) : '',
                to: typeof e.payload?.to === 'string' ? t(`requests.statuses.${e.payload.to}`, { defaultValue: e.payload.to }) : '',
              })}
              {e.actor && personName(e.actor, staff) ? ` — ${personName(e.actor, staff)}` : ''}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
