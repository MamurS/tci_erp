/**
 * The list view of «Моя повестка»: one white card per group, rows separated
 * by hairlines. A row is a link to its OBJECT (a stretched link, so the
 * buttons on it are siblings, never nested in it); hover or keyboard focus
 * reveals its actions — the primary one named for the task and going to the
 * screen where the task is done, Snooze, and the overflow menu.
 */

import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react'

import { ActionsMenu, Card, LinkButton } from '../../components/ui'
import { formatAmount, formatDate } from '../../lib/format'
import type { StaffMember } from '../data/types'
import type { TaskSubjects } from './api'
import { dueState, rowBucket, sumUzs } from './board'
import type { AgendaRow, Bucket, RowGroup } from './board'
import { isSnoozed, taskLink } from './catalogue'
import { destinationFor, instalmentDestination } from './destinations'
import { isAutomatic } from './notes'
import { CommentComposer, DueLabel, OwnerAvatar, SnoozeMenu, TypeTag } from './parts'
import { rowActions } from './rowActions'
import { snoozedText } from './snooze'
import { companyOf, itemMoney, referenceOf, rowFacts, rowTitle } from './rowText'
import type { Task } from './types'

export interface RowSnippet {
  text: string
  kind: 'comment' | 'note'
  count: number
}

export interface ListContext {
  now: Date
  locale: string
  subjects: TaskSubjects | undefined
  staff: Map<string, StaffMember> | undefined
  rateFor: (currency: string) => number | null
  snippetOf: (row: AgendaRow) => RowSnippet | null
  focusedKey: string | null
  onFocusRow: (key: string) => void
  commentingKey: string | null
  setCommentingKey: (key: string | null) => void
  onComplete: (row: AgendaRow) => void
  onUnsnooze: (row: AgendaRow) => void
  onError: (message: string) => void
  onHandled: (row: AgendaRow) => void
}

const STRIPE: Record<Bucket, string> = {
  overdue: 'border-l-neg-500',
  today: 'border-l-warn-500',
  week: 'border-l-slate-300',
  later: 'border-l-slate-300',
}

export function AgendaList({ groups, ctx }: { groups: RowGroup[]; ctx: ListContext }) {
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <GroupSection key={group.key} group={group} ctx={ctx} />
      ))}
    </div>
  )
}

