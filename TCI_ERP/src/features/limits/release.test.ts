/** Contract test: release.ts must mirror migration 0020 exactly —
 * tci.decision_is_released (the silent-consent clock), the stage precedence
 * of tci.v_effective_limits, and tci.apply_emergency_release (the bypass). */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0020_two_stage_decisions.sql?raw'
import MIGRATION_0019 from '../../../supabase/migrations/0019_insurance_requests.sql?raw'
import {
  canHold,
  canRelease,
  decisionIsReleased,
  isEmergencyAction,
  pickEffective,
  releaseStatus,
  windowEndsAt,
  windowRemainingMs,
} from './release'
import type { ReleaseFacts } from './release'

const DECIDED = '2026-08-26T10:00:00Z'
const WINDOW = 24

const facts = (over: Partial<ReleaseFacts & { hold_comment: string | null }> = {}) => ({
  released_at: null,
  decided_at: DECIDED,
  held: false,
  release_kind: null,
  hold_comment: null,
  ...over,
})

describe('decisionIsReleased (mirror of tci.decision_is_released)', () => {
  it('an explicit released_at wins, whatever the clock says', () => {
    const f = facts({ released_at: '2026-08-26T10:00:01Z' })
    expect(decisionIsReleased(f, WINDOW, '2026-08-26T10:00:02Z')).toBe(true)
    // ...even while the window is still nominally running
    expect(decisionIsReleased(f, 999, '2026-08-26T10:00:02Z')).toBe(true)
  })

  it('silent consent: visible once the window has elapsed, not before', () => {
    expect(decisionIsReleased(facts(), WINDOW, '2026-08-27T09:59:59Z')).toBe(false)
    // the boundary itself releases (SQL uses >=)
    expect(decisionIsReleased(facts(), WINDOW, '2026-08-27T10:00:00Z')).toBe(true)
    expect(MIGRATION).toContain('now() >= p_decided_at + make_interval(hours =>')
  })

  it('a hold suspends the clock indefinitely', () => {
    const held = facts({ held: true })
    expect(decisionIsReleased(held, WINDOW, '2026-08-27T10:00:00Z')).toBe(false)
    expect(decisionIsReleased(held, WINDOW, '2030-01-01T00:00:00Z')).toBe(false)
    // but a hold cannot un-release something already released
    expect(
      decisionIsReleased(facts({ held: true, released_at: DECIDED }), WINDOW, DECIDED),
    ).toBe(true)
  })

  it('a zero-hour window releases immediately', () => {
    expect(decisionIsReleased(facts(), 0, DECIDED)).toBe(true)
  })
})

describe('window arithmetic', () => {
  it('ends exactly salesWindowHours after the decision', () => {
    expect(windowEndsAt(DECIDED, 24).toISOString()).toBe('2026-08-27T10:00:00.000Z')
    expect(windowEndsAt(DECIDED, 1).toISOString()).toBe('2026-08-26T11:00:00.000Z')
  })

  it('remaining time never goes negative', () => {
    expect(windowRemainingMs(DECIDED, 24, '2026-08-26T22:00:00Z')).toBe(12 * 3_600_000)
    expect(windowRemainingMs(DECIDED, 24, '2026-08-28T00:00:00Z')).toBe(0)
  })
})

describe('releaseStatus (the badge shown on every decision)', () => {
  it('released with the kind that put it there', () => {
    const s = releaseStatus(
      facts({ released_at: DECIDED, release_kind: 'immediate' }),
      WINDOW,
      DECIDED,
    )
    expect(s).toEqual({ state: 'released', kind: 'immediate', at: DECIDED })
  })

  it('a row released before release_kind existed reads as sales_confirmed', () => {
    const s = releaseStatus(facts({ released_at: DECIDED }), WINDOW, DECIDED)
    expect(s.state === 'released' && s.kind).toBe('sales_confirmed')
  })

  it('held carries the comment sales had to give', () => {
    const s = releaseStatus(facts({ held: true, hold_comment: 'call the client' }), WINDOW, DECIDED)
    expect(s).toEqual({ state: 'held', comment: 'call the client' })
  })

  it('inside the window it reports when silent consent lands', () => {
    const s = releaseStatus(facts(), WINDOW, '2026-08-26T16:00:00Z')
    expect(s.state).toBe('window')
    if (s.state === 'window') {
      expect(s.endsAt.toISOString()).toBe('2026-08-27T10:00:00.000Z')
      expect(s.remainingMs).toBe(18 * 3_600_000)
    }
  })

  it('past the window, with nothing set, it is silent consent', () => {
    const s = releaseStatus(facts(), WINDOW, '2026-08-28T00:00:00Z')
    expect(s).toEqual({ state: 'released', kind: 'silent_consent', at: null })
  })
})

