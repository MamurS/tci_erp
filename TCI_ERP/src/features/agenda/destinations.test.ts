import { describe, expect, it } from 'vitest'

import MIGRATION_0055 from '../../../supabase/migrations/0055_agenda_redesign.sql?raw'
import { buildBoard, mergeTasks } from './board'
import { DESTINATIONS, destinationFor, instalmentDestination } from './destinations'
import { FAMILIES, TASK_FAMILY, TASK_TAG, familyCounts } from './families'
import { ORIGIN_SOURCES, isAutomatic, paramComments, systemNote } from './notes'
import { TASK_TYPES } from './types'
import type { Task, TaskType } from './types'

const NOW = new Date('2026-10-21T07:00:00Z')

function task(type: TaskType, over: Partial<Task> = {}): Task {
  return {
    id: `t-${type}`,
    task_type: type,
    object_type: 'legal_entity',
    object_id: `obj-${type}`,
    title_key: `agenda.tasks.${type}`,
    params: {
      policy_id: 'pol-1',
      policy_number: 'TCI-2026-0001',
      request_id: 'req-1',
      request_number: 'IR-2026-0001',
      claim_number: 'CL-2026-0001',
      entity_id: 'ent-1',
      statement_id: 'st-1',
      fiscal_year: 2025,
      period_start: '2026-09-01',
    },
    target_role: 'credit_underwriter',
    target_user: null,
    due_at: null,
    priority: 'normal',
    status: 'open',
    completed_by: null,
    completed_at: null,
    source_event_id: 'ev-1',
    created_at: '2026-10-01T00:00:00Z',
    snoozed_until: null,
    snoozed_by: null,
    ...over,
  }
}

const rowOf = (t: Task) => mergeTasks([t], NOW)[0]!

describe('every task type has a destination', () => {
  it.each(TASK_TYPES)('%s goes somewhere with a verb and a breadcrumb', (type) => {
    expect(DESTINATIONS[type]).toBeTypeOf('function')
    const dest = destinationFor(rowOf(task(type)), { subject: 'Acme LLC', reference: 'REF-1' })
    expect(dest.path.startsWith('/')).toBe(true)
    expect(dest.crumbs.length).toBeGreaterThan(0)
    expect(dest.action).toBeTruthy()
  })

  it.each(TASK_TYPES)('%s belongs to a family and carries a tag', (type) => {
    expect(FAMILIES).toContain(TASK_FAMILY[type])
    expect(TASK_TAG[type]).toBeTruthy()
  })
})

describe('the deep links carry the task’s context', () => {
  it('an escalation opens the decision form of its request', () => {
    const dest = destinationFor(rowOf(task('limit_escalated', { object_type: 'credit_limit_request', object_id: 'req-41' })))
    expect(dest.path).toBe('/limits/req-41?focus=decision')
    expect(dest.action).toBe('decide')
  })

  it('a rating review opens Rating & limit with the new statements preselected', () => {
    const dest = destinationFor(rowOf(task('rating_new_statements', { object_id: 'ent-9' })))
    expect(dest.path).toBe('/entities/ent-9?tab=rating&statement=st-1')
    expect(dest.context).toEqual({ key: 'agenda.dest.with.statement', params: { period: '2025' } })
  })

  it('overdue premium opens the policy’s Premium tab filtered to those instalments', () => {
    const items = ['i1', 'i2'].map((id, n) =>
      task('instalment_overdue', {
        id,
        object_type: 'premium_instalment',
        object_id: id,
        due_at: `2026-10-0${n + 1}T00:00:00+00:00`,
        params: { policy_id: 'pol-7', policy_number: 'TCI-7', amount: 1, currency: 'UZS' },
      }),
    )
    const row = buildBoard(items, 'due', NOW, () => null)[0]!.rows[0]!
    expect(row.kind).toBe('collapsed')
    expect(destinationFor(row).path).toBe('/policies/pol-7?tab=premium&instalments=i1,i2')
    expect(instalmentDestination(items[1]!)).toBe('/policies/pol-7?tab=premium&instalments=i2')
  })

  it('a claim that can be filed opens the notice with the open-claim dialog', () => {
    const dest = destinationFor(rowOf(task('noa_matured_to_claim', { object_type: 'overdue_notification', object_id: 'noa-5' })))
    expect(dest.path).toBe('/overdues/noa-5?action=open-claim')
    expect(dest.action).toBe('openClaim')
  })

  it('a sales confirmation opens the submission at its sales window', () => {
    const dest = destinationFor(rowOf(task('submission_sales_confirmation', { object_type: 'insurance_request', object_id: 'ir-3' })))
    expect(dest.path).toBe('/requests/ir-3?focus=sales-window')
  })

  it('a group task opens the parent’s Group tab', () => {
    const dest = destinationFor(rowOf(task('group_exposure_near_limit', { object_id: 'parent-1', params: {} })))
    expect(dest.path).toBe('/entities/parent-1?tab=group')
  })
})

