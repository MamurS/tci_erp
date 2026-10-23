/**
 * The Agenda board (pure, tested): how open tasks become the rows a person
 * reads. Three rules live here and nowhere else.
 *
 * MERGE — one piece of work seen from several sides is ONE row:
 *   * the same task type on the same object, addressed to several people
 *     (a limit request routed to every underwriter whose authority covers
 *     it — an admin sees each copy);
 *   * tasks that describe the same event from different sides, for the same
 *     viewer: «overdue account ripe for a claim» (claims) and «you may now
 *     file a claim» (the policyholder) on one overdue notification; a
 *     request awaiting a decision and its escalation; the three ways a
 *     buyer's rating asks for work (MERGE_SETS, first wins).
 *
 * COLLAPSE — the same chore repeated over many objects is ONE row with a
 * count, the oldest due date and the summed amount, expandable into a
 * sub-table: premium instalments. Collapsing happens inside a group, never
 * across groups, so an instalment due today is never hidden inside an
 * overdue row. (The owner's example was "instalments of one policy"; the
 * book's overdue premium sits on several policies, and chasing premium is
 * one chore whichever policy it is on — the sub-table names the policy.)
 *
 * GROUP — by due date (overdue · today · this week · later, on the Tashkent
 * calendar), by company, or by family.
 */

import { deadlinePassesAt, displayTaskType, isOverdue } from './catalogue'
import { FAMILIES, TASK_FAMILY } from './families'
import type { Family } from './families'
import type { Task, TaskType } from './types'
import type { UserRole } from '../../lib/roles'

// ---------------------------------------------------------------------------
// Calendar (Tashkent is UTC+5 all year, as every date in the product)
// ---------------------------------------------------------------------------

const TASHKENT_MS = 5 * 3_600_000
const DAY_MS = 86_400_000

/** The Tashkent calendar day of a moment, as an ISO date. */
export function tashkentDay(ms: number): string {
  return new Date(ms + TASHKENT_MS).toISOString().slice(0, 10)
}

function dayNumber(isoDay: string): number {
  return Math.round(Date.parse(`${isoDay}T00:00:00Z`) / DAY_MS)
}

/** The calendar day a deadline falls on: the date itself for a date stored
 * as UTC midnight, the Tashkent day of a real timestamp otherwise. */
export function dueDay(dueAt: string): string {
  return tashkentDay(deadlinePassesAt(dueAt) - 1)
}

export type DueState =
  | { kind: 'none' }
  | { kind: 'overdue'; days: number }
  | { kind: 'today' }
  | { kind: 'future'; days: number }

/** What the row's due label says: «59 days» late, «today», «in 2 days». */
export function dueState(dueAt: string | null, now: Date): DueState {
  if (!dueAt) return { kind: 'none' }
  const days = dayNumber(dueDay(dueAt)) - dayNumber(tashkentDay(now.getTime()))
  if (isOverdue({ due_at: dueAt }, now)) return days < 0 ? { kind: 'overdue', days: -days } : { kind: 'today' }
  if (days <= 0) return { kind: 'today' }
  return { kind: 'future', days }
}

// ---------------------------------------------------------------------------
// Due buckets
// ---------------------------------------------------------------------------

export const BUCKETS = ['overdue', 'today', 'week', 'later'] as const
export type Bucket = (typeof BUCKETS)[number]

/** Sunday of the current Monday-first week, as a Tashkent day. */
function weekEndDay(now: Date): string {
  const today = Date.parse(`${tashkentDay(now.getTime())}T00:00:00Z`)
  const weekday = (new Date(today).getUTCDay() + 6) % 7 // Monday = 0
  return new Date(today + (6 - weekday) * DAY_MS).toISOString().slice(0, 10)
}

/**
 * A task without a deadline is still work: an urgent or high one belongs on
 * today's desk (an escalation, an accepted submission waiting for its
 * policy), a normal one in this week. Nothing undated hides in «Later».
 */
export function bucketOf(task: Pick<Task, 'due_at' | 'priority'>, now: Date): Bucket {
  if (!task.due_at) return task.priority === 'normal' ? 'week' : 'today'
  if (isOverdue(task, now)) return 'overdue'
  const day = dueDay(task.due_at)
  if (day <= tashkentDay(now.getTime())) return 'today'
  if (day <= weekEndDay(now)) return 'week'
  return 'later'
}

// ---------------------------------------------------------------------------
// Rows: merge, then collapse
// ---------------------------------------------------------------------------

/** Tasks on ONE object that are one piece of work; the first type present
 * leads the row (its tag, its title, its destination). */
export const MERGE_SETS: readonly (readonly TaskType[])[] = [
  ['noa_matured_to_claim', 'claim_ready_to_file'],
  ['limit_escalated', 'limit_needs_decision'],
  ['rating_new_statements', 'rating_stale', 'buyer_needs_rating'],
]

/** The chores that collapse across objects into one row with a sub-table. */
export const COLLAPSIBLE: ReadonlySet<TaskType> = new Set<TaskType>(['instalment_due', 'instalment_overdue'])

