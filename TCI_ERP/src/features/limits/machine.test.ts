/** Contract test: machine.ts must mirror the request lifecycle enforced by
 * migration 0013 (submit/start_review/withdraw/decide functions and the
 * one-open-request partial unique index). */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0013_credit_limit_workflow.sql?raw'
import MIGRATION_0063 from '../../../supabase/migrations/0063_acting_role.sql?raw'
import M65 from '../../../supabase/migrations/0065_admin_technical_only.sql?raw'
import M67 from '../../../supabase/migrations/0067_information_gathering.sql?raw'
import {
  OPEN_STATUSES,
  canDecide,
  canCreateRequest,
  canDecideAs,
  canStartReview,
  canSubmit,
  canWithdraw,
  isOpen,
  outcomeTone,
  requestAgeDays,
  statusTone,
} from './machine'
import { requestScopeFilter } from './types'
import { DECISION_OUTCOMES, LIMIT_REQUEST_STATUSES } from './types'

describe('open statuses (partial unique index predicate)', () => {
  it('matches the index predicate as 0067 restates it (information gathering is open)', () => {
    expect(OPEN_STATUSES).toEqual(['draft', 'submitted', 'information_gathering', 'under_review', 'escalated'])
    expect(M67).toContain(
      "where status in ('draft', 'submitted', 'information_gathering', 'under_review', 'escalated');",
    )
    expect(M67).toContain(
      "if v_request.status not in ('draft', 'submitted', 'information_gathering', 'under_review', 'escalated') then",
    )
    // 0013's original set, which 0067 extends
    expect(MIGRATION).toContain(
      "where status in ('draft', 'submitted', 'under_review', 'escalated')",
    )
    // withdraw guards the same set
    expect(MIGRATION).toContain(
      "if v_request.status not in ('draft', 'submitted', 'under_review', 'escalated') then",
    )
  })

  it('classifies every status', () => {
    for (const s of LIMIT_REQUEST_STATUSES) {
      expect(isOpen(s)).toBe(s !== 'decided' && s !== 'withdrawn')
    }
  })
})

describe('transitions (mirror of the SQL functions)', () => {
  it('submit only from draft', () => {
    for (const s of LIMIT_REQUEST_STATUSES) expect(canSubmit(s)).toBe(s === 'draft')
  })

  it('start review only from submitted', () => {
    for (const s of LIMIT_REQUEST_STATUSES) expect(canStartReview(s)).toBe(s === 'submitted')
  })

  it('decide from submitted / under_review / escalated only', () => {
    for (const s of LIMIT_REQUEST_STATUSES) {
      expect(canDecide(s)).toBe(['submitted', 'under_review', 'escalated'].includes(s))
    }
    expect(MIGRATION).toContain(
      "if v_request.status not in ('submitted', 'under_review', 'escalated') then",
    )
  })

  it('credit underwriting decides; there is no senior role, and admin decides nothing (0063)', () => {
    // Phase 3b: an escalated request is decidable by ANY credit underwriter
    // whose band authority covers the amount (enforced in SQL) — unless it is
    // on validation (0060), which the page checks separately:
    // decide_limit_request refuses everyone but the step's validator.
    expect(canDecideAs('escalated', ['credit_underwriter'])).toBe(true)
    expect(canDecideAs('escalated', ['admin'])).toBe(false)
    expect(canDecideAs('under_review', ['credit_underwriter'])).toBe(true)
    expect(canDecideAs('under_review', ['sales'])).toBe(false)
    expect(canDecideAs('under_review', ['commercial_underwriter'])).toBe(false)
    expect(canDecideAs('under_review', ['client'])).toBe(false)
    expect(canDecideAs('decided', ['admin'])).toBe(false)
    expect(canDecideAs('submitted', [])).toBe(false)
    // multi-role: any qualifying role grants it
    expect(canDecideAs('submitted', ['sales', 'credit_underwriter'])).toBe(true)
    expect(MIGRATION_0063).toContain("  if not tci.has_role('credit_underwriter') then\n    raise exception 'only credit underwriting may decide'")
    expect(MIGRATION_0063).toContain("  if not tci.has_role('credit_underwriter') then\n    raise exception 'only credit underwriting may take a request into review'")
  })

  it('sales, commercial and credit underwriting may raise requests', () => {
    for (const role of ['sales', 'commercial_underwriter', 'credit_underwriter'] as const) {
      expect(canCreateRequest([role])).toBe(true)
    }
    for (const role of ['admin', 'claims', 'information_manager', 'client'] as const) {
      expect(canCreateRequest([role])).toBe(false)
    }
  })

  it('withdraw: the requester, or anyone who may decide, only while open', () => {
    expect(canWithdraw('submitted', ['sales'], true)).toBe(true)
    expect(canWithdraw('submitted', ['sales'], false)).toBe(false)
    expect(canWithdraw('escalated', ['credit_underwriter'], false)).toBe(true)
    expect(canWithdraw('escalated', ['admin'], false)).toBe(false)
    expect(canWithdraw('decided', ['sales'], true)).toBe(false)
    expect(canWithdraw('withdrawn', ['sales'], true)).toBe(false)
    expect(M65).toContain("        or tci.has_role('credit_underwriter')) then")
  })
})

describe('presentation helpers', () => {
  it('assigns a tone to every status and outcome', () => {
    for (const s of LIMIT_REQUEST_STATUSES) expect(statusTone(s)).toBeTruthy()
    for (const o of DECISION_OUTCOMES) expect(outcomeTone(o)).toBeTruthy()
    expect(statusTone('escalated')).toBe('warn')
    expect(outcomeTone('declined')).toBe('neg')
  })

  it('request age in whole days since submission', () => {
    expect(requestAgeDays(null, '2026-08-26T00:00:00Z')).toBeNull()
    expect(requestAgeDays('2026-08-20T10:00:00Z', '2026-08-26T09:00:00Z')).toBe(5)
    expect(requestAgeDays('2026-08-26T10:00:00Z', '2026-08-26T09:00:00Z')).toBe(0)
  })
})

describe('migration 0013 decision immutability (contract lock)', () => {
  it('grants only lifecycle updates on decisions, and no delete', () => {
    expect(MIGRATION).toContain(
      'grant update (lifecycle) on tci.credit_limit_decisions to authenticated',
    )
    expect(MIGRATION).not.toMatch(/grant\s+delete\s+on\s+tci\.credit_limit_decisions/i)
  })

  it('amount-by-outcome check is present', () => {
    expect(MIGRATION).toContain('decisions_amount_by_outcome')
  })
})

describe('requestScopeFilter (the scope a decision supersedes)', () => {
  it('a policy request looks up the limit on that policy', () => {
    expect(requestScopeFilter({ entity_id: 'b', policy_id: 'p', insurance_request_id: 'ir' })).toEqual({
      entityId: 'b',
      policyId: 'p',
    })
  })

  it('a pre-bind request looks up the limit in its submission, never the buyer at large', () => {
    expect(
      requestScopeFilter({ entity_id: 'b', policy_id: null as unknown as string, insurance_request_id: 'ir' }),
    ).toEqual({ entityId: 'b', insuranceRequestId: 'ir' })
  })
})
