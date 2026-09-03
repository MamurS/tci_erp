/** Contract test: the Agenda catalogue must mirror the migrations — the task
 * type list, the auto/manual completion rules documented in their headers, and
 * the guard tci.complete_task actually enforces.
 *
 * Phase 4 added seven types in 0029 and made a second one manual; Phase 5 adds
 * seven more in 0036 and a third manual one; Phase 6 adds two in 0041, both
 * automatic. All four headers are read: MIGRATION is 0024, PHASE4 is 0029,
 * PHASE5 is 0036, PHASE6 is 0041. */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0024_agenda_tasks.sql?raw'
import PHASE4 from '../../../supabase/migrations/0029_phase4_agenda_portal.sql?raw'
import PHASE5 from '../../../supabase/migrations/0036_claims_agenda_portal.sql?raw'
import PHASE6 from '../../../supabase/migrations/0041_group_agenda_financials.sql?raw'
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
  it('lists exactly the values of tci.task_type, in order', () => {
    // 0024 creates the enum; 0029 appends to it. TASK_TYPES must be the
    // concatenation, in the same order, or a task row will not round-trip.
    const enumBlock = MIGRATION.slice(
      MIGRATION.indexOf('create type tci.task_type as enum'),
    ).slice(0, MIGRATION.slice(MIGRATION.indexOf('create type tci.task_type as enum')).indexOf(');'))
    const created = [...enumBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    const appended = [
      ...PHASE4.matchAll(/alter type tci\.task_type add value '([a-z_]+)'/g),
      ...PHASE5.matchAll(/alter type tci\.task_type add value '([a-z_]+)'/g),
      ...PHASE6.matchAll(/alter type tci\.task_type add value '([a-z_]+)'/g),
    ].map((m) => m[1])
    expect([...created, ...appended]).toEqual([...TASK_TYPES])
  })

  it('matches the count each migration adds', () => {
    // 0024 shipped eleven and asserts that on itself.
    expect(MIGRATION).toContain('if v_types <> 11 then')
    // 0029 adds seven more, one ALTER TYPE per line.
    const added = PHASE4.split('\n').filter((l) =>
      l.startsWith('alter type tci.task_type add value '),
    )
    expect(added).toHaveLength(7)
    // 0036 adds seven more.
    const addedP5 = PHASE5.split('\n').filter((l) =>
      l.startsWith('alter type tci.task_type add value '),
    )
    expect(addedP5).toHaveLength(7)
    // 0041 adds the two group types.
    const addedP6 = PHASE6.split('\n').filter((l) =>
      l.startsWith('alter type tci.task_type add value '),
    )
    expect(addedP6).toHaveLength(2)
    expect(TASK_TYPES).toHaveLength(27)
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

  it('marks exactly the three types the migrations call manual', () => {
    const manual = TASK_TYPES.filter((type) => COMPLETION_RULES[type] === 'manual')
    expect([...manual].sort()).toEqual([
      'claim_declined_review',
      'submission_declined',
      'uncovered_excess_review',
    ])
    expect(MIGRATION).toContain('submission_declined is manual because nothing downstream happens')
    expect(PHASE4).toContain('uncovered_excess_review is MANUAL because nothing downstream resolves it')
    expect(PHASE5).toContain('claim_declined_review is MANUAL for the same reason as submission_declined')
  })

  it('mirrors the guard in tci.complete_task as 0036 restated it', () => {
    expect(PHASE5).toContain(
      "     ('submission_declined', 'uncovered_excess_review', 'claim_declined_review') then",
    )
    const MANUAL = ['submission_declined', 'uncovered_excess_review', 'claim_declined_review']
    for (const type of TASK_TYPES) {
      expect(canCompleteByHand(type)).toBe(MANUAL.includes(type))
    }
  })

  it('agrees with the catalogue table in the migration headers', () => {
    // Each header row is "<type>  <target>  AUTO ..." or "... MANUAL - ...".
    const headers = `${MIGRATION}\n${PHASE4}\n${PHASE5}\n${PHASE6}`.split('\n')
    for (const type of TASK_TYPES) {
      const row = headers.find(
        (line) => line.startsWith(`--   ${type}`) && /\b(AUTO|MANUAL)\b/.test(line),
      )
      expect(row, `header row for ${type}`).toBeDefined()
      expect(COMPLETION_RULES[type]).toBe(row?.includes('MANUAL') ? 'manual' : 'auto')
    }
  })

  it('deep-links the Phase 4 object kinds', () => {
    expect(
      taskLink({ object_type: 'declaration', object_id: 'd1', params: {} }),
    ).toBe('/declarations/d1')
    expect(
      taskLink({ object_type: 'overdue_notification', object_id: 'n1', params: {} }),
    ).toBe('/overdues/n1')
    // An instalment has no page; its policy's premium tab does.
    expect(
      taskLink({ object_type: 'premium_instalment', object_id: 'i1', params: { policy_id: 'p1' } }),
    ).toBe('/policies/p1?tab=premium')
    expect(
      taskLink({ object_type: 'premium_instalment', object_id: 'i1', params: {} }),
    ).toBeNull()
    // A declaration that does not exist yet hangs off the policy.
    expect(
      taskLink({ object_type: 'policy', object_id: 'p1', params: { period_start: '2026-07-01' } }),
    ).toBe('/declarations?policy=p1&period=2026-07-01')
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

describe('the Phase 6 group tasks (0041)', () => {
  it('both close themselves — refresh_agenda retires them', () => {
    expect(canCompleteByHand('group_exposure_near_limit')).toBe(false)
    expect(canCompleteByHand('group_limit_missing')).toBe(false)
    expect(PHASE6).toContain('Both close themselves')
  })

  it('deep-links to the group tab, not to the card default', () => {
    // Both hang off the ultimate parent company, and the work is on its
    // Группа tab.
    expect(
      taskLink({
        task_type: 'group_exposure_near_limit',
        object_type: 'legal_entity',
        object_id: 'e1',
        params: {},
      }),
    ).toBe('/entities/e1?tab=group')
    expect(
      taskLink({
        task_type: 'group_limit_missing',
        object_type: 'legal_entity',
        object_id: 'e1',
        params: {},
      }),
    ).toBe('/entities/e1?tab=group')
    // Every other legal_entity task keeps the plain card link.
    expect(
      taskLink({
        task_type: 'buyer_needs_rating',
        object_type: 'legal_entity',
        object_id: 'e1',
        params: {},
      }),
    ).toBe('/entities/e1')
  })
})
