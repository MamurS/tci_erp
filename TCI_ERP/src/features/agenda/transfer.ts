/** Handing Agenda tasks to a colleague (migration 0092) — the mirror of
 * tci.task_transfer_blocked: the types addressed by eligibility (a level's
 * members, the colleagues who may answer) are never handed on by hand, and
 * a client's task never moves. The database refuses the rest. */

import type { Task } from './types'

export const TRANSFER_BLOCKED: readonly Task['task_type'][] = ['limit_validation', 'rating_proposal']

export function transferable(task: Pick<Task, 'task_type' | 'target_role' | 'status'>): boolean {
  return task.status === 'open' && task.target_role !== 'client' && !TRANSFER_BLOCKED.includes(task.task_type)
}
