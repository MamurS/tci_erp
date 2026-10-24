/** Data access for the Agenda (migration 0024).
 *
 * Reading the board calls tci.refresh_agenda() first: the two time-based task
 * kinds are generated and retired lazily, on read, so there is no cron. The
 * call is idempotent — the partial unique index absorbs repeats and stale
 * conditions are cancelled — so a second read in the same minute is a no-op.
 *
 * RLS decides what comes back: a user sees tasks targeted at their acting role
 * or at themselves, admin sees all. The board then keeps what the caller may
 * WORK (isMine, the mirror of tci.task_is_mine): for everyone but admin that
 * is the same set; admin, a technical role since 0065, acts on no other
 * department's task. */

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../../auth/AuthContext'
import { optimistic, patch, pendingId } from '../../lib/optimistic'
import { tci } from '../../lib/supabase'
import { isMine, tashkentDay } from './board'
import { SUBJECT_IN_TITLE } from './catalogue'
import { clearedPlus, asIds, commentsKeyHolds, withAnswers, withComment, withoutTasks, withSnooze } from './optimistic'
import type { Task, TaskComment } from './types'

const KEYS = {
  tasks: ['agenda', 'tasks'] as const,
  commentsAll: ['agenda', 'comments'] as const,
  comments: (ids: readonly string[]) => ['agenda', 'comments', ids] as const,
  events: ['agenda', 'events'] as const,
  cleared: ['agenda', 'cleared'] as const,
  justifications: (ids: readonly string[]) => ['agenda', 'justifications', ids] as const,
  validationComments: (ids: readonly string[]) => ['agenda', 'validation-comments', ids] as const,
}

async function refreshAgenda(): Promise<void> {
  const { error } = await tci().rpc('refresh_agenda')
  // A refusal here must not blank the board: the tasks the event mapping
  // already opened are still worth showing. Only the two lazy kinds go stale.
  if (error && error.code !== '42501') throw error
}

async function fetchOpenTasks(): Promise<Task[]> {
  const { data, error } = await tci()
    .from('tasks')
    .select('*')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as Task[]
}

/** The board. The screen and the sidebar badge share ONE query — same key,
 * same queryFn — so the two can never disagree about what the agenda holds.
 *
 * That is also why the lazy generation lives inside this queryFn rather than
 * in the screen: with two queryFns on one key, whichever observer mounted
 * first would decide whether refresh_agenda ran at all. staleTime is what
 * keeps it cheap — the sidebar renders on every page, but a cached query does
 * not refetch, so the generation runs about once a minute, not once a click. */
export function useAgendaTasks(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options
  const { session, roles } = useAuth()
  const me = session?.user.id ?? null
  // A stable select: TanStack Query reuses its result while the data and this
  // function are unchanged, so the board's memos are not recomputed per render.
  const mine = useCallback((tasks: Task[]) => tasks.filter((task) => isMine(task, me, roles)), [me, roles])
  return useQuery({
    queryKey: KEYS.tasks,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<Task[]> => {
      await refreshAgenda()
      return fetchOpenTasks()
    },
    select: mine,
  })
}

/** Manual completion. tci.complete_task refuses every type except
 * submission_declined — catalogue.ts mirrors that so the button is only ever
 * offered where the database will accept it.
 *
 * Optimistic (lib/optimistic.ts): the tasks leave the board — and the
 * sidebar badge, which reads the same key — in the frame after the click;
 * a refusal puts them back. Each RPC answers with the task row, which the
 * cache takes, so the board is not refetched. Several tasks of one row go
 * out together, not one round trip after another. */
export function useCompleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['agenda', 'complete'],
    mutationFn: (taskIds: string | readonly string[]): Promise<Task[]> =>
      Promise.all(
        asIds(taskIds).map(async (taskId) => {
          const { data, error } = await tci().rpc('complete_task', { p_task_id: taskId })
          if (error) throw error
          return data as unknown as Task
        }),
      ),
    ...optimistic<string | readonly string[], Task[]>(qc, {
      patches: () => [
        patch<Task[], string | readonly string[]>(KEYS.tasks, (tasks, v) => withoutTasks(tasks, asIds(v)), { exact: true }),
        patch<number, string | readonly string[]>(KEYS.cleared, (n, v) => clearedPlus(n, asIds(v).length), { exact: true }),
      ],
      answer: (client, rows) => client.setQueryData<Task[]>(KEYS.tasks, (tasks) => tasks && withAnswers(tasks, rows)),
      invalidate: () => [KEYS.cleared, KEYS.events],
    }),
  })
}

