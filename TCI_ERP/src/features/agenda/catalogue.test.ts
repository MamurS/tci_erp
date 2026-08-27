/** Contract test: the Agenda catalogue must mirror migration 0024 — the task
 * type list, the auto/manual completion rules documented in its header, and
 * the guard tci.complete_task actually enforces. */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0024_agenda_tasks.sql?raw'
import {
  AGENDA_GROUPS,
  agendaCounts,
  applyFilters,
  canCompleteByHand,
  COMPLETION_RULES,
  compareTasks,
  groupOf,
  groupTasks,
  isOverdue,
  NO_FILTERS,
  taskLink,
} from './catalogue'
import { TASK_PRIORITIES, TASK_TYPES } from './types'
import type { Task, TaskPriority, TaskType } from './types'

const NOW = new Date('2026-08-27T12:00:00Z')

function task(patch: Partial<Task> = {}): Task {
  return {
    id: patch.id ?? 't1',
    task_type: 'limit_needs_decision',
    object_type: 'credit_limit_request',
    object_id: 'obj-1',
    title_key: 'agenda.tasks.limit_needs_decision',
    params: {},
    target_role: 'credit_underwriter',
    target_user: null,
    due_at: null,
    priority: 'normal',
    status: 'open',
    completed_by: null,
    completed_at: null,
    source_event_id: null,
    created_at: '2026-08-01T00:00:00Z',
    ...patch,
  }
}

// ---------------------------------------------------------------------------
// Mirrors of the migration text
// ---------------------------------------------------------------------------

