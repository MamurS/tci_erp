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
import type { Task } from './types'

const KEYS = {
  tasks: ['agenda', 'tasks'] as const,
}

async function refreshAgenda(): Promise<void> {
  const { error } = await tci().rpc('refresh_agenda')
  // A refusal here must not blank the board: the tasks the event mapping
  // already opened are still worth showing. Only the two lazy kinds go stale.
  if (error && error.code !== 'P0004') throw error
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

/** The board. `refresh` is off for the sidebar badge — one lazy generation
 * per screen load is enough, and the badge renders on every page. */
export function useAgendaTasks(options: { enabled?: boolean; refresh?: boolean } = {}) {
  const { enabled = true, refresh = true } = options
  return useQuery({
    queryKey: KEYS.tasks,
    enabled,
    queryFn: async (): Promise<Task[]> => {
      if (refresh) await refreshAgenda()
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

export interface TaskSubjects {
  entities: Record<string, string>
  requests: Record<string, string>
  /** limit request id -> the buyer's name */
  limitRequests: Record<string, string>
}

const EMPTY_SUBJECTS: TaskSubjects = { entities: {}, requests: {}, limitRequests: {} }

/** One batched lookup per object kind, so a full board is three queries and
 * not one per row. Ids the caller cannot see are simply absent — RLS decides,
 * and a task always renders without its subject name. */
export function useTaskSubjects(tasks: readonly Task[] | undefined) {
  const entityIds = new Set<string>()
  const requestIds = new Set<string>()
  const limitRequestIds = new Set<string>()

  for (const task of tasks ?? []) {
    if (task.object_type === 'legal_entity') entityIds.add(task.object_id)
    if (task.object_type === 'insurance_request') requestIds.add(task.object_id)
    if (task.object_type === 'credit_limit_request') limitRequestIds.add(task.object_id)
    const fromParams = task.params?.request_id
    if (typeof fromParams === 'string') limitRequestIds.add(fromParams)
  }

  const entityKey = [...entityIds].sort()
  const requestKey = [...requestIds].sort()
  const limitKey = [...limitRequestIds].sort()

  return useQuery({
    queryKey: ['agenda', 'subjects', entityKey, requestKey, limitKey],
    enabled: entityKey.length + requestKey.length + limitKey.length > 0,
    queryFn: async (): Promise<TaskSubjects> => {
      const [entities, requests, limits] = await Promise.all([
        entityKey.length
          ? tci().from('legal_entities').select('id, name').in('id', entityKey)
          : Promise.resolve({ data: [], error: null }),
        requestKey.length
          ? tci().from('insurance_requests').select('id, request_number').in('id', requestKey)
          : Promise.resolve({ data: [], error: null }),
        limitKey.length
          ? tci()
              .from('credit_limit_requests')
              .select('id, legal_entities(name)')
              .in('id', limitKey)
          : Promise.resolve({ data: [], error: null }),
      ])
      if (entities.error) throw entities.error
      if (requests.error) throw requests.error
      if (limits.error) throw limits.error

      const result: TaskSubjects = { entities: {}, requests: {}, limitRequests: {} }
      for (const row of (entities.data ?? []) as { id: string; name: string }[]) {
        result.entities[row.id] = row.name
      }
      for (const row of (requests.data ?? []) as { id: string; request_number: string }[]) {
        result.requests[row.id] = row.request_number
      }
      for (const row of (limits.data ?? []) as unknown as {
        id: string
        legal_entities: { name: string } | null
      }[]) {
        if (row.legal_entities?.name) result.limitRequests[row.id] = row.legal_entities.name
      }
      return result
    },
    placeholderData: EMPTY_SUBJECTS,
  })
}

/** The name to show beside a task, or null when nothing is resolvable. */
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