export interface AgendaRow {
  key: string
  kind: 'single' | 'merged' | 'collapsed'
  /** Leads the row: tag, title, destination. */
  lead: Task
  /** The type the row shows (due/overdue pairs re-derived on the clock). */
  displayType: TaskType
  /** Every underlying task. */
  tasks: Task[]
  /** One per distinct object — the sub-table of a collapsed row. */
  items: Task[]
  /** The earliest deadline among the tasks; null when none has one. */
  dueAt: string | null
}

function earliestDue(tasks: readonly Task[]): string | null {
  let best: string | null = null
  for (const task of tasks) {
    if (task.due_at && (best === null || deadlinePassesAt(task.due_at) < deadlinePassesAt(best))) best = task.due_at
  }
  return best
}

const PRIORITY_RANK = { urgent: 0, high: 1, normal: 2 } as const

/** The row's priority: its most pressing task's. */
export function rowPriority(row: Pick<AgendaRow, 'tasks'>): Task['priority'] {
  return row.tasks.reduce<Task['priority']>(
    (best, t) => (PRIORITY_RANK[t.priority] < PRIORITY_RANK[best] ? t.priority : best),
    'normal',
  )
}

/** Merge first: one row per piece of work. */
export function mergeTasks(tasks: readonly Task[], now: Date): AgendaRow[] {
  const byObject = new Map<string, Task[]>()
  for (const task of tasks) {
    const list = byObject.get(task.object_id) ?? []
    list.push(task)
    byObject.set(task.object_id, list)
  }

  const rows: AgendaRow[] = []
  for (const [objectId, list] of byObject) {
    const remaining = [...list]
    for (const set of MERGE_SETS) {
      const members = remaining.filter((t) => set.includes(displayTaskType(t, now)))
      if (members.length === 0) continue
      for (const m of members) remaining.splice(remaining.indexOf(m), 1)
      const leadType = set.find((type) => members.some((t) => displayTaskType(t, now) === type)) as TaskType
      const lead = members.find((t) => displayTaskType(t, now) === leadType) as Task
      const distinctTypes = new Set(members.map((t) => displayTaskType(t, now)))
      rows.push({
        key: `${objectId}:${set[0]}`,
        kind: distinctTypes.size > 1 ? 'merged' : 'single',
        lead,
        displayType: leadType,
        tasks: members,
        items: [lead],
        dueAt: earliestDue(members),
      })
    }
    // Same type on the same object (per-person copies): one row.
    const byType = new Map<TaskType, Task[]>()
    for (const task of remaining) {
      const type = displayTaskType(task, now)
      byType.set(type, [...(byType.get(type) ?? []), task])
    }
    for (const [type, same] of byType) {
      rows.push({
        key: `${objectId}:${type}`,
        kind: 'single',
        lead: same[0] as Task,
        displayType: type,
        tasks: same,
        items: [same[0] as Task],
        dueAt: earliestDue(same),
      })
    }
  }
  return rows
}

/** Collapse inside one group: COLLAPSIBLE single rows of one type become one
 * row when there are two or more of them. */
export function collapseRows(rows: readonly AgendaRow[]): AgendaRow[] {
  const out: AgendaRow[] = []
  const pools = new Map<TaskType, AgendaRow[]>()
  for (const row of rows) {
    if (row.kind === 'single' && COLLAPSIBLE.has(row.displayType)) {
      pools.set(row.displayType, [...(pools.get(row.displayType) ?? []), row])
    } else {
      out.push(row)
    }
  }
  for (const [type, pool] of pools) {
    if (pool.length === 1) {
      out.push(pool[0] as AgendaRow)
      continue
    }
    const items = pool.map((r) => r.lead).sort(compareDue)
    out.push({
      key: `collapsed:${type}:${items.map((i) => i.object_id).join(',')}`,
      kind: 'collapsed',
      lead: items[0] as Task,
      displayType: type,
      tasks: pool.flatMap((r) => r.tasks),
      items,
      dueAt: earliestDue(items),
    })
  }
  return out
}

function compareDue(a: Pick<Task, 'due_at'>, b: Pick<Task, 'due_at'>): number {
  const ad = a.due_at ? deadlinePassesAt(a.due_at) : Number.POSITIVE_INFINITY
  const bd = b.due_at ? deadlinePassesAt(b.due_at) : Number.POSITIVE_INFINITY
  return ad - bd
}

/** Within a group: soonest deadline first (undated last), then priority,
 * then the oldest task. */
