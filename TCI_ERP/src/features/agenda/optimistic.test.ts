import { describe, expect, it } from 'vitest'

import { activeTasks } from './catalogue'
import { asIds, clearedPlus, commentsKeyHolds, withAnswers, withComment, withoutTasks, withSnooze } from './optimistic'
import type { Task, TaskComment } from './types'

const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id,
  task_type: 'submission_declined',
  object_type: 'insurance_request',
  object_id: `o-${id}`,
  title_key: 'agenda.tasks.submission_declined',
  params: {},
  target_role: 'sales',
  target_user: null,
  due_at: null,
  priority: 'normal',
  status: 'open',
  completed_by: null,
  completed_at: null,
  source_event_id: null,
  created_at: '2026-10-01T00:00:00Z',
  snoozed_until: null,
  snoozed_by: null,
  ...extra,
})

const board = [task('a'), task('b'), task('c')]
const now = new Date('2026-10-22T08:00:00Z')

describe('agenda optimistic changes', () => {
  it('accepts one id or several', () => {
    expect(asIds('a')).toEqual(['a'])
    expect(asIds(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('done: the tasks leave the open board, the rest stay in order', () => {
    expect(withoutTasks(board, ['a', 'c']).map((t) => t.id)).toEqual(['b'])
  })

  it('snooze: the task is hidden by the same rule every list and the badge use', () => {
    const snoozed = withSnooze(board, ['b'], '2026-10-23T08:00:00Z', 'me')
    expect(snoozed[1]).toMatchObject({ snoozed_until: '2026-10-23T08:00:00Z', snoozed_by: 'me' })
    expect(activeTasks(snoozed, now).map((t) => t.id)).toEqual(['a', 'c'])
  })

  it('unsnooze: back on the board, and nobody is named as having snoozed it', () => {
    const back = withSnooze([task('a', { snoozed_until: '2026-10-30T00:00:00Z', snoozed_by: 'x' })], ['a'], null, null)
    expect(back[0]).toMatchObject({ snoozed_until: null, snoozed_by: null })
  })

  it('the server answer replaces its row, and a closed task leaves the board', () => {
    const answered = withAnswers(board, [
      task('a', { snoozed_until: '2026-10-25T00:00:00Z' }),
      task('b', { status: 'done' }),
    ])
    expect(answered.map((t) => t.id)).toEqual(['a', 'c'])
    expect(answered[0].snoozed_until).toBe('2026-10-25T00:00:00Z')
  })

  it('cleared today counts the closed tasks', () => {
    expect(clearedPlus(3, 2)).toBe(5)
  })
})

describe('agenda comments', () => {
  const comment = (id: string, taskId = 't1'): TaskComment => ({
    id,
    task_id: taskId,
    author_id: 'me',
    body: 'hello',
    created_at: '2026-10-22T08:00:00Z',
  })

  it('a comment belongs only in the queries keyed by its task', () => {
    expect(commentsKeyHolds(['agenda', 'comments', ['t1', 't2']], 't1')).toBe(true)
    expect(commentsKeyHolds(['agenda', 'comments', ['t2']], 't1')).toBe(false)
    expect(commentsKeyHolds(['agenda', 'comments'], 't1')).toBe(false)
  })

  it('the pending comment is appended, then replaced by the stored row', () => {
    const pending = withComment([comment('c0')], comment('pending-x'))
    expect(pending.map((c) => c.id)).toEqual(['c0', 'pending-x'])
    const stored = withComment(pending, comment('c1'))
    expect(stored.map((c) => c.id)).toEqual(['c0', 'c1'])
    // the same row twice is not duplicated
    expect(withComment(stored, comment('c1')).map((c) => c.id)).toEqual(['c0', 'c1'])
  })

  it('a stored row with no placeholder on its task is simply appended', () => {
    expect(withComment([comment('pending-x', 't2')], comment('c1', 't1')).map((c) => c.id)).toEqual([
      'pending-x',
      'c1',
    ])
  })
})
