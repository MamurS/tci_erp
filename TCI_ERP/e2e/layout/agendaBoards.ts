/**
 * Agenda boards of a chosen size, built from the recorded credit board
 * (fixtures/credit.json) — no new recording: the triage layout must hold
 * with a SHORT queue (3 rows) and a LONG one (40), and with a short task
 * panel (the recorded thread) and a LONG one (a 30-comment thread).
 *
 * A clone gets its own task id and its own object id (rows on one object
 * would merge into one), and a due date a day later per lap; its company
 * then resolves to nothing, which is what a row for an unknown object
 * shows anyway.
 */

import type { StubReply, StubRequest } from '../support/stub'
import { replay } from './fixtures'
import type { RoleFixture } from './fixtures'

type Row = Record<string, unknown> & { id: string; object_id: string; due_at: string | null }

const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }

const fakeId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export function openTasks(fixture: RoleFixture): Row[] {
  const entry = Object.entries(fixture.responses).find(([k]) => k.startsWith('GET tasks?') && k.includes('status=eq.open'))
  return ((entry?.[1].json as Row[] | undefined) ?? []).slice()
}

/** `count` open tasks: the recorded ones cut, or cloned until there are enough. */
export function sizedTasks(fixture: RoleFixture, count: number): Row[] {
  const base = openTasks(fixture)
  if (count <= base.length) return base.slice(0, count)
  const out = base.slice()
  for (let i = base.length; i < count; i++) {
    const src = base[i % base.length]!
    const lap = Math.floor(i / base.length)
    const due = src.due_at ? new Date(Date.parse(src.due_at) + lap * 86_400_000).toISOString() : null
    out.push({ ...src, id: fakeId(i + 1), object_id: fakeId(10_000 + i), due_at: due })
  }
  return out
}

export interface BoardOptions {
  /** How many open tasks the board holds (the recorded count when left out). */
  queue?: number
  /** Comments on every task (a long task panel); the recorded ones when left out. */
  thread?: number
}

/** A stub `respond` replaying the fixture, with the board resized. */
export function agendaBoard(fixture: RoleFixture, options: BoardOptions = {}): (request: StubRequest) => StubReply | undefined {
  const recorded = replay(fixture)
  const tasks = options.queue === undefined ? null : sizedTasks(fixture, options.queue)
  return (request) => {
    if (request.method === 'GET' && request.resource === 'tasks' && request.url.searchParams.get('status') === 'eq.open' && tasks)
      return { json: tasks, headers: CORS }
    if (request.method === 'GET' && request.resource === 'task_comments' && options.thread) {
      const ids = /^in\.\((.*)\)$/.exec(request.url.searchParams.get('task_id') ?? '')?.[1]?.split(',') ?? []
      const comments = ids.flatMap((taskId) =>
        Array.from({ length: options.thread! }, (_, i) => ({
          id: `${taskId.slice(0, 24)}${String(i).padStart(12, '0')}`,
          task_id: taskId,
          author_id: fixture.user.id,
          body: `Comment ${i + 1}: the buyer's payment record over the last two quarters, the open notices and what the policyholder said on the call.`,
          created_at: new Date(Date.UTC(2026, 9, 1, 9, i)).toISOString(),
        })),
      )
      return { json: comments, headers: CORS }
    }
    return recorded(request)
  }
}