describe('task type enum', () => {
  it('lists exactly the values of tci.task_type', () => {
    const enumBlock = MIGRATION.slice(
      MIGRATION.indexOf('create type tci.task_type as enum'),
    ).slice(0, MIGRATION.slice(MIGRATION.indexOf('create type tci.task_type as enum')).indexOf(');'))
    const inSql = [...enumBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    expect(inSql).toEqual([...TASK_TYPES])
  })

  it('matches the count the migration asserts on itself', () => {
    expect(MIGRATION).toContain('if v_types <> 11 then')
    expect(TASK_TYPES).toHaveLength(11)
  })

  it('lists exactly the values of tci.task_priority', () => {
    expect(MIGRATION).toContain(
      "create type tci.task_priority as enum ('normal', 'high', 'urgent')",
    )
    expect([...TASK_PRIORITIES].sort()).toEqual(['high', 'normal', 'urgent'])
  })
})

describe('completion rules', () => {
  it('covers every task type', () => {
    expect(Object.keys(COMPLETION_RULES).sort()).toEqual([...TASK_TYPES].sort())
  })

  it('marks submission_declined as the only manual one, as the migration says', () => {
    const manual = TASK_TYPES.filter((type) => COMPLETION_RULES[type] === 'manual')
    expect(manual).toEqual(['submission_declined'])
    expect(MIGRATION).toContain('submission_declined is manual because nothing downstream happens')
  })

  it('mirrors the guard in tci.complete_task', () => {
    expect(MIGRATION).toContain("if v_task.task_type <> 'submission_declined' then")
    for (const type of TASK_TYPES) {
      expect(canCompleteByHand(type)).toBe(type === 'submission_declined')
    }
  })

  it('agrees with the catalogue table in the migration header', () => {
    // Each header row is "<type>  <target>  AUTO ..." or "... MANUAL - ...".
    for (const type of TASK_TYPES) {
      const row = MIGRATION.split('\n').find(
        (line) => line.startsWith(`--   ${type}`) && /\b(AUTO|MANUAL)\b/.test(line),
      )
      expect(row, `header row for ${type}`).toBeDefined()
      expect(COMPLETION_RULES[type]).toBe(row?.includes('MANUAL') ? 'manual' : 'auto')
    }
  })
})

describe('event mapping the UI depends on', () => {
  it('opens buyer_needs_entity only while the buyer has no entity', () => {
    expect(MIGRATION).toContain('if found and v_buyer.entity_id is null then')
  })

  it('completes submission_accepted on request.bound rather than cancelling it', () => {
    expect(MIGRATION).toContain("elsif v_to = 'bound' then")
    // The bound arm cancels the stage tasks only.
    const boundArm = MIGRATION.slice(MIGRATION.indexOf("elsif v_to = 'bound' then"))
    // The array literal only — the comment above it names the type on purpose.
    const cancelList = boundArm.slice(
      boundArm.indexOf('array['),
      boundArm.indexOf("'cancelled');"),
    )
    expect(cancelList).not.toContain('submission_accepted')
    expect(cancelList).toContain('submission_commercial_review')
    expect(MIGRATION).toContain("when 'request.bound' then")
  })

  it('carries request_id on limit_held so the row can deep-link', () => {
    expect(MIGRATION).toContain("'request_id', v_decision.request_id")
  })

  it('generates the two time-based kinds lazily, with no cron', () => {
    expect(MIGRATION).toContain('create function tci.refresh_agenda()')
    expect(MIGRATION).toContain('and v.valid_until <= current_date + 30')
    expect(MIGRATION).toContain("a.created_at > now() - interval '12 months'")
    expect(MIGRATION).not.toMatch(/pg_cron|cron\.schedule/)
  })

  it('refuses an agenda to a non-staff caller', () => {
    expect(MIGRATION).toContain("raise exception 'only staff have an agenda'")
  })
})

// ---------------------------------------------------------------------------
// Deep links
// ---------------------------------------------------------------------------

describe('taskLink', () => {
  it('routes each object kind to its page', () => {
    expect(taskLink(task({ object_type: 'insurance_request', object_id: 'r1' }))).toBe('/requests/r1')
    expect(taskLink(task({ object_type: 'legal_entity', object_id: 'e1' }))).toBe('/entities/e1')
    expect(taskLink(task({ object_type: 'credit_limit_request', object_id: 'l1' }))).toBe('/limits/l1')
  })

  it('routes a decision through its limit request, from params', () => {
    expect(
      taskLink(
        task({
          object_type: 'credit_limit_decision',
          object_id: 'd1',
          params: { request_id: 'l9' },
        }),
      ),
    ).toBe('/limits/l9')
  })

  it('has no link for a decision whose request id is missing', () => {
    expect(taskLink(task({ object_type: 'credit_limit_decision', object_id: 'd1' }))).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Grouping, ordering, filters
// ---------------------------------------------------------------------------

describe('grouping', () => {
  it('puts an elapsed due date above every priority', () => {
    const overdueNormal = task({ due_at: '2026-08-26T00:00:00Z', priority: 'normal' })
    expect(groupOf(overdueNormal, NOW)).toBe('overdue')
    const futureUrgent = task({ due_at: '2026-09-01T00:00:00Z', priority: 'urgent' })
    expect(groupOf(futureUrgent, NOW)).toBe('urgent')
  })

  it('treats a due date exactly now as overdue', () => {
    expect(isOverdue(task({ due_at: NOW.toISOString() }), NOW)).toBe(true)
  })

  it('leaves an undated task on its own priority', () => {
    for (const priority of TASK_PRIORITIES) {
      expect(groupOf(task({ priority: priority as TaskPriority }), NOW)).toBe(priority)
    }
  })

  it('drops empty buckets and keeps the display order', () => {
    const sections = groupTasks(
      [
        task({ id: 'a', priority: 'normal' }),
        task({ id: 'b', priority: 'urgent' }),
        task({ id: 'c', due_at: '2026-08-01T00:00:00Z' }),
      ],
      NOW,
    )
    expect(sections.map((s) => s.group)).toEqual(['overdue', 'urgent', 'normal'])
    expect(AGENDA_GROUPS).toContain('high')
  })
})

describe('ordering inside a group', () => {
  it('puts the soonest due first and undated last', () => {
    const later = task({ id: 'later', due_at: '2026-09-02T00:00:00Z' })
    const sooner = task({ id: 'sooner', due_at: '2026-09-01T00:00:00Z' })
    const undated = task({ id: 'undated' })
    expect([later, undated, sooner].sort(compareTasks).map((t) => t.id)).toEqual([
      'sooner',
      'later',
      'undated',
    ])
  })

  it('breaks a tie on priority, then on age', () => {
    const normal = task({ id: 'normal', priority: 'normal', created_at: '2026-08-01T00:00:00Z' })
    const urgent = task({ id: 'urgent', priority: 'urgent', created_at: '2026-08-05T00:00:00Z' })
    const older = task({ id: 'older', priority: 'normal', created_at: '2026-07-01T00:00:00Z' })
    expect([normal, urgent, older].sort(compareTasks).map((t) => t.id)).toEqual([
      'urgent',
      'older',
      'normal',
    ])
  })
})

describe('filters', () => {
  const rows = [
    task({ id: 'a', task_type: 'limit_needs_decision', object_type: 'credit_limit_request' }),
    task({ id: 'b', task_type: 'submission_accepted', object_type: 'insurance_request' }),
    task({ id: 'c', task_type: 'rating_stale', object_type: 'legal_entity' }),
  ]

  it('passes everything through when nothing is set', () => {
    expect(applyFilters(rows, NO_FILTERS)).toHaveLength(3)
  })

  it('narrows by task type and by object kind independently', () => {
    expect(
      applyFilters(rows, { taskType: 'rating_stale' as TaskType, objectType: '' }).map((t) => t.id),
    ).toEqual(['c'])
    expect(
      applyFilters(rows, { taskType: '', objectType: 'insurance_request' }).map((t) => t.id),
    ).toEqual(['b'])
  })
})

describe('sidebar counts', () => {
  it('reports the open total and the overdue subset separately', () => {
    const counts = agendaCounts(
      [task({ id: 'a' }), task({ id: 'b', due_at: '2026-08-01T00:00:00Z' })],
      NOW,
    )
    expect(counts).toEqual({ open: 2, overdue: 1 })
  })
})