// ---------------------------------------------------------------------------
// Snooze and comments (migration 0055)
// ---------------------------------------------------------------------------

/** tci.snooze_task: out of sight until `until`. Per task — a department
 * task is put aside for the department. Optimistic: the row leaves the
 * board at once (activeTasks hides a snoozed task everywhere). */
export function useSnoozeTask() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const me = session?.user.id ?? null
  type Vars = { taskId?: string; taskIds?: readonly string[]; until: Date }
  const of = (v: Vars) => (v.taskIds ? [...v.taskIds] : v.taskId ? [v.taskId] : [])
  return useMutation({
    mutationKey: ['agenda', 'snooze'],
    mutationFn: (v: Vars): Promise<Task[]> =>
      Promise.all(
        of(v).map(async (taskId) => {
          const { data, error } = await tci().rpc('snooze_task', { p_task_id: taskId, p_until: v.until.toISOString() })
          if (error) throw error
          return data as unknown as Task
        }),
      ),
    ...optimistic<Vars, Task[]>(qc, {
      patches: () => [
        patch<Task[], Vars>(KEYS.tasks, (tasks, v) => withSnooze(tasks, of(v), v.until.toISOString(), me), {
          exact: true,
        }),
      ],
      answer: (client, rows) => client.setQueryData<Task[]>(KEYS.tasks, (tasks) => tasks && withAnswers(tasks, rows)),
      invalidate: () => [KEYS.events],
    }),
  })
}

export function useUnsnoozeTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['agenda', 'unsnooze'],
    mutationFn: (taskIds: string | readonly string[]): Promise<Task[]> =>
      Promise.all(
        asIds(taskIds).map(async (taskId) => {
          const { data, error } = await tci().rpc('unsnooze_task', { p_task_id: taskId })
          if (error) throw error
          return data as unknown as Task
        }),
      ),
    ...optimistic<string | readonly string[], Task[]>(qc, {
      patches: () => [
        patch<Task[], string | readonly string[]>(KEYS.tasks, (tasks, v) => withSnooze(tasks, asIds(v), null, null), {
          exact: true,
        }),
      ],
      answer: (client, rows) => client.setQueryData<Task[]>(KEYS.tasks, (tasks) => tasks && withAnswers(tasks, rows)),
      invalidate: () => [KEYS.events],
    }),
  })
}

/** A comment appears under the task at once (a pending placeholder, then
 * the stored row the RPC answers with); a refusal takes it back. */
export function useAddTaskComment() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const me = session?.user.id ?? ''
  type Vars = { taskId: string; body: string }
  return useMutation({
    mutationKey: ['agenda', 'comment'],
    mutationFn: async ({ taskId, body }: Vars): Promise<TaskComment> => {
      const { data, error } = await tci().rpc('add_task_comment', { p_task_id: taskId, p_body: body })
      if (error) throw error
      return data as unknown as TaskComment
    },
    ...optimistic<Vars, TaskComment>(qc, {
      patches: () => [
        patch<TaskComment[], Vars>(KEYS.commentsAll, (comments, v, key) =>
          commentsKeyHolds(key, v.taskId)
            ? withComment(comments, {
                id: pendingId(),
                task_id: v.taskId,
                author_id: me,
                body: v.body.trim(),
                created_at: new Date().toISOString(),
              })
            : comments,
        ),
      ],
      answer: (client, row) => {
        for (const [key] of client.getQueriesData<TaskComment[]>({ queryKey: KEYS.commentsAll })) {
          if (commentsKeyHolds(key, row.task_id)) {
            client.setQueryData<TaskComment[]>(key, (comments) => comments && withComment(comments, row))
          }
        }
      },
      invalidate: () => [KEYS.events],
    }),
  })
}

/** Comments on the given tasks, oldest first. RLS returns only those on
 * tasks the caller can see. */
