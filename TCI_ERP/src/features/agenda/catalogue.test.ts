/** Contract test: the Agenda catalogue must mirror the migrations — the task
 * type list, the auto/manual completion rules documented in their headers, and
 * the guard tci.complete_task actually enforces.
 *
 * Phase 4 added seven types in 0029 and made a second one manual; Phase 5 adds
 * seven more in 0036 and a third manual one; Phase 6 adds two in 0041, both
 * automatic. All four headers are read: MIGRATION is 0024, PHASE4 is 0029,
 * PHASE5 is 0036, PHASE6 is 0041. */

import { describe, expect, it } from 'vitest'

import { formatAmount } from '../../lib/format'
import en from '../../i18n/locales/en.json'
import MIGRATION from '../../../supabase/migrations/0024_agenda_tasks.sql?raw'
import PHASE4 from '../../../supabase/migrations/0029_phase4_agenda_portal.sql?raw'
import PHASE5 from '../../../supabase/migrations/0036_claims_agenda_portal.sql?raw'
import PHASE6 from '../../../supabase/migrations/0041_group_agenda_financials.sql?raw'
import DATA from '../../../supabase/migrations/0054_data_management.sql?raw'
import AGENDA from '../../../supabase/migrations/0055_agenda_redesign.sql?raw'
import PAYMENTS from '../../../supabase/migrations/0056_premium_payments.sql?raw'
import CONTRACTS from '../../../supabase/migrations/0057_contract_drafts.sql?raw'
import OFFERS from '../../../supabase/migrations/0058_commercial_offers.sql?raw'
import VALIDATION from '../../../supabase/migrations/0060_limit_validation.sql?raw'
import ADT from '../../../supabase/migrations/0061_auto_decisions.sql?raw'
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
  displayTaskType,
  deadlinePassesAt,
  NO_FILTERS,
  OBJECT_FILTERS,
  presentValues,
  SUBJECT_IN_TITLE,
  taskTitleKey,
  taskLink,
  formatTaskParams,
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
    snoozed_until: null,
    snoozed_by: null,
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
      ...DATA.matchAll(/alter type tci\.task_type add value '([a-z_]+)'/g),
      ...AGENDA.matchAll(/alter type tci\.task_type add value '([a-z_]+)'/g),
      ...PAYMENTS.matchAll(/alter type tci\.task_type add value '([a-z_]+)'/g),
      ...CONTRACTS.matchAll(/alter type tci\.task_type add value '([a-z_]+)'/g),
      ...OFFERS.matchAll(/alter type tci\.task_type add value '([a-z_]+)'/g),
      ...VALIDATION.matchAll(/alter type tci\.task_type add value if not exists '([a-z_]+)'/g),
      ...ADT.matchAll(/alter type tci\.task_type add value if not exists '([a-z_]+)'/g),
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
    // 0054 adds the three data-request types.
    const addedData = DATA.split('\n').filter((l) => l.startsWith('alter type tci.task_type add value '))
    expect(addedData).toHaveLength(3)
    // 0055 adds rating_new_statements.
    const addedAgenda = AGENDA.split('\n').filter((l) => l.startsWith('alter type tci.task_type add value '))
    expect(addedAgenda).toHaveLength(1)
    // 0056 adds premium_payment_unmatched.
    const addedPayments = PAYMENTS.split('\n').filter((l) => l.startsWith('alter type tci.task_type add value '))
    expect(addedPayments).toHaveLength(1)
    // 0057 adds contract_review.
    const addedContracts = CONTRACTS.split('\n').filter((l) => l.startsWith('alter type tci.task_type add value '))
    expect(addedContracts).toHaveLength(1)
    // 0058 adds the three offer types.
    const addedOffers = OFFERS.split('\n').filter((l) => l.startsWith('alter type tci.task_type add value '))
    expect(addedOffers).toHaveLength(3)
    // 0060 adds the two validation types.
    const addedValidation = VALIDATION.split('\n').filter((l) => l.startsWith('alter type tci.task_type add value '))
    expect(addedValidation).toHaveLength(2)
    // 0061 adds adt_review.
    const addedAdt = ADT.split('\n').filter((l) => l.startsWith('alter type tci.task_type add value '))
    expect(addedAdt).toHaveLength(1)
    expect(TASK_TYPES).toHaveLength(39)
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

  it('marks exactly the five types the migrations call manual', () => {
    const manual = TASK_TYPES.filter((type) => COMPLETION_RULES[type] === 'manual')
    expect([...manual].sort()).toEqual([
      'claim_declined_review',
      'entity_request_resolved',
      'limit_validation_result',
      'submission_declined',
      'uncovered_excess_review',
    ])
    expect(VALIDATION).toContain('limit_validation_result  the author (a person)      normal; MANUAL close')
    expect(VALIDATION).toContain('-- complete_task: limit_validation_result is the fifth manual type.')
    expect(DATA).toContain('entity_request_resolved  the requester (user)                         normal  MANUAL')
    expect(MIGRATION).toContain('submission_declined is manual because nothing downstream happens')
    expect(PHASE4).toContain('uncovered_excess_review is MANUAL because nothing downstream resolves it')
    expect(PHASE5).toContain('claim_declined_review is MANUAL for the same reason as submission_declined')
  })

  it('mirrors the guard in tci.complete_task as 0060 restated it', () => {
    expect(VALIDATION).toContain(
      "     ('submission_declined', 'uncovered_excess_review', 'claim_declined_review',\n      'entity_request_resolved', 'limit_validation_result') then",
    )
    const MANUAL = [
      'submission_declined',
      'uncovered_excess_review',
      'claim_declined_review',
      'entity_request_resolved',
      'limit_validation_result',
    ]
    for (const type of TASK_TYPES) {
      expect(canCompleteByHand(type)).toBe(MANUAL.includes(type))
    }
  })

  it('agrees with the catalogue table in the migration headers', () => {
    // Each header row is "<type>  <target>  AUTO ..." or "... MANUAL - ...".
    // A row may continue on the next comment lines (0060 wraps
    // limit_validation's), so the rule is read up to the next type's row.
    const headers = `${MIGRATION}\n${PHASE4}\n${PHASE5}\n${PHASE6}\n${DATA}\n${AGENDA}\n${PAYMENTS}\n${CONTRACTS}\n${OFFERS}\n${VALIDATION}`.split('\n')
    // 0061 has no catalogue table in its header: adt_review's rule is read
    // from its mapping instead (the next test).
    for (const type of TASK_TYPES.filter((t) => t !== 'adt_review')) {
      let row: string | undefined
      headers.forEach((line, i) => {
        if (row || !new RegExp(`^--   ${type}(\\s|$)`).test(line)) return
        const block = [line]
        for (let j = i + 1; j < headers.length && /^--\s{6,}\S/.test(headers[j]!); j++) block.push(headers[j]!)
        const joined = block.join(' ')
        if (/\b(AUTO|MANUAL)\b/.test(joined)) row = joined
      })
      expect(row, `header row for ${type}`).toBeDefined()
      expect(COMPLETION_RULES[type]).toBe(row?.includes('MANUAL') ? 'manual' : 'auto')
    }
  })

  it('adt_review closes itself (0061): a new ADT or disabling it closes the task', () => {
    expect(ADT).toContain("elsif new.event_type in ('adt.set', 'adt.disabled') then")
    expect(ADT).toContain("perform tci.close_tasks(array['adt_review']::tci.task_type[], new.object_id);")
    // 0061 does not touch tci.complete_task: the 0060 manual list stands
    expect(ADT).not.toContain('function tci.complete_task')
    expect(COMPLETION_RULES.adt_review).toBe('auto')
    expect(canCompleteByHand('adt_review')).toBe(false)
  })

  it('opens the ADT review on the ADT block of the rating tab', () => {
    expect(taskLink({ object_type: 'legal_entity', object_id: 'e1', params: {}, task_type: 'adt_review' })).toBe(
      '/entities/e1?tab=rating&focus=adt',
    )
  })

  it('deep-links data requests: the worker to the request, the requester to the company', () => {
    expect(taskLink({ object_type: 'entity_request', object_id: 'r1', params: {}, task_type: 'entity_requested' })).toBe(
      '/data/requests/r1',
    )
    expect(
      taskLink({ object_type: 'entity_request', object_id: 'r1', params: { entity_id: 'e1' }, task_type: 'entity_request_resolved' }),
    ).toBe('/entities/e1')
    expect(
      taskLink({ object_type: 'entity_request', object_id: 'r1', params: { entity_id: null }, task_type: 'entity_request_resolved' }),
    ).toBeNull()
    expect(taskLink({ object_type: 'client_buyer_proposal', object_id: 'p1', params: {} })).toBe('/data?view=proposals')
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

describe('a deadline that is a calendar date (Tashkent, UTC+5)', () => {
  // `due_date::timestamptz` stores 21 October as 2026-10-21T00:00:00+00:00.
  const dueToday = task({ task_type: 'instalment_due', due_at: '2026-10-21T00:00:00+00:00' })

  it('is on time for the whole of its day', () => {
    // 21 Oct, 05:00 and 23:59 in Tashkent.
    expect(isOverdue(dueToday, new Date('2026-10-21T00:00:00Z'))).toBe(false)
    expect(isOverdue(dueToday, new Date('2026-10-21T18:59:59Z'))).toBe(false)
  })

  it('is overdue once the day has ended in Tashkent', () => {
    expect(isOverdue(dueToday, new Date('2026-10-21T19:00:00Z'))).toBe(true)
    expect(isOverdue(dueToday, new Date('2026-10-22T09:00:00Z'))).toBe(true)
  })

  it('reads a plain ISO date and the Z spelling the same way', () => {
    const end = new Date('2026-10-21T19:00:00Z').getTime()
    expect(deadlinePassesAt('2026-10-21')).toBe(end)
    expect(deadlinePassesAt('2026-10-21T00:00:00Z')).toBe(end)
    expect(deadlinePassesAt('2026-10-21T00:00:00.000+00:00')).toBe(end)
  })

  it('keeps a real timestamp to the minute', () => {
    expect(deadlinePassesAt('2026-10-21T09:30:00Z')).toBe(new Date('2026-10-21T09:30:00Z').getTime())
  })

  it('shows the due title on the due day and the overdue one after it, whatever the row says', () => {
    const onTheDay = new Date('2026-10-21T10:00:00Z')
    const nextDay = new Date('2026-10-22T10:00:00Z')
    // The database may have opened it as overdue already…
    const openedLate = { ...dueToday, task_type: 'instalment_overdue' as const, title_key: 'agenda.tasks.instalment_overdue' }
    expect(displayTaskType(openedLate, onTheDay)).toBe('instalment_due')
    expect(taskTitleKey(openedLate, onTheDay)).toBe('agenda.tasks.instalment_due')
    // …or as due the day before it lapsed.
    expect(taskTitleKey({ ...dueToday, title_key: 'agenda.tasks.instalment_due' }, nextDay)).toBe(
      'agenda.tasks.instalment_overdue',
    )
    const declaration = task({
      task_type: 'declaration_due',
      title_key: 'agenda.tasks.declaration_due',
      due_at: '2026-10-21T00:00:00+00:00',
    })
    expect(taskTitleKey(declaration, nextDay)).toBe('agenda.tasks.declaration_overdue')
  })

  it('leaves every other title as the database wrote it', () => {
    const other = task({ due_at: '2026-01-01T00:00:00Z', title_key: 'agenda.tasks.limit_needs_decision' })
    expect(taskTitleKey(other, NOW)).toBe('agenda.tasks.limit_needs_decision')
  })
})

describe('subject placement', () => {
  it('SUBJECT_IN_TITLE is exactly the titles that interpolate {{subject}}', () => {
    const fromLocale = Object.entries(en.agenda.tasks)
      .filter(([, text]) => text.includes('{{subject}}'))
      .map(([key]) => key)
      .sort()
    expect([...SUBJECT_IN_TITLE].sort()).toEqual(fromLocale)
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

describe('filter options', () => {
  it('offers only the values present, with counts, in display order', () => {
    const rows = [
      task({ id: 'a', object_type: 'claim' }),
      task({ id: 'b', object_type: 'insurance_request' }),
      task({ id: 'c', object_type: 'claim' }),
    ]
    expect(presentValues(OBJECT_FILTERS, rows, (t) => t.object_type)).toEqual([
      { value: 'insurance_request', count: 1 },
      { value: 'claim', count: 2 },
    ])
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
    // The rating tasks open Рейтинг и лимит (0055); every other
    // legal_entity task keeps the plain card link.
    expect(
      taskLink({
        task_type: 'buyer_needs_rating',
        object_type: 'legal_entity',
        object_id: 'e1',
        params: {},
      }),
    ).toBe('/entities/e1?tab=rating')
    expect(
      taskLink({
        task_type: 'limit_review_due',
        object_type: 'legal_entity',
        object_id: 'e1',
        params: {},
      }),
    ).toBe('/entities/e1')
  })
})

describe('formatTaskParams', () => {
  it('renders dates, percentages and amounts in the viewer’s notation', () => {
    expect(formatTaskParams({ period_start: '2026-09-01', utilisation_pct: 106.25, amount: '65000', name: 'X' }, 'ru')).toEqual({
      period_start: '01 сент. 2026',
      utilisation_pct: '106.3',
      amount: formatAmount(65000, 'ru'),
      name: 'X',
    })
    expect(formatTaskParams(null, 'en')).toEqual({})
  })
})

describe('limit validation links (0060)', () => {
  it('routes a validation step through its limit request', () => {
    expect(
      taskLink({ object_type: 'limit_validation', object_id: 'v1', params: { request_id: 'r1' }, task_type: 'limit_validation' }),
    ).toBe('/limits/r1?focus=validation')
    expect(
      taskLink({
        object_type: 'limit_validation',
        object_id: 'v1',
        params: { request_id: 'r1' },
        task_type: 'limit_validation_result',
      }),
    ).toBe('/limits/r1')
    expect(taskLink({ object_type: 'limit_validation', object_id: 'v1', params: {} })).toBeNull()
  })
})
