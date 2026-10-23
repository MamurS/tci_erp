/**
 * The task catalogue — pure module, EXACT mirror of migration 0024.
 *
 * Two things live here and nowhere else:
 *
 *  1. Which task types close themselves and which need a human. Only
 *     `submission_declined` is manual, because nothing downstream happens
 *     once the client says no; every other type has an objective signal, so
 *     tci.complete_task REFUSES it. The UI must never offer a «done» button
 *     it knows the database will reject.
 *  2. Where a row deep-links to. A task's object_id is not always routable
 *     on its own (a decision has no page), so the params carry what is.
 */

import { formatAmount, formatDate } from '../../lib/format'
import type { Task, TaskObjectType, TaskPriority, TaskType } from './types'

/** How a task type stops being open. `auto` = the event mapping closes it. */
export type CompletionRule = 'auto' | 'manual'

export const COMPLETION_RULES: Readonly<Record<TaskType, CompletionRule>> = {
  buyer_needs_entity: 'auto', // request.buyer_resolved
  buyer_needs_rating: 'auto', // rating.created
  limit_needs_decision: 'auto', // limit.credit_decided
  limit_escalated: 'auto', // limit.credit_decided
  submission_commercial_review: 'auto', // status leaves commercial_review
  submission_sales_confirmation: 'auto', // status leaves sales_confirmation
  limit_held: 'auto', // limit.released / limit.commercial_adjusted
  submission_accepted: 'auto', // request.bound
  submission_declined: 'manual', // the only one — a human closes the file
  limit_review_due: 'auto', // refresh_agenda, lazily
  rating_stale: 'auto', // rating.created, or refresh_agenda lazily
  // Phase 4 (migration 0029)
  declaration_due: 'auto', // declaration.submitted, or refresh_agenda lazily
  declaration_overdue: 'auto', // same signal, louder priority
  declaration_awaiting_acceptance: 'auto', // declaration.accepted / .disputed
  instalment_due: 'auto', // refresh_agenda, once the instalment is paid or cancelled
  instalment_overdue: 'auto', // same
  noa_credit_review: 'auto', // noa.resolved
  // The second manual type. Turnover shipped outside cover is a conversation
  // with the policyholder; nothing downstream ends it, so a human does.
  uncovered_excess_review: 'manual',
  // Phase 5 (migration 0036)
  noa_matured_to_claim: 'auto', // refresh_agenda: a claim exists, or the NOA closed
  claim_ready_to_file: 'auto', // same signal, addressed to the policyholder
  claim_submitted: 'auto', // claim.status_changed away from submitted
  claim_info_requested: 'auto', // claim.status_changed away from info_requested
  claim_awaiting_payment: 'auto', // claim.status_changed to paid
  claim_limit_reinstatement: 'auto', // refresh_agenda: a live limit again, or the file closed
  // The third manual type, for the same reason as submission_declined: once a
  // claim is refused nothing downstream happens on its own, so a human decides
  // the conversation with the policyholder is over.
  claim_declined_review: 'manual',
  // Phase 6 (migration 0041). Both are generated AND retired by
  // refresh_agenda, so neither needs a button.
  group_exposure_near_limit: 'auto', // refresh_agenda: exposure falls back, or the limit changes
  group_limit_missing: 'auto', // refresh_agenda: a group limit exists
  // Data management (migration 0054). The information manager's two close
  // when the request is resolved; the requester's notice is the fourth
  // manual type — nothing downstream happens once they have been told.
  entity_requested: 'auto', // data.entity_request_resolved (or moves on reassignment)
  statements_requested: 'auto', // same
  entity_request_resolved: 'manual',
  // Agenda redesign (migration 0055): refresh_agenda retires it once the new
  // period is rated, and so does rating.created at once.
  rating_new_statements: 'auto',
  // Premium payments (migration 0056): closes when no line of the import is
  // unmatched or suggested any more (assigned, confirmed or set aside).
  premium_payment_unmatched: 'auto',
  // Contract drafts (migration 0057): closes when the draft leaves review.
  contract_review: 'auto',
  // Commercial offers (migration 0058): the viewed notice closes when the
  // client answers or the offer moves on; the two date kinds are generated
  // and retired by refresh_agenda (refresh_offer_tasks).
  offer_viewed: 'auto',
  offer_expiring: 'auto',
  offer_expired: 'auto',
  // Limit validation (migration 0060): the validator's task closes when they
  // answer (or the request is withdrawn); the author's notice of the result
  // is the fifth manual type — nothing downstream happens once they know.
  limit_validation: 'auto',
  limit_validation_result: 'manual',
  // Auto decisions (migration 0061): «review the buyer / renew the ADT»
  // closes itself when the credit desk sets a new ADT or disables it
  // (adt.set / adt.disabled), so it needs no button.
  adt_review: 'auto',
  // Information gathering (migration 0067): closes itself when the data is
  // complete (the request goes on by itself), on a waiver or a withdrawal.
  limit_information_needed: 'auto',
}