export function useTaskComments(taskIds: readonly string[]) {
  const unique = [...new Set(taskIds)].sort()
  return useQuery({
    queryKey: KEYS.comments(unique),
    enabled: unique.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<TaskComment[]> => {
      const { data, error } = await tci()
        .from('task_comments')
        .select('id, task_id, author_id, body, created_at')
        .in('task_id', unique)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as TaskComment[]
    },
    placeholderData: [],
  })
}

/** Tasks closed today (Tashkent) that the caller can see — the «cleared
 * today» figure. A count, not rows. */
export function useClearedToday() {
  return useQuery({
    queryKey: KEYS.cleared,
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      const startOfDay = new Date(`${tashkentDay(Date.now())}T00:00:00+05:00`).toISOString()
      const { count, error } = await tci()
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'done')
        .gte('completed_at', startOfDay)
      if (error) throw error
      return count ?? 0
    },
  })
}

/** The justification of each limit request — the origin comment of a
 * decision task (the requester's, or the policyholder's from the portal). */
export interface LimitJustification {
  id: string
  justification: string | null
  requested_by: string | null
  created_at: string
}

export function useLimitJustifications(requestIds: readonly string[]) {
  const ids = [...new Set(requestIds)].sort()
  return useQuery({
    queryKey: KEYS.justifications(ids),
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, LimitJustification>> => {
      const { data, error } = await tci()
        .from('credit_limit_requests')
        .select('id, justification, requested_by, created_at')
        .in('id', ids)
      if (error) throw error
      return new Map(((data ?? []) as LimitJustification[]).map((r) => [r.id, r]))
    },
  })
}

/** The two comments of a validation step (0060): what the author asked and
 * what the validator answered. Read from tci.limit_validations, which shows a
 * step to admin and to the people of its chain — exactly who holds these
 * tasks. */
export interface ValidationComments {
  id: string
  comment: string | null
  resolution_comment: string | null
  proposed_by: string
  resolved_by: string | null
  created_at: string
  resolved_at: string | null
}

export function useValidationComments(validationIds: readonly string[]) {
  const ids = [...new Set(validationIds)].sort()
  return useQuery({
    queryKey: KEYS.validationComments(ids),
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, ValidationComments>> => {
      const { data, error } = await tci()
        .from('limit_validations')
        .select('id, comment, resolution_comment, proposed_by, resolved_by, created_at, resolved_at')
        .in('id', ids)
      if (error) throw error
      return new Map(((data ?? []) as ValidationComments[]).map((r) => [r.id, r]))
    },
  })
}

/** The origin comment a validation task shows, from its step. */
export function validationOrigin(
  task: Pick<Task, 'task_type' | 'object_type' | 'object_id'>,
  comments: Map<string, ValidationComments> | undefined,
): { body: string; author: string | null; at: string; side: 'validationAuthor' | 'validator' } | null {
  if (task.object_type !== 'limit_validation') return null
  const step = comments?.get(task.object_id)
  if (!step) return null
  if (task.task_type === 'limit_validation_result') {
    const body = step.resolution_comment?.trim()
    return body ? { body, author: step.resolved_by, at: step.resolved_at ?? step.created_at, side: 'validator' } : null
  }
  const body = step.comment?.trim()
  return body ? { body, author: step.proposed_by, at: step.created_at, side: 'validationAuthor' } : null
}

// ---------------------------------------------------------------------------
// Subjects: the human name behind each task's object
// ---------------------------------------------------------------------------

/** A policy as a row names it: «TCI-2026-0001 · Samarkand Textile». */
export interface PolicySubject {
  number: string
  holder: string | null
}

export interface TaskSubjects {
  entities: Record<string, string>
  requests: Record<string, string>
  /** insurance request id -> the applicant's name */
  requestApplicants: Record<string, string>
  /** limit request id -> the buyer's name */
  limitRequests: Record<string, string>
  /** policy id -> number and policyholder */
  policies: Record<string, PolicySubject>
  /** claim id -> the policy it is filed under */
  claims: Record<string, PolicySubject>
}

