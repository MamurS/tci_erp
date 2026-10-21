/** Data access for the Agenda (migration 0024).
 *
 * Reading the board calls tci.refresh_agenda() first: the two time-based task
 * kinds are generated and retired lazily, on read, so there is no cron. The
 * call is idempotent — the partial unique index absorbs repeats and stale
 * conditions are cancelled — so a second read in the same minute is a no-op.
 *
 * RLS decides what comes back: a user sees tasks targeted at their roles or
 * at themselves, admin sees all. Nothing here filters by role. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import { SUBJECT_IN_TITLE } from './catalogue'
import type { Task } from './types'

const KEYS = {
  tasks: ['agenda', 'tasks'] as const,
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
  return useQuery({
    queryKey: KEYS.tasks,
    enabled,
    staleTime: 60_000,
    queryFn: async (): Promise<Task[]> => {
      await refreshAgenda()
      return fetchOpenTasks()
    },
  })
}

/** Manual completion. tci.complete_task refuses every type except
 * submission_declined — catalogue.ts mirrors that so the button is only ever
 * offered where the database will accept it. */
export function useCompleteTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (taskId: string): Promise<void> => {
      const { error } = await tci().rpc('complete_task', { p_task_id: taskId })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEYS.tasks })
    },
  })
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
      return subjectFor(task, subjects)
    default:
      return null
  }
}