/** Mirrors tci.complete_task's guard (as 0060 restates it): it refuses
 * every type the COMPLETION_RULES do not call manual. */
export function canCompleteByHand(taskType: TaskType): boolean {
  return COMPLETION_RULES[taskType] === 'manual'
}

/** Where the row's «open» action goes. Null when nothing is routable. */
export function taskLink(
  task: Pick<Task, 'object_type' | 'object_id' | 'params'> & { task_type?: TaskType },
): string | null {
  switch (task.object_type) {
    case 'insurance_request':
      return `/requests/${task.object_id}`
    case 'legal_entity':
      // The two group tasks hang off the ULTIMATE PARENT company, and the work
      // they ask for is on its Группа tab, not on the card's default tab.
      // The rating tasks belong on Рейтинг и лимит.
      if (task.task_type === 'group_exposure_near_limit' || task.task_type === 'group_limit_missing')
        return `/entities/${task.object_id}?tab=group`
      // The ADT review (0061) lands on the ADT block of the rating tab.
      if (task.task_type === 'adt_review') return `/entities/${task.object_id}?tab=rating&focus=adt`
      if (
        task.task_type === 'buyer_needs_rating' ||
        task.task_type === 'rating_stale' ||
        task.task_type === 'rating_new_statements'
      )
        return `/entities/${task.object_id}?tab=rating`
      return `/entities/${task.object_id}`
    case 'credit_limit_request':
      // The information desk's task (0067) is done on the BUYER's card —
      // the data desk does not open credit limits.
      if (task.task_type === 'limit_information_needed') {
        const entityId = task.params?.entity_id
        if (typeof entityId === 'string') return `/entities/${entityId}`
      }
      return `/limits/${task.object_id}`
    case 'credit_limit_decision': {
      // A decision has no page of its own; its limit request does.
      const requestId = task.params?.request_id
      return typeof requestId === 'string' ? `/limits/${requestId}` : null
    }
    case 'declaration':
      return `/declarations/${task.object_id}`
    case 'policy': {
      // A declaration that does not exist yet: the task hangs off the policy,
      // and the period it is chasing is in the params.
      const period = task.params?.period_start
      return typeof period === 'string'
        ? `/declarations?policy=${task.object_id}&period=${period}`
        : `/policies/${task.object_id}`
    }
    case 'premium_instalment': {
      // An instalment has no page; the policy's premium tab is where it lives.
      const policyId = task.params?.policy_id
      return typeof policyId === 'string' ? `/policies/${policyId}?tab=premium` : null
    }
    case 'overdue_notification':
      return `/overdues/${task.object_id}`
    case 'claim':
      return `/claims/${task.object_id}`
    case 'entity_request':
      // The information manager works the request; the requester is told the
      // outcome and is sent to the company it produced (a rejection has none).
      if (task.task_type === 'entity_request_resolved') {
        const entityId = task.params?.entity_id
        return typeof entityId === 'string' ? `/entities/${entityId}` : null
      }
      return `/data/requests/${task.object_id}`
    case 'client_buyer_proposal':
      // A buyer a client proposed from the portal: resolved on the data desk.
      return '/data?view=proposals'
    case 'bank_statement_import':
      // The import's lines are resolved in Полисы › Платежи.
      return `/policies?view=payments&import=${task.object_id}`
    case 'contract_draft':
      return `/policies/contracts/${task.object_id}`
    case 'commercial_offer': {
      // The offer is worked from its submission's «Коммерческое предложение».
      const requestId = task.params?.request_id
      return typeof requestId === 'string' ? `/requests/${requestId}?focus=offer` : null
    }
    case 'limit_validation': {
      // A validation step has no page; its limit request does — the validator
      // lands on their panel, the author on the request.
      const requestId = task.params?.request_id
      if (typeof requestId !== 'string') return null
      return task.task_type === 'limit_validation' ? `/limits/${requestId}?focus=validation` : `/limits/${requestId}`
    }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Grouping and ordering
// ---------------------------------------------------------------------------

/** Buckets the Agenda groups by. `overdue` outranks every priority: a normal
 * task whose window has elapsed is more urgent than a high one that has not. */
export const AGENDA_GROUPS = ['overdue', 'urgent', 'high', 'normal'] as const
export type AgendaGroup = (typeof AGENDA_GROUPS)[number]

/** A deadline stored as a calendar DATE: a plain ISO date, or the UTC midnight
 * timestamp `due_date::timestamptz` turns one into (instalments, declarations).
 * Same reading as formatDue, which shows these without a time. */
const DATE_DEADLINE = /^(\d{4}-\d{2}-\d{2})(?:T00:00(?::00(?:\.0+)?)?(?:Z|\+00(?::00)?))?$/

/** Tashkent is UTC+5 all year (no DST), as every date in the product. */
const TASHKENT_OFFSET = '+05:00'

/**
 * The moment a deadline has passed. A date is due for the WHOLE of that day
 * in Tashkent — a payment due on 21 October is on time until midnight, not
 * late from 05:00 — which is also the SQL's reading (`due_date < current_date`
 * is what turns an instalment overdue). A real timestamp passes at itself.
 */
export function deadlinePassesAt(due: string): number {
  const date = DATE_DEADLINE.exec(due)
  if (date) return new Date(`${date[1]}T00:00:00${TASHKENT_OFFSET}`).getTime() + 86_400_000
  return new Date(due).getTime()
}

export function isOverdue(task: Pick<Task, 'due_at'>, now: Date): boolean {
  return task.due_at !== null && deadlinePassesAt(task.due_at) <= now.getTime()
}

/** The task types that come as a due / overdue pair. The database picks one
 * when it opens the row, but the row is generated lazily and can be read a
 * day later, so the screen re-derives the pair from the same clock the due
 * chip and the «Просроченные» group use — the title, the chip and the group
 * can then never disagree. */
const DUE_PAIRS: Partial<Record<TaskType, readonly [TaskType, TaskType]>> = {
  instalment_due: ['instalment_due', 'instalment_overdue'],
  instalment_overdue: ['instalment_due', 'instalment_overdue'],
  declaration_due: ['declaration_due', 'declaration_overdue'],
  declaration_overdue: ['declaration_due', 'declaration_overdue'],
}

/** The task type to show (badge, title) as of `now`. */
export function displayTaskType(task: Pick<Task, 'task_type' | 'due_at'>, now: Date): TaskType {
  const pair = DUE_PAIRS[task.task_type]
  if (!pair) return task.task_type
  return isOverdue(task, now) ? pair[1] : pair[0]
}

/** The i18n key of the row's title as of `now` (see displayTaskType). */
export function taskTitleKey(task: Pick<Task, 'task_type' | 'due_at' | 'title_key'>, now: Date): string {
  const shown = displayTaskType(task, now)
  return shown === task.task_type ? task.title_key : `agenda.tasks.${shown}`
}

/** Titles that already name the task's subject through `{{subject}}`. Every
 * other row names it on the line under the title instead, so a row never
 * says the same name twice and never says none. Mirrors the en locale
 * (asserted in catalogue.test.ts). */
export const SUBJECT_IN_TITLE: ReadonlySet<TaskType> = new Set<TaskType>([
  'buyer_needs_entity',
  'buyer_needs_rating',
  'limit_needs_decision',
  'limit_escalated',
  'limit_review_due',
  'rating_stale',
  'rating_new_statements',
])

export function groupOf(task: Pick<Task, 'due_at' | 'priority'>, now: Date): AgendaGroup {
  if (isOverdue(task, now)) return 'overdue'
  return task.priority
}

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2 }

/** Within a group: soonest due first (undated last), then priority, then age. */
export function compareTasks(a: Task, b: Task): number {
  const aDue = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY
  const bDue = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY
  if (aDue !== bDue) return aDue - bDue
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  if (byPriority !== 0) return byPriority
  return a.created_at.localeCompare(b.created_at)
}

export interface AgendaSection {
  group: AgendaGroup
  tasks: Task[]
}

/** Groups open tasks into the display buckets, dropping empty ones. */
export function groupTasks(tasks: readonly Task[], now: Date): AgendaSection[] {
  const buckets = new Map<AgendaGroup, Task[]>(AGENDA_GROUPS.map((g) => [g, []]))
  for (const task of tasks) buckets.get(groupOf(task, now))?.push(task)
  return AGENDA_GROUPS.map((group) => ({
    group,
    tasks: (buckets.get(group) ?? []).sort(compareTasks),
  })).filter((section) => section.tasks.length > 0)
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** The object kinds a row can be filtered down to, in display order. The
 * filter offers only the kinds the board actually holds, with counts. */
export const OBJECT_FILTERS = [
  'insurance_request',
  'credit_limit_request',
  'credit_limit_decision',
  'legal_entity',
  'policy',
  'declaration',
  'premium_instalment',
  'overdue_notification',
  'claim',
  'entity_request',
  'client_buyer_proposal',
  'bank_statement_import',
  'contract_draft',
  'commercial_offer',
  'limit_validation',
] as const satisfies readonly TaskObjectType[]

export interface AgendaFilters {
  /** Empty = every type. */
  taskType: TaskType | ''
  /** Empty = every object kind. */
  objectType: TaskObjectType | ''
}

export const NO_FILTERS: AgendaFilters = { taskType: '', objectType: '' }

/** The values a filter can offer: only those present, with their counts, in
 * the given order. */
export function presentValues<K extends string>(
  order: readonly K[],
  tasks: readonly Task[],
  pick: (task: Task) => string,
): { value: K; count: number }[] {
  const counts = new Map<string, number>()
  for (const task of tasks) counts.set(pick(task), (counts.get(pick(task)) ?? 0) + 1)
  return order.filter((value) => counts.has(value)).map((value) => ({ value, count: counts.get(value) ?? 0 }))
}

export function applyFilters(tasks: readonly Task[], filters: AgendaFilters): Task[] {
  return tasks.filter(
    (task) =>
      (!filters.taskType || task.task_type === filters.taskType) &&
      (!filters.objectType || task.object_type === filters.objectType),
  )
}

/** A snoozed task is out of sight until its moment passes (0055); it then
 * comes back by itself, because this is decided on read. */
export function isSnoozed(task: Pick<Task, 'snoozed_until'>, now: Date): boolean {
  return task.snoozed_until !== null && new Date(task.snoozed_until).getTime() > now.getTime()
}

/** The tasks that count: open and not snoozed. Every list, count and badge
 * reads through this, so a snoozed task disappears everywhere at once. */
export function activeTasks<T extends Pick<Task, 'snoozed_until'>>(tasks: readonly T[], now: Date): T[] {
  return tasks.filter((task) => !isSnoozed(task, now))
}

/** Badge counts for the sidebar: everything open and not snoozed, and the
 * overdue subset. */
export function agendaCounts(
  tasks: readonly Task[],
  now: Date,
): { open: number; overdue: number } {
  const active = activeTasks(tasks, now)
  return {
    open: active.length,
    overdue: active.filter((task) => isOverdue(task, now)).length,
  }
}

/**
 * A task's params are raw data (ISO dates, numbers) written by the database;
 * the title is rendered in the viewer's language, so the values must be too.
 * Dates → formatDate, `*_pct` → one decimal in the locale's notation, amounts
 * → grouped digits. Anything else passes through untouched.
 */
export function formatTaskParams(
  params: Record<string, unknown> | null | undefined,
  locale: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T|$)/.test(value)) out[key] = formatDate(value, locale)
    else if (key.endsWith('_pct') && value !== null && value !== '' && Number.isFinite(Number(value)))
      out[key] = formatAmount(Number(value), locale, 1)
    else if (key === 'amount' && value !== null && value !== '' && Number.isFinite(Number(value)))
      out[key] = formatAmount(Number(value), locale)
    else out[key] = value
  }
  return out
}