export function compareRows(a: AgendaRow, b: AgendaRow): number {
  const byDue = compareDue({ due_at: a.dueAt }, { due_at: b.dueAt })
  if (byDue !== 0 && Number.isFinite(byDue)) return byDue
  if (a.dueAt && !b.dueAt) return -1
  if (!a.dueAt && b.dueAt) return 1
  const byPriority = PRIORITY_RANK[rowPriority(a)] - PRIORITY_RANK[rowPriority(b)]
  if (byPriority !== 0) return byPriority
  return a.lead.created_at.localeCompare(b.lead.created_at)
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export const GROUPINGS = ['due', 'company', 'type'] as const
export type Grouping = (typeof GROUPINGS)[number]

export interface RowGroup {
  /** A bucket, a family, or a company name ('' = no company). */
  key: string
  kind: Grouping
  rows: AgendaRow[]
}

/** The row's due bucket: its earliest deadline, or its priority if undated. */
export function rowBucket(row: AgendaRow, now: Date): Bucket {
  return bucketOf({ due_at: row.dueAt, priority: rowPriority(row) }, now)
}

/**
 * Tasks → groups of rows. Merge first (one row per piece of work), then
 * assign each row to its group, then collapse inside each group.
 * `companyOf` names the company a row is about (for company grouping).
 */
export function buildBoard(
  tasks: readonly Task[],
  grouping: Grouping,
  now: Date,
  companyOf: (row: AgendaRow) => string | null,
): RowGroup[] {
  const merged = mergeTasks(tasks, now)
  const groups = new Map<string, AgendaRow[]>()
  const keyOf = (row: AgendaRow): string =>
    grouping === 'due'
      ? rowBucket(row, now)
      : grouping === 'type'
        ? TASK_FAMILY[row.displayType]
        : (companyOf(row) ?? '')
  for (const row of merged) {
    const key = keyOf(row)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }

  const order: string[] =
    grouping === 'due'
      ? [...BUCKETS]
      : grouping === 'type'
        ? [...FAMILIES]
        : [...groups.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))

  return order
    .filter((key) => groups.has(key))
    .map((key) => ({
      key,
      kind: grouping,
      rows: collapseRows(groups.get(key) ?? []).sort(compareRows),
    }))
}

// ---------------------------------------------------------------------------
// Filters (chips) — kept in the URL
// ---------------------------------------------------------------------------

export interface BoardFilter {
  /** null = all families. */
  family: Family | null
  mine: boolean
  snoozed: boolean
}

export const NO_FILTER: BoardFilter = { family: null, mine: false, snoozed: false }

export function readFilter(params: URLSearchParams): BoardFilter {
  const family = params.get('family')
  return {
    family: family && (FAMILIES as readonly string[]).includes(family) ? (family as Family) : null,
    mine: params.get('mine') === '1',
    snoozed: params.get('snoozed') === '1',
  }
}

export function writeFilter(params: URLSearchParams, filter: BoardFilter): URLSearchParams {
  const next = new URLSearchParams(params)
  if (filter.family) next.set('family', filter.family)
  else next.delete('family')
  if (filter.mine) next.set('mine', '1')
  else next.delete('mine')
  if (filter.snoozed) next.set('snoozed', '1')
  else next.delete('snoozed')
  return next
}

/** Is the task addressed to me by name (not merely to a role I hold)? */
export function assignedToMe(task: Pick<Task, 'target_user'>, me: string | null): boolean {
  return me !== null && task.target_user === me
}

/** tci.task_is_mine (0065): addressed to me by name, or to the role I act in.
 * Admin used to pass every task; since 0065 it acts on none of another
 * department's, so «Моя повестка» shows exactly what the caller may work
 * (admin keeps reading every task through the tasks read policy). */
export function isMine(
  task: Pick<Task, 'target_user' | 'target_role'>,
  me: string | null,
  roles: readonly UserRole[],
): boolean {
  return assignedToMe(task, me) || (task.target_role !== null && roles.includes(task.target_role))
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

/** The money a task carries, when it carries any. Group tasks state their
 * exposure in UZS already; declaration totals carry no currency and count
 * as no amount rather than a wrong one. */
export function amountOf(task: Pick<Task, 'task_type' | 'params'>): { amount: number; currency: string } | null {
  const p = task.params ?? {}
  const num = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  if (task.task_type === 'group_exposure_near_limit' || task.task_type === 'group_limit_missing') {
    const exposure = num(p.exposure_uzs)
    return exposure === null ? null : { amount: exposure, currency: 'UZS' }
  }
  const amount = num(p.amount)
  const currency = typeof p.currency === 'string' ? p.currency : null
  return amount === null || currency === null ? null : { amount, currency }
}

export interface UzsSum {
  /** Sum of the amounts that could be converted; null when none could. */
  uzs: number | null
  /** How many amounts had no rate and were left out. */
  missingRates: number
}

/**
 * Amounts in UZS by the app's fx rule (`rateFor` is latestUzsRate). A row
 * without a rate is left out and COUNTED, never treated as zero. Merged
 * tasks describe one amount, so each row contributes its items, not every
 * task behind it.
 */
export function sumUzs(
  rows: readonly AgendaRow[],
  rateFor: (currency: string) => number | null,
): UzsSum {
  let uzs: number | null = null
  let missingRates = 0
  for (const row of rows) {
    for (const item of row.items) {
      const money = amountOf(item)
      if (!money) continue
      const rate = rateFor(money.currency)
      if (rate === null) {
        missingRates += 1
        continue
      }
      uzs = (uzs ?? 0) + money.amount * rate
    }
  }
  return { uzs, missingRates }
}