describe('notes', () => {
  // The types refresh_agenda opens (no source event) are exactly the
  // automatic ones; each must carry a system note. Read from the migration.
  const body = MIGRATION_0055.slice(
    MIGRATION_0055.indexOf('create or replace function tci.refresh_agenda()'),
    MIGRATION_0055.indexOf('create function tci.handle_agenda_extras()'),
  )
  // A type is generated when it is the first argument of an open_task call
  // (directly, or as a branch of the case that picks it).
  const opened = body
    .split('perform tci.open_task(')
    .slice(1)
    .map((call) => call.slice(0, call.indexOf("'agenda.tasks.")))
  const generated = TASK_TYPES.filter((type) => opened.some((head) => head.includes(`'${type}'`)))

  it('every type refresh_agenda generates has a system note', () => {
    expect(generated).toEqual(
      expect.arrayContaining(['rating_new_statements', 'rating_stale', 'instalment_overdue', 'noa_matured_to_claim']),
    )
    for (const type of generated) {
      expect(systemNote(task(type, { source_event_id: null })), type).not.toBeNull()
    }
  })

  it('a task is automatic when no event opened it', () => {
    expect(isAutomatic({ source_event_id: null })).toBe(true)
    expect(isAutomatic({ source_event_id: 'ev' })).toBe(false)
  })

  it('an escalation names the authority it was above, or says it is not known', () => {
    expect(systemNote(task('limit_escalated', { params: { authority_uzs: 6e8, amount: 9e8 } }))?.key).toBe(
      'agenda.note.limit_escalated',
    )
    expect(systemNote(task('limit_escalated', { params: { amount: 9e8 } }))?.key).toBe(
      'agenda.note.limit_escalated_noAuthority',
    )
    expect(systemNote(task('limit_escalated', { params: { reason: 'group_limit' } }))?.key).toBe(
      'agenda.note.limit_escalated_group',
    )
  })

  it('origin comments carried in params are shown, empty ones are not', () => {
    expect(paramComments(task('limit_held', { params: { comment: '  Client asks for 60 days  ' } }))).toEqual([
      { author: 'sales', body: 'Client asks for 60 days', at: '2026-10-01T00:00:00Z' },
    ])
    expect(paramComments(task('limit_held', { params: { comment: ' ' } }))).toEqual([])
    expect(ORIGIN_SOURCES.limit_escalated).toEqual([{ kind: 'limitJustification' }])
  })

  it('the escalation note’s params are written by the 0055 trigger', () => {
    expect(MIGRATION_0055).toContain("'escalated_by', new.actor,")
    expect(MIGRATION_0055).toContain("'authority_uzs',")
    expect(MIGRATION_0055).toContain("jsonb_build_object('reason', 'group_limit', 'escalated_by', new.actor)")
  })
})

describe('families', () => {
  it('counts tasks per family in the chips’ order, only those present', () => {
    expect(familyCounts([task('instalment_due'), task('claim_submitted'), task('instalment_overdue')])).toEqual([
      { family: 'premium', count: 2 },
      { family: 'claims', count: 1 },
    ])
  })
})
