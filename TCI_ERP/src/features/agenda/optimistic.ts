/** What a task write changes in the cached board, before and after the
 * server answers. Pure: (rows, change) => rows. The board query holds only
 * OPEN tasks (api.ts), so a task done leaves it; a snoozed one stays, with
 * its moment, and `activeTasks` (catalogue.ts) hides it everywhere at once. */

import { isPendingId } from '../../lib/optimistic'
import type { Task, TaskComment } from './types'

export function asIds(taskIds: string | readonly string[]): string[] {
  return typeof taskIds === 'string' ? [taskIds] : [...taskIds]
}

/** Done: the tasks leave the open board. */
export function withoutTasks(tasks: readonly Task[], taskIds: readonly string[]): Task[] {
  const gone = new Set(taskIds)
  return tasks.filter((task) => !gone.has(task.id))
}

/** Snoozed until `until` by `by` (null while the caller is unknown). */
export function withSnooze(
  tasks: readonly Task[],
  taskIds: readonly string[],
  until: string | null,
  by: string | null,
): Task[] {
  const hit = new Set(taskIds)
  return tasks.map((task) => (hit.has(task.id) ? { ...task, snoozed_until: until, snoozed_by: until ? by : null } : task))
}

/** The server's answer: each returned row replaces its cached one; a row
 * that is no longer open leaves the board. */
export function withAnswers(tasks: readonly Task[], answers: readonly Task[]): Task[] {
  const byId = new Map(answers.map((task) => [task.id, task]))
  return tasks.flatMap((task) => {
    const answer = byId.get(task.id)
    if (!answer) return [task]
    return answer.status === 'open' ? [answer] : []
  })
}

/** The «cleared today» count after `n` more tasks were closed. */
export function clearedPlus(count: number, n: number): number {
  return count + n
}

/** A comments query is keyed by the task ids it holds
 * (['agenda', 'comments', ids]); a new comment belongs only in those. */
export function commentsKeyHolds(key: readonly unknown[], taskId: string): boolean {
  const held = key[2]
  return Array.isArray(held) && held.includes(taskId)
}

/** Append a comment (oldest first, so at the end). When the stored row
 * arrives it takes the place of the first pending placeholder on its task. */
export function withComment(comments: readonly TaskComment[], comment: TaskComment): TaskComment[] {
  if (comments.some((c) => c.id === comment.id)) return [...comments]
  const placeholder = isPendingId(comment.id)
    ? -1
    : comments.findIndex((c) => isPendingId(c.id) && c.task_id === comment.task_id)
  if (placeholder >= 0) return comments.map((c, i) => (i === placeholder ? comment : c))
  return [...comments, comment]
}
