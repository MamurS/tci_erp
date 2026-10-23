import { describe, expect, it } from 'vitest'

import M65 from '../../../supabase/migrations/0065_admin_technical_only.sql?raw'

import {
  amountOf,
  bucketOf,
  buildBoard,
  dueState,
  mergeTasks,
  readFilter,
  sumUzs,
  tashkentDay,
  writeFilter,
  isMine,
} from './board'
import type { AgendaRow } from './board'
import type { Task, TaskType } from './types'

// Wednesday 21 October 2026, 12:00 in Tashkent
const NOW = new Date('2026-10-21T07:00:00Z')

let seq = 0
function task(type: TaskType, over: Partial<Task> = {}): Task {
  seq += 1
  return {
    id: `t${seq}`,
    task_type: type,
    object_type: 'premium_instalment',
    object_id: `o${seq}`,
    title_key: `agenda.tasks.${type}`,
    params: {},
    target_role: 'commercial_underwriter',
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
    ...over,
  }
}

const instalment = (policy: string, due: string, amount: number, currency = 'UZS') =>
  task(due < '2026-10-21' ? 'instalment_overdue' : 'instalment_due', {
    due_at: `${due}T00:00:00+00:00`,
    priority: 'high',
    params: { policy_id: policy, policy_number: `N-${policy}`, sequence: 1, due_date: due, amount, currency },
  })

describe('the Tashkent calendar', () => {
  it('reads a day in Tashkent, not in UTC', () => {
    expect(tashkentDay(Date.parse('2026-10-20T20:30:00Z'))).toBe('2026-10-21')
  })

  it('labels deadlines by calendar days: late, today, ahead', () => {
    expect(dueState('2026-08-23T00:00:00+00:00', NOW)).toEqual({ kind: 'overdue', days: 59 })
    expect(dueState('2026-10-21T00:00:00+00:00', NOW)).toEqual({ kind: 'today' })
    expect(dueState('2026-10-23T00:00:00+00:00', NOW)).toEqual({ kind: 'future', days: 2 })
    expect(dueState(null, NOW)).toEqual({ kind: 'none' })
  })

  it('a date is due for the whole of that day; a timestamp passes at itself', () => {
    expect(bucketOf({ due_at: '2026-10-21T00:00:00+00:00', priority: 'normal' }, NOW)).toBe('today')
    expect(bucketOf({ due_at: '2026-10-21T05:00:00Z', priority: 'normal' }, NOW)).toBe('overdue')
  })

  it('this week ends on Sunday; later is beyond it', () => {
    expect(bucketOf({ due_at: '2026-10-25T00:00:00+00:00', priority: 'normal' }, NOW)).toBe('week')
    expect(bucketOf({ due_at: '2026-10-26T00:00:00+00:00', priority: 'normal' }, NOW)).toBe('later')
  })

  it('nothing undated hides in Later: urgent and high are today, normal this week', () => {
    expect(bucketOf({ due_at: null, priority: 'urgent' }, NOW)).toBe('today')
    expect(bucketOf({ due_at: null, priority: 'high' }, NOW)).toBe('today')
    expect(bucketOf({ due_at: null, priority: 'normal' }, NOW)).toBe('week')
  })
})

describe('the owner’s seven tasks', () => {
  // The canonical board on 21 October 2026: four overdue instalments on four
  // policies, an overdue notice ripe for a claim seen by claims AND by the
  // policyholder (admin sees both), and one instalment due today.
  const noa = { object_type: 'overdue_notification' as const, object_id: 'noa-1', due_at: '2026-09-05T00:00:00+00:00' }
  const tasks = [
    instalment('p2', '2026-08-23', 636_800_000),
    instalment('p1', '2026-10-03', 636_800_000),
    instalment('p14', '2026-10-04', 1_000_000, 'USD'),
    instalment('p3', '2026-10-12', 636_800_000),
    task('noa_matured_to_claim', { ...noa, target_role: 'claims', params: { amount: 412_000_000, currency: 'UZS' } }),
    task('claim_ready_to_file', { ...noa, target_role: null, target_user: 'client-1', params: { amount: 412_000_000, currency: 'UZS' } }),
    instalment('p5', '2026-10-21', 100_000_000),
  ]

  it('render as three rows: instalments collapsed, the notice and the claim merged', () => {
    const board = buildBoard(tasks, 'due', NOW, () => null)
    expect(board.map((g) => g.key)).toEqual(['overdue', 'today'])
    const overdue = board[0]?.rows ?? []
    expect(overdue).toHaveLength(2)
    expect(board.flatMap((g) => g.rows)).toHaveLength(3)

    const premium = overdue.find((r) => r.displayType === 'instalment_overdue') as AgendaRow
    expect(premium.kind).toBe('collapsed')
    expect(premium.items).toHaveLength(4)
    expect(premium.dueAt).toBe('2026-08-23T00:00:00+00:00') // the oldest leads

    const claim = overdue.find((r) => r.displayType === 'noa_matured_to_claim') as AgendaRow
    expect(claim.kind).toBe('merged')
    expect(claim.tasks).toHaveLength(2)
    expect(claim.items).toHaveLength(1)
  })

  it('sum the money at stake in UZS, leaving out — and counting — amounts without a rate', () => {
    const board = buildBoard(tasks, 'due', NOW, () => null)
    const overdue = board[0]?.rows ?? []
    const rateFor = (ccy: string) => (ccy === 'UZS' ? 1 : null)
    // three UZS instalments + the notice counted ONCE; the USD one has no rate
    expect(sumUzs(overdue, rateFor)).toEqual({ uzs: 3 * 636_800_000 + 412_000_000, missingRates: 1 })
  })
})