function GroupSection({ group, ctx }: { group: RowGroup; ctx: ListContext }) {
  const { t, i18n } = useTranslation()
  const startsClosed = group.kind === 'due' && group.key === 'later'
  const [open, setOpen] = useState(!startsClosed)
  const tasks = group.rows.reduce((n, r) => n + r.tasks.length, 0)
  const money = sumUzs(group.rows, ctx.rateFor)

  const label =
    group.kind === 'due'
      ? t(`agenda.buckets.${group.key}`)
      : group.kind === 'type'
        ? t(`agenda.families.${group.key}`)
        : group.key || t('agenda.noCompany')
  const tone =
    group.kind === 'due' && group.key === 'overdue' ? 'text-neg-600' : 'text-slate-800'

  return (
    <section aria-label={label}>
      <h2 className="mb-2 flex items-baseline gap-3">
        {group.kind === 'due' && group.key === 'today' && (
          <span aria-hidden className="size-2 shrink-0 self-center rounded-full bg-warn-500" />
        )}
        <span className={`text-[12px] font-bold tracking-[0.08em] uppercase ${tone}`}>{label}</span>
        <span className="text-[12.5px] text-slate-600 tabular-nums">
          {[
            t('agenda.groupMeta.items', { count: group.rows.length }),
            tasks !== group.rows.length ? t('agenda.groupMeta.tasks', { count: tasks }) : null,
            money.uzs !== null ? `${formatAmount(money.uzs, i18n.language)} UZS` : null,
            money.missingRates > 0 ? t('agenda.groupMeta.noRate', { count: money.missingRates }) : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {startsClosed && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="ml-auto text-[13px] font-semibold text-accent-600 hover:underline focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:outline-none"
          >
            {open ? t('agenda.hide') : t('agenda.showAll')}
          </button>
        )}
      </h2>
      {open && (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {group.rows.map((row) => (
              <RowView key={row.key} row={row} ctx={ctx} />
            ))}
          </ul>
        </Card>
      )}
    </section>
  )
}

function RowView({ row, ctx }: { row: AgendaRow; ctx: ListContext }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const locale = i18n.language
  const [expanded, setExpanded] = useState(false)
  const bucket = rowBucket(row, ctx.now)
  const collapsedSum = row.kind === 'collapsed' ? sumUzs([row], ctx.rateFor).uzs : null
  const title = rowTitle(row, t, locale, ctx.subjects, collapsedSum)
  const facts = rowFacts(row, t, locale, ctx.subjects)
  const snippet = ctx.snippetOf(row)
  const dest = destinationFor(row, {
    subject: companyOf(row.lead, ctx.subjects),
    reference: referenceOf(row.lead, ctx.subjects),
  })
  const object = taskLink({ ...row.lead, task_type: row.lead.task_type }) ?? dest.path
  const snoozed = row.tasks.some((task) => isSnoozed(task, ctx.now))
  const focused = ctx.focusedKey === row.key
  const commenting = ctx.commentingKey === row.key

  return (
    <li
      data-row-key={row.key}
      className={`group/row border-l-[3px] ${STRIPE[bucket]} transition-colors hover:bg-slate-50/80 has-[[data-row-link]:focus-visible]:bg-accent-50/50 has-[[data-row-link]:focus-visible]:ring-2 has-[[data-row-link]:focus-visible]:ring-accent-500 has-[[data-row-link]:focus-visible]:ring-inset ${
        focused ? 'bg-accent-50/40' : ''
      }`}
    >
      <div data-layout-row className="relative flex min-h-14 items-center gap-3 py-2 pr-4 pl-3">
        {row.kind === 'collapsed' ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? t('agenda.collapse') : t('agenda.expand')}
            className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded border border-slate-200 bg-white text-slate-500 hover:text-slate-800 focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:outline-none"
          >
            {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
        ) : (
          <span className="w-6 shrink-0" />
        )}
        <TypeTag
          type={row.displayType}
          automatic={isAutomatic(row.lead)}
          groupLimit={row.lead.task_type === 'limit_escalated' && row.lead.params?.reason === 'group_limit'}
        />
        <div className="min-w-0 flex-1">
          <Link
            to={object}
            data-row-link={row.key}
            onFocus={() => ctx.onFocusRow(row.key)}
            className="block truncate text-[14px] font-semibold text-slate-900 after:absolute after:inset-0 after:content-[''] focus-visible:outline-none"
          >
            {title}
          </Link>
          <p className="mt-0.5 truncate text-[12.5px] text-slate-600 tabular-nums">
            {snoozed && (
              <span className="text-slate-600">{snoozedText(row.lead, t, locale, ctx.staff)} · </span>
            )}
            {snippet && (
              <span className="text-slate-600">
                {snippet.kind === 'comment' && (
                  <span className="mr-1 inline-flex items-center gap-1 font-medium text-accent-600 not-italic">
                    <MessageSquare aria-hidden className="size-3" />
                    {t('agenda.comments.count', { count: snippet.count })}
                  </span>
                )}
                <i>{snippet.kind === 'comment' ? `«${snippet.text}»` : snippet.text}</i>
                {(snippet.kind === 'note' ? Boolean(referenceOf(row.lead, ctx.subjects)) : facts.length > 0) && ' · '}
              </span>
            )}
            {/* A system note already states the facts; only the number stays. */}
            {(snippet?.kind === 'note' ? facts.filter((f) => f === referenceOf(row.lead, ctx.subjects)) : facts).join(' · ')}
          </p>
        </div>
        {/* Revealed by OPACITY, never display: the buttons' space is always
            taken, so hovering a row never moves its title, due date or owner. */}
        <div
          className={`relative z-10 flex shrink-0 items-center gap-2 transition-opacity ${
            focused || commenting
              ? ''
              : 'pointer-events-none opacity-0 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 group-hover/row:pointer-events-auto group-hover/row:opacity-100'
          }`}
        >
          <LinkButton to={dest.path} size="sm" onClick={() => ctx.onHandled(row)}>
            {t(`agenda.actions.${dest.action}`)}
          </LinkButton>
          {!snoozed && (
            <SnoozeMenu
              compact
              taskIds={row.tasks.map((task) => task.id)}
              onDone={() => ctx.onHandled(row)}
              onError={ctx.onError}
            />
          )}
          <ActionsMenu trigger="icon" size="sm" label={t('agenda.more')} actions={rowActions(row, ctx, t, navigate)} />
        </div>
        <span className="relative z-10 flex shrink-0 items-center gap-3">
          <DueLabel dueAt={row.dueAt} bucket={bucket} now={ctx.now} />
          <OwnerAvatar task={row.lead} staff={ctx.staff} />
        </span>
      </div>

      {row.kind === 'collapsed' && expanded && <SubTable row={row} now={ctx.now} />}

      {commenting && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-3 pl-[3.25rem]">
          <CommentComposer taskId={row.lead.id} onClose={() => ctx.setCommentingKey(null)} onError={ctx.onError} />
        </div>
      )}
    </li>
  )
}

/** The items behind a collapsed row: what, due, amount, days, Open. */
function SubTable({ row, now }: { row: AgendaRow; now: Date }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const multiplePolicies = new Set(row.items.map((i) => i.params?.policy_id)).size > 1
  return (
    <table className="w-full border-t border-slate-100 bg-slate-50/50 text-[13px]">
      <tbody className="divide-y divide-slate-100">
        {row.items.map((item: Task) => {
          const state = dueState(item.due_at, now)
          const href = instalmentDestination(item)
          return (
            <tr key={item.id}>
              <td className="py-2 pr-3 pl-[3.25rem] text-slate-700">
                {[
                  multiplePolicies && typeof item.params?.policy_number === 'string' ? item.params.policy_number : null,
                  t('agenda.sub.instalment', { sequence: item.params?.sequence ?? '' }),
                  typeof item.params?.due_date === 'string'
                    ? t('agenda.facts.due', { date: formatDate(item.params.due_date, locale) })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </td>
              <td className="num px-3 py-2 text-right whitespace-nowrap text-slate-800 tabular-nums">{itemMoney(item, locale)}</td>
              <td
                className={`num w-24 px-3 py-2 text-right font-semibold whitespace-nowrap tabular-nums ${
                  state.kind === 'overdue' ? 'text-neg-600' : 'text-slate-700'
                }`}
              >
                {state.kind === 'overdue'
                  ? t('agenda.due.days', { count: state.days })
                  : state.kind === 'today'
                    ? t('agenda.due.today')
                    : state.kind === 'future'
                      ? t('agenda.due.inDays', { count: state.days })
                      : ''}
              </td>
              <td className="w-20 py-2 pr-4 pl-3 text-right">
                {href && (
                  <Link to={href} className="font-semibold text-accent-600 hover:underline">
                    {t('agenda.open')}
                  </Link>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
