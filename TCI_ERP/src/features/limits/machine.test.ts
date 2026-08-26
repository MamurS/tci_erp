/** Contract test: machine.ts must mirror the request lifecycle enforced by
 * migration 0013 (submit/start_review/withdraw/decide functions and the
 * one-open-request partial unique index). */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0013_credit_limit_workflow.sql?raw'
import {
  OPEN_STATUSES,
  canDecide,
  canDecideAs,
  canStartReview,
  canSubmit,
  canWithdraw,
  isOpen,
  outcomeTone,
  requestAgeDays,
  statusTone,
} from './machine'
import { DECISION_OUTCOMES, LIMIT_REQUEST_STATUSES } from './types'

describe('open statuses (partial unique index predicate)', () => {
  it('matches the index predicate in migration 0013', () => {
    expect(OPEN_STATUSES).toEqual(['draft', 'submitted', 'under_review', 'escalated'])
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

  it('escalated requests terminate at a senior (underwriter is read-only)', () => {
    expect(canDecideAs('escalated', 'underwriter')).toBe(false)
    expect(canDecideAs('escalated', 'senior_underwriter')).toBe(true)
    expect(canDecideAs('escalated', 'admin')).toBe(true)
    expect(canDecideAs('under_review', 'underwriter')).toBe(true)
    expect(canDecideAs('under_review', 'policyholder')).toBe(false)
    expect(canDecideAs('decided', 'admin')).toBe(false)
    expect(canDecideAs('submitted', null)).toBe(false)
  })

  it('withdraw: requester or senior/admin, only while open', () => {
    expect(canWithdraw('submitted', 'underwriter', true)).toBe(true)
    expect(canWithdraw('submitted', 'underwriter', false)).toBe(false)
    expect(canWithdraw('escalated', 'senior_underwriter', false)).toBe(true)
    expect(canWithdraw('escalated', 'admin', false)).toBe(true)
    expect(canWithdraw('decided', 'admin', true)).toBe(false)
    expect(canWithdraw('withdrawn', 'admin', true)).toBe(false)
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