describe('isEmergencyAction (mirror of tci.apply_emergency_release)', () => {
  it('every revocation bypasses the window', () => {
    expect(isEmergencyAction('revoked', null, null)).toBe(true)
    expect(isEmergencyAction('revoked', 100, 50)).toBe(true)
    expect(MIGRATION).toContain("if new.outcome = 'revoked' then")
  })

  it('a REDUCTION below what the client already has bypasses it', () => {
    expect(isEmergencyAction('approved', 400, 500)).toBe(true)
    expect(isEmergencyAction('partial', 400, 500)).toBe(true)
    expect(MIGRATION).toContain('if v_prev_amount is not null and new.approved_amount < v_prev_amount then')
  })

  it('an increase, an equal amount, or a first-ever limit does NOT', () => {
    expect(isEmergencyAction('approved', 600, 500)).toBe(false)
    expect(isEmergencyAction('approved', 500, 500)).toBe(false)
    expect(isEmergencyAction('approved', 500, null)).toBe(false)
  })

  it('a decline is not an amount action at all', () => {
    expect(isEmergencyAction('declined', null, 500)).toBe(false)
  })
})

describe('canRelease / canHold (mirror of the SQL guards)', () => {
  it('a released decision can no longer be held', () => {
    expect(canHold(facts({ released_at: DECIDED }))).toBe(false)
    expect(MIGRATION).toContain(
      'the client has already seen this decision - it cannot be held',
    )
  })

  it('an already-held decision is not offered a second hold', () => {
    expect(canHold(facts({ held: true }))).toBe(false)
    expect(canHold(facts())).toBe(true)
  })

  it('release is offered until it has happened (it also clears a hold)', () => {
    expect(canRelease(facts())).toBe(true)
    expect(canRelease(facts({ held: true }))).toBe(true)
    expect(canRelease(facts({ released_at: DECIDED }))).toBe(false)
    expect(MIGRATION).toContain('held = false,')
  })
})

describe('pickEffective (stage precedence of tci.v_effective_limits)', () => {
  const TODAY = '2026-08-27'
  const d = (over: Partial<Parameters<typeof pickEffective>[0][number]>) => ({
    id: 'x',
    stage: 'credit' as const,
    decided_at: '2026-08-20T00:00:00Z',
    lifecycle: 'effective',
    valid_until: null,
    ...over,
  })

  it('the commercial adjustment governs, even when the credit row is newer', () => {
    const rows = [
      d({ id: 'credit', stage: 'credit', decided_at: '2026-08-26T00:00:00Z' }),
      d({ id: 'comm', stage: 'commercial', decided_at: '2026-08-21T00:00:00Z' }),
    ]
    expect(pickEffective(rows, TODAY)?.id).toBe('comm')
    expect(MIGRATION).toContain("order by r.policy_id, r.entity_id, (d.stage = 'commercial') desc, d.decided_at desc")
  })

  it('with no commercial row the credit decision governs, newest first', () => {
    const rows = [
      d({ id: 'old', decided_at: '2026-08-20T00:00:00Z' }),
      d({ id: 'new', decided_at: '2026-08-25T00:00:00Z' }),
    ]
    expect(pickEffective(rows, TODAY)?.id).toBe('new')
  })

  it('superseded and lapsed rows never govern', () => {
    expect(pickEffective([d({ lifecycle: 'superseded' })], TODAY)).toBeNull()
    expect(pickEffective([d({ valid_until: '2026-08-26' })], TODAY)).toBeNull()
    // valid_until is inclusive, exactly as the view's >= current_date
    expect(pickEffective([d({ valid_until: TODAY })], TODAY)?.id).toBe('x')
    expect(MIGRATION).toContain('(d.valid_until is null or d.valid_until >= current_date)')
  })
})

describe('migration contract locks', () => {
  it('0020: the client only ever sees released decisions', () => {
    expect(MIGRATION).toContain('"limit_decisions: client reads own released"')
    expect(MIGRATION).toContain('tci.decision_is_released(released_at, decided_at, held)')
  })

  it('0020: sales may update the lifecycle/release columns and nothing else', () => {
    expect(MIGRATION).toContain(
      'grant update (lifecycle, released_at, release_kind, held, hold_comment)',
    )
    expect(MIGRATION).toContain('a hold needs a comment saying what must be discussed')
  })

  it('0020: a commercial adjustment must point at its credit decision', () => {
    expect(MIGRATION).toContain('decisions_stage_parent')
    expect(MIGRATION).toContain(
      "(stage = 'commercial' and adjusts_decision_id is not null)",
    )
    // validity and conditions are copied, never taken from the caller
    expect(MIGRATION).toContain('v_credit.valid_from, v_credit.valid_until,      -- validity is NOT adjustable')
  })

  it('0019: the window is a setting, read through a SECURITY DEFINER helper', () => {
    expect(MIGRATION_0019).toContain('sales_window_hours  int not null default 24')
    expect(MIGRATION_0019).toContain('create function tci.sales_window_hours()')
  })
})