describe('merging', () => {
  it('one request routed to several underwriters is one row', () => {
    const copies = ['u1', 'u2', 'u3'].map((u) =>
      task('limit_needs_decision', { object_type: 'credit_limit_request', object_id: 'req-1', target_role: null, target_user: u }),
    )
    const rows = mergeTasks(copies, NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe('single')
    expect(rows[0]?.tasks).toHaveLength(3)
  })

  it('a request and its escalation are one row led by the escalation', () => {
    const rows = mergeTasks(
      [
        task('limit_needs_decision', { object_type: 'credit_limit_request', object_id: 'req-2' }),
        task('limit_escalated', { object_type: 'credit_limit_request', object_id: 'req-2', priority: 'urgent' }),
      ],
      NOW,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.displayType).toBe('limit_escalated')
  })

  it('the ways a rating asks for work are one row, new statements first', () => {
    const rows = mergeTasks(
      [
        task('rating_stale', { object_type: 'legal_entity', object_id: 'e-1' }),
        task('rating_new_statements', { object_type: 'legal_entity', object_id: 'e-1', due_at: '2026-10-25T00:00:00Z' }),
        task('group_limit_missing', { object_type: 'legal_entity', object_id: 'e-1' }),
      ],
      NOW,
    )
    expect(rows.map((r) => r.displayType).sort()).toEqual(['group_limit_missing', 'rating_new_statements'])
  })

  it('a single instalment is never collapsed', () => {
    const board = buildBoard([instalment('p9', '2026-10-01', 5)], 'due', NOW, () => null)
    expect(board[0]?.rows[0]?.kind).toBe('single')
  })

  it('instalments in different groups never collapse into one row', () => {
    const board = buildBoard(
      [instalment('a', '2026-10-01', 1), instalment('b', '2026-10-02', 1), task('instalment_due', {
        due_at: '2026-10-30T00:00:00+00:00', params: { policy_id: 'c', amount: 1, currency: 'UZS' },
      })],
      'due',
      NOW,
      () => null,
    )
    expect(board.map((g) => [g.key, g.rows.length])).toEqual([
      ['overdue', 1],
      ['later', 1],
    ])
  })
})

describe('grouping by company and by family', () => {
  it('groups by the company a row is about, unknown last', () => {
    const a = task('limit_needs_decision', { object_type: 'credit_limit_request', object_id: 'x' })
    const b = task('rating_stale', { object_type: 'legal_entity', object_id: 'y' })
    const c = task('submission_declined', { object_type: 'insurance_request', object_id: 'z' })
    const names: Record<string, string> = { x: 'Zeta LLC', y: 'Alpha AJ' }
    const board = buildBoard([a, b, c], 'company', NOW, (row) => names[row.lead.object_id] ?? null)
    expect(board.map((g) => g.key)).toEqual(['Alpha AJ', 'Zeta LLC', ''])
  })

  it('groups by family in the chips’ order', () => {
    const board = buildBoard(
      [task('submission_declined', { object_id: 's' }), task('instalment_due', { object_id: 'i' })],
      'type',
      NOW,
      () => null,
    )
    expect(board.map((g) => g.key)).toEqual(['premium', 'submissions'])
  })
})

describe('the filter in the URL', () => {
  it('round-trips and ignores what it does not know', () => {
    const params = writeFilter(new URLSearchParams('view=triage'), { family: 'claims', mine: true, snoozed: false })
    expect(params.toString()).toBe('view=triage&family=claims&mine=1')
    expect(readFilter(params)).toEqual({ family: 'claims', mine: true, snoozed: false })
    expect(readFilter(new URLSearchParams('family=nonsense'))).toEqual({ family: null, mine: false, snoozed: false })
  })
})

describe('amounts', () => {
  it('reads money from params; group exposure is already UZS; no currency is no amount', () => {
    expect(amountOf(task('limit_review_due', { params: { amount: '250000.00', currency: 'USD' } }))).toEqual({
      amount: 250000,
      currency: 'USD',
    })
    expect(amountOf(task('group_exposure_near_limit', { params: { exposure_uzs: 4.6e9 } }))).toEqual({
      amount: 4.6e9,
      currency: 'UZS',
    })
    expect(amountOf(task('declaration_awaiting_acceptance', { params: { total: 5 } }))).toBeNull()
  })
})

describe('isMine (mirror of tci.task_is_mine, 0065)', () => {
  const me = 'u-1'
  it('is a task addressed to me or to the role I act in — and no longer every task for admin', () => {
    expect(M65).toContain(`  select p_target_user = (select auth.uid())
      or (p_target_role is not null and p_target_role in (select tci.current_user_roles()))
$function$`)
    expect(isMine({ target_user: me, target_role: null }, me, ['admin'])).toBe(true)
    expect(isMine({ target_user: null, target_role: 'sales' }, me, ['sales'])).toBe(true)
    expect(isMine({ target_user: null, target_role: 'sales' }, me, ['admin'])).toBe(false)
    expect(isMine({ target_user: 'u-2', target_role: null }, me, ['admin'])).toBe(false)
    expect(isMine({ target_user: null, target_role: 'admin' }, me, ['admin'])).toBe(true)
    expect(isMine({ target_user: null, target_role: null }, null, ['sales'])).toBe(false)
  })
})
