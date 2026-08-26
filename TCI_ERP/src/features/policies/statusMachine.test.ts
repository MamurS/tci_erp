/** Contract test: statusMachine.ts must mirror tci.change_policy_status
 * (migration 0012) exactly, and the migration must define the same
 * transitions and portal-ready RLS this UI relies on. */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0012_policyholders_policies.sql?raw'
import {
  ALLOWED_TRANSITIONS,
  allowedTargets,
  canTransition,
  isExpiryDue,
  requiresComment,
  statusTone,
} from './statusMachine'
import { POLICY_STATUSES } from './types'
import type { PolicyStatus } from './types'

describe('policy status machine (UI mirror of tci.change_policy_status)', () => {
  it('defines the exact transition table', () => {
    expect(ALLOWED_TRANSITIONS).toEqual({
      draft: ['active'],
      active: ['suspended', 'cancelled', 'expired'],
      suspended: ['active', 'cancelled'],
      expired: [],
      cancelled: [],
    })
  })

  it('covers every status and keeps terminal states terminal', () => {
    for (const status of POLICY_STATUSES) {
      expect(Array.isArray(allowedTargets(status))).toBe(true)
    }
    expect(allowedTargets('expired')).toHaveLength(0)
    expect(allowedTargets('cancelled')).toHaveLength(0)
  })

  it('never allows a self-transition or a return to draft', () => {
    for (const from of POLICY_STATUSES) {
      expect(canTransition(from, from)).toBe(false)
      expect(canTransition(from, 'draft')).toBe(false)
    }
  })

  it('requires a comment exactly for suspend and cancel', () => {
    const commentRequired = POLICY_STATUSES.filter((s) => requiresComment(s))
    expect(commentRequired).toEqual(['suspended', 'cancelled'])
  })

  it('maps every status to a badge tone', () => {
    const tones = Object.fromEntries(POLICY_STATUSES.map((s) => [s, statusTone(s)]))
    expect(tones).toEqual({
      draft: 'accent',
      active: 'pos',
      suspended: 'warn',
      expired: 'neutral',
      cancelled: 'neg',
    })
  })

  it('flags expiry as due only for active policies past expiry', () => {
    const policy = { status: 'active' as PolicyStatus, expiry_date: '2026-06-30' }
    expect(isExpiryDue(policy, '2026-07-01')).toBe(true)
    expect(isExpiryDue(policy, '2026-06-30')).toBe(false)
    expect(isExpiryDue({ ...policy, status: 'suspended' }, '2026-07-01')).toBe(false)
  })

  it('matches the SQL function transition-by-transition', () => {
    // The SQL clauses in migration 0012 must express the same table.
    expect(MIGRATION).toContain(`(v_policy.status = 'draft'     and p_to_status = 'active')`)
    expect(MIGRATION).toContain(
      `(v_policy.status = 'active'    and p_to_status in ('suspended', 'cancelled', 'expired'))`,
    )
    expect(MIGRATION).toContain(
      `(v_policy.status = 'suspended' and p_to_status in ('active', 'cancelled'))`,
    )
    // History is recorded for every transition.
    expect(MIGRATION).toContain('insert into tci.policy_status_history')
  })
})

describe('migration 0012 RLS contract (portal-ready policies)', () => {
  it('enables RLS on every new table', () => {
    for (const table of ['policyholders', 'policyholder_users', 'policies', 'policy_status_history']) {
      expect(MIGRATION).toContain(`alter table tci.${table} enable row level security`)
    }
  })

  it('gives the policyholder role read-only access to own policies via the mapping', () => {
    expect(MIGRATION).toContain('"policies: policyholder reads own"')
    expect(MIGRATION).toContain(`on tci.policies for select`)
    expect(MIGRATION).toContain('from tci.policyholder_users pu')
    // No write policy mentions the policyholder role.
    const writeGrantsToPortal = MIGRATION.match(
      /for (insert|update|delete|all)[\s\S]{0,400}?'policyholder'(?!_users)/g,
    )
    expect(writeGrantsToPortal).toBeNull()
  })

  it('mirrors the DB constraints the validation module enforces', () => {
    expect(MIGRATION).toContain('check (expiry_date > inception_date)')
    expect(MIGRATION).toContain('check (insured_percentage between 50 and 100)')
    expect(MIGRATION).toContain(`status = 'draft'`)
    expect(MIGRATION).toContain('or max_liability_amount is not null')
    expect(MIGRATION).toContain('or max_liability_premium_multiple is not null')
  })
})