const EMPTY_SUBJECTS: TaskSubjects = {
  entities: {},
  requests: {},
  requestApplicants: {},
  limitRequests: {},
  policies: {},
  claims: {},
}

/** The policy a task is about, when it is about one: the object itself, or
 * the `policy_id` the database put in the params (instalments, declarations,
 * overdue notifications, claims). */
export function policyIdOf(task: Pick<Task, 'object_type' | 'object_id' | 'params'>): string | null {
  if (task.object_type === 'policy') return task.object_id
  const fromParams = task.params?.policy_id
  return typeof fromParams === 'string' ? fromParams : null
}

const none = { data: [], error: null }

/** One batched lookup per object kind, so a full board is a handful of
 * queries and not one per row. Ids the caller cannot see are simply absent —
 * RLS decides, and a task always renders without its subject name. */
export function useTaskSubjects(tasks: readonly Task[] | undefined) {
  const entityIds = new Set<string>()
  const requestIds = new Set<string>()
  const limitRequestIds = new Set<string>()
  const policyIds = new Set<string>()
  const claimIds = new Set<string>()

  for (const task of tasks ?? []) {
    if (task.object_type === 'legal_entity') entityIds.add(task.object_id)
    if (task.object_type === 'insurance_request') requestIds.add(task.object_id)
    if (task.object_type === 'credit_limit_request') limitRequestIds.add(task.object_id)
    if (task.object_type === 'claim') claimIds.add(task.object_id)
    // The buyer of an overdue notification, a group parent, a limit's buyer.
    const entityFromParams = task.params?.entity_id
    if (typeof entityFromParams === 'string') entityIds.add(entityFromParams)
    const fromParams = task.params?.request_id
    if (typeof fromParams === 'string') limitRequestIds.add(fromParams)
    const policyId = policyIdOf(task)
    if (policyId) policyIds.add(policyId)
  }

  const entityKey = [...entityIds].sort()
  const requestKey = [...requestIds].sort()
  const limitKey = [...limitRequestIds].sort()
  const policyKey = [...policyIds].sort()
  const claimKey = [...claimIds].sort()

  return useQuery({
    queryKey: ['agenda', 'subjects', entityKey, requestKey, limitKey, policyKey, claimKey],
    enabled: entityKey.length + requestKey.length + limitKey.length + policyKey.length + claimKey.length > 0,
    queryFn: async (): Promise<TaskSubjects> => {
      const [entities, requests, limits, policies, claims] = await Promise.all([
        entityKey.length ? tci().from('legal_entities').select('id, name').in('id', entityKey) : none,
        requestKey.length
          ? tci().from('insurance_requests').select('id, request_number, legal_entities(name)').in('id', requestKey)
          : none,
        limitKey.length
          ? tci().from('credit_limit_requests').select('id, legal_entities(name)').in('id', limitKey)
          : none,
        policyKey.length
          ? tci().from('policies').select('id, policy_number, legal_entities(name)').in('id', policyKey)
          : none,
        claimKey.length
          ? tci().from('v_claims').select('id, policy_number, policyholder_name').in('id', claimKey)
          : none,
      ])
      // A kind the caller may not read must not blank the others: the row
      // still renders, it just names less.
      const rows = <T,>(result: { data: unknown; error: unknown }): T[] =>
        result.error ? [] : ((result.data ?? []) as T[])

      const result: TaskSubjects = {
        entities: {},
        requests: {},
        requestApplicants: {},
        limitRequests: {},
        policies: {},
        claims: {},
      }
      for (const row of rows<{ id: string; name: string }>(entities)) {
        result.entities[row.id] = row.name
      }
      for (const row of rows<{ id: string; request_number: string; legal_entities: { name: string } | null }>(
        requests,
      )) {
        result.requests[row.id] = row.request_number
        if (row.legal_entities?.name) result.requestApplicants[row.id] = row.legal_entities.name
      }
      for (const row of rows<{ id: string; legal_entities: { name: string } | null }>(limits)) {
        if (row.legal_entities?.name) result.limitRequests[row.id] = row.legal_entities.name
      }
      for (const row of rows<{ id: string; policy_number: string; legal_entities: { name: string } | null }>(
        policies,
      )) {
        result.policies[row.id] = { number: row.policy_number, holder: row.legal_entities?.name ?? null }
      }
      for (const row of rows<{ id: string; policy_number: string; policyholder_name: string | null }>(claims)) {
        result.claims[row.id] = { number: row.policy_number, holder: row.policyholder_name }
      }
      return result
    },
    placeholderData: EMPTY_SUBJECTS,
  })
}

