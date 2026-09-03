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

import type { Task, TaskPriority, TaskType } from './types'

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
}

/** Mirrors tci.complete_task's guard: it refuses every other type. Two are
 * manual — `submission_declined` and `uncovered_excess_review`. */
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
      return task.task_type === 'group_exposure_near_limit' ||
        task.task_type === 'group_limit_missing'
        ? `/entities/${task.object_id}?tab=group`
        : `/entities/${task.object_id}`
    case 'credit_limit_request':
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

export function isOverdue(task: Pick<Task, 'due_at'>, now: Date): boolean {
  return task.due_at !== null && new Date(task.due_at).getTime() <= now.getTime()
}

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

/** The object kinds a row can be filtered down to, in display order. */
export const OBJECT_FILTERS = [
  'insurance_request',
  'credit_limit_request',
  'credit_limit_decision',
  'legal_entity',
] as const

export interface AgendaFilters {
  /** Empty = every type. */
  taskType: TaskType | ''
  /** Empty = every object kind. */
  objectType: (typeof OBJECT_FILTERS)[number] | ''
}

export const NO_FILTERS: AgendaFilters = { taskType: '', objectType: '' }

export function applyFilters(tasks: readonly Task[], filters: AgendaFilters): Task[] {
  return tasks.filter(
    (task) =>
      (!filters.taskType || task.task_type === filters.taskType) &&
      (!filters.objectType || task.object_type === filters.objectType),
  )
}

/** Badge counts for the sidebar: everything open, and the overdue subset. */
export function agendaCounts(
  tasks: readonly Task[],
  now: Date,
): { open: number; overdue: number } {
  return {
    open: tasks.length,
    overdue: tasks.filter((task) => isOverdue(task, now)).length,
  }
}