/** The name a title interpolates as `{{subject}}`, or null when nothing is
 * resolvable. */
export function subjectFor(task: Task, subjects: TaskSubjects | undefined): string | null {
  if (!subjects) return null
  switch (task.object_type) {
    case 'legal_entity':
      return subjects.entities[task.object_id] ?? null
    case 'insurance_request':
      return (
        subjects.requests[task.object_id] ??
        (typeof task.params?.request_number === 'string' ? task.params.request_number : null)
      )
    case 'credit_limit_request':
      return subjects.limitRequests[task.object_id] ?? null
    case 'credit_limit_decision': {
      const requestId = task.params?.request_id
      return typeof requestId === 'string' ? (subjects.limitRequests[requestId] ?? null) : null
    }
    case 'limit_validation':
    case 'rating_proposal_step':
      // The buyer's name rides on the task (0060's mapping copies it; 0073 too).
      return typeof task.params?.entity_name === 'string' ? task.params.entity_name : null
    default:
      return null
  }
}

/** Titles that already carry the policy number; their context line names the
 * policyholder alone. */
const POLICY_NUMBER_IN_TITLE: ReadonlySet<Task['task_type']> = new Set<Task['task_type']>([
  'noa_matured_to_claim',
  'claim_ready_to_file',
])

function policyLine(task: Task, policy: PolicySubject | undefined): string | null {
  const number = policy?.number ?? (typeof task.params?.policy_number === 'string' ? task.params.policy_number : null)
  const holder = policy?.holder ?? null
  if (POLICY_NUMBER_IN_TITLE.has(task.task_type)) return holder
  return [number, holder].filter(Boolean).join(' · ') || null
}

/**
 * The line under a task's title that says WHAT it is about — «TCI-2026-0001 ·
 * Samarkand Textile» under «Платёж 1 просрочен с 23 авг.», the applicant under
 * a submission, the buyer under a held decision. Null when the title already
 * names its subject (SUBJECT_IN_TITLE) or nothing is resolvable.
 */
export function contextFor(task: Task, subjects: TaskSubjects | undefined): string | null {
  if (!subjects || SUBJECT_IN_TITLE.has(task.task_type)) return null
  switch (task.object_type) {
    case 'policy':
    case 'declaration':
    case 'premium_instalment':
    case 'overdue_notification': {
      const policyId = policyIdOf(task)
      return policyLine(task, policyId ? subjects.policies[policyId] : undefined)
    }
    case 'claim': {
      const policyId = policyIdOf(task)
      return policyLine(task, (policyId ? subjects.policies[policyId] : undefined) ?? subjects.claims[task.object_id])
    }
    case 'insurance_request':
      return subjects.requestApplicants[task.object_id] ?? null
    case 'credit_limit_request':
    case 'credit_limit_decision':
    case 'limit_validation':
    case 'rating_proposal_step':
      return subjectFor(task, subjects)
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Provenance and history (the event stream; staff read it, 0019)
// ---------------------------------------------------------------------------

export interface WorkflowEvent {
  id: string
  event_type: string
  object_type: string
  object_id: string
  actor: string | null
  payload: Record<string, unknown>
  created_at: string
}

/** Every event on the given objects, oldest first: the status history the
 * triage panel shows, and the event that opened a task (its provenance). */
export function useObjectEvents(objectIds: readonly string[]) {
  const ids = [...new Set(objectIds)].sort()
  return useQuery({
    queryKey: ['agenda', 'events', ids] as const,
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<WorkflowEvent[]> => {
      const { data, error } = await tci()
        .from('workflow_events')
        .select('id, event_type, object_type, object_id, actor, payload, created_at')
        .in('object_id', ids)
        .order('created_at', { ascending: true })
        .limit(200)
      if (error) throw error
      return (data ?? []) as WorkflowEvent[]
    },
  })
}
