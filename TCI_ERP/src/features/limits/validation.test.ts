/** Contract test: validation.ts must mirror migration 0060 — the statuses and
 * kinds, which answers need a comment, the required/voluntary rule, that a
 * reduction is never validated, how an approval's outcome is decided, and the
 * refusal codes the screens name. Every rule is read from the migration TEXT,
 * so the two sides cannot drift apart silently. */

import { describe, expect, it } from 'vitest'

import M60 from '../../../supabase/migrations/0060_limit_validation.sql?raw'
import { OPERATIONS_REFUSALS } from '../../lib/refusals'
import {
  actionNeedsComment,
  adjustmentCanBeValidated,
  candidateAuthority,
  chainsOf,
  creditApprovalOutcome,
  defaultCandidate,
  MODIFIABLE,
  myPendingStep,
  submitNeedsComment,
  VALIDATION_ACTIONS,
  VALIDATION_KINDS,
  VALIDATION_ROLE,
  VALIDATION_STATUSES,
  validationKind,
  validationTone,
} from './validation'
import type { ValidationCandidate } from './validation'

/** The body of one function in 0060, from its create statement to its end. */
function fn(name: string): string {
  const start = M60.search(new RegExp(`create (or replace )?function tci\\.${name}\\(`))
  expect(start, name).toBeGreaterThanOrEqual(0)
  const rest = M60.slice(start)
  const end = rest.search(/\n\$(function)?\$;/)
  return rest.slice(0, end)
}

describe('enums (0060)', () => {
  it('validation statuses are tci.validation_status, in order', () => {
    expect(M60).toContain(
      "create type tci.validation_status as enum\n  ('pending', 'approved', 'approved_modified', 'returned', 'rejected', 'forwarded', 'cancelled');",
    )
    expect([...VALIDATION_STATUSES]).toEqual([
      'pending',
      'approved',
      'approved_modified',
      'returned',
      'rejected',
      'forwarded',
      'cancelled',
    ])
  })

  it('kinds are tci.validation_kind', () => {
    expect(M60).toContain("create type tci.validation_kind as enum ('required', 'voluntary');")
    expect([...VALIDATION_KINDS]).toEqual(['required', 'voluntary'])
  })

  it('a tone for every status', () => {
    for (const s of VALIDATION_STATUSES) expect(validationTone(s)).toBeTruthy()
    expect(validationTone('rejected')).toBe('neg')
    expect(validationTone('approved_modified')).toBe('pos')
  })
})

describe('the validator’s answers (resolve_limit_validation)', () => {
  const resolve = fn('resolve_limit_validation')

  it('offers exactly the actions the function accepts', () => {
    expect(resolve).toContain("if p_action not in ('approve', 'approve_modified', 'return', 'reject', 'forward') then")
    expect([...VALIDATION_ACTIONS]).toEqual(['approve', 'approve_modified', 'return', 'reject', 'forward'])
  })

  it('return and reject must say why; the others need not', () => {
    expect(resolve).toContain("if p_action in ('return', 'reject') and coalesce(btrim(p_comment), '') = '' then")
    expect(VALIDATION_ACTIONS.filter(actionNeedsComment)).toEqual(['return', 'reject'])
  })

  it('only the assigned validator answers, and only once', () => {
    expect(resolve).toContain('if v_row.validator_id <> (select auth.uid()) then')
    expect(resolve).toContain("raise exception 'validation_closed: this validation is already %'")
  })

  it('a credit approval takes its outcome from the amount against the request', () => {
    expect(resolve).toContain(
      `      v_outcome := case
        when v_row.outcome = 'declined' and p_action = 'approve' then 'declined'
        when v_amount is null then 'declined'
        when v_amount < v_request.requested_amount then 'partial'
        else 'approved' end;`,
    )
    const base = { requestedAmount: 1000 } as const
    expect(creditApprovalOutcome({ ...base, proposed: 'declined', action: 'approve', amount: null })).toBe('declined')
    expect(creditApprovalOutcome({ ...base, proposed: 'declined', action: 'approve_modified', amount: 1000 })).toBe('approved')
    expect(creditApprovalOutcome({ ...base, proposed: 'approved', action: 'approve', amount: 999 })).toBe('partial')
    expect(creditApprovalOutcome({ ...base, proposed: 'partial', action: 'approve_modified', amount: 1000 })).toBe('approved')
    expect(creditApprovalOutcome({ ...base, proposed: 'approved', action: 'approve', amount: null })).toBe('declined')
  })

  it('commercial approve-modified changes the amount and the payment terms only', () => {
    expect(resolve).toContain(
      "case when p_action = 'approve_modified' then coalesce(p_payment_terms, v_row.payment_terms_days)",
    )
    // the credit stream re-runs decide with the proposal's own conditions,
    // validity and assessment: only the amount (and so the outcome) moves
    expect(resolve).toContain('v_row.currency_code, v_row.valid_from, v_row.valid_until, v_row.conditions,')
    expect(MODIFIABLE.credit).toEqual(['amount'])
    expect(MODIFIABLE.commercial).toEqual(['amount', 'paymentTerms'])
  })

  it('the approval goes through the ordinary decision functions, as the validator', () => {
    expect(resolve).toContain("perform set_config('tci.resolving_validation', v_row.id::text, true);")
    expect(resolve).toContain('v_result := tci.decide_limit_request(')
    expect(resolve).toContain('v_result := tci.adjust_limit_commercial(')
    // beyond the VALIDATOR's authority: refused by name — forward instead
    expect(fn('decide_limit_request')).toContain("raise exception 'validation_beyond_authority:")
  })

  it('forward excludes everyone already in the chain (four eyes)', () => {
    expect(resolve).toContain(
      'perform tci.check_validator(p_forward_to, v_row.stream, v_row.grade_band, v_row.amount,\n                                v_row.currency_code, v_row.chain_id);',
    )
    expect(M60).toContain('constraint limit_validations_four_eyes check (validator_id <> proposed_by')
  })
})

describe('required or voluntary (submit_limit_for_validation / submit_adjustment_for_validation)', () => {
  it('beyond the author’s authority it is required; admin and a decline never are', () => {
    expect(fn('submit_limit_for_validation')).toContain(
      `  v_kind := case
              when p_amount is not null and not tci.has_role('admin')
                   and v_amount_uzs > tci.my_authority_uzs(v_band) then 'required'
              else 'voluntary' end;`,
    )
    expect(fn('submit_adjustment_for_validation')).toContain(
      "and v_amount_uzs > tci.user_authority_uzs((select auth.uid()), 'commercial', v_band) then 'required'",
    )
    expect(validationKind({ amountUzs: 101, authorityUzs: 100, isAdmin: false })).toBe('required')
    expect(validationKind({ amountUzs: 100, authorityUzs: 100, isAdmin: false })).toBe('voluntary') // strict >
    expect(validationKind({ amountUzs: 1e15, authorityUzs: 0, isAdmin: true })).toBe('voluntary')
    expect(validationKind({ amountUzs: null, authorityUzs: 0, isAdmin: false })).toBe('voluntary') // a decline
    expect(validationKind({ amountUzs: 5, authorityUzs: null, isAdmin: false })).toBeNull() // no rate: the DB says
  })

  it('a voluntary step must carry a comment (both streams)', () => {
    const rule = "if v_kind = 'voluntary' and coalesce(btrim(p_comment), '') = '' then"
    expect(fn('submit_limit_for_validation')).toContain(rule)
    expect(fn('submit_adjustment_for_validation')).toContain(rule)
    expect(submitNeedsComment('voluntary')).toBe(true)
    expect(submitNeedsComment('required')).toBe(false)
    expect(submitNeedsComment(null)).toBe(true) // cannot tell: ask for it
  })

  it('a reduction is never validated and never authority-checked', () => {
    expect(fn('submit_adjustment_for_validation')).toContain(
      "  if p_new_amount < v_credit.approved_amount then\n    raise exception 'validation_not_for_reduction:",
    )
    expect(fn('adjust_limit_commercial')).toContain("if not tci.has_role('admin') and not v_is_reduction then")
    expect(adjustmentCanBeValidated(99, 100)).toBe(false)
    expect(adjustmentCanBeValidated(100, 100)).toBe(true)
    expect(adjustmentCanBeValidated(150, 100)).toBe(true)
  })

  it('the department follows the stream (credit → credit, commercial → commercial)', () => {
    expect(fn('validation_role')).toContain(
      "select case p_stream when 'credit' then 'credit_underwriter'::tci.user_role\n                       else 'commercial_underwriter'::tci.user_role end",
    )
    expect(VALIDATION_ROLE).toEqual({ credit: 'credit_underwriter', commercial: 'commercial_underwriter' })
  })

  it('while a step is pending the decision does not exist', () => {
    expect(fn('decide_limit_request')).toContain(
      "raise exception 'limit_validation_pending: this request is on validation'",
    )
    expect(fn('adjust_limit_commercial')).toContain(
      "raise exception 'limit_validation_pending: an adjustment of this limit is on validation'",
    )
    // the commercial step holds the credit decision so the client sees nothing
    expect(fn('submit_adjustment_for_validation')).toContain(
      'update tci.credit_limit_decisions set held = true where id = p_decision_id;',
    )
  })
})

describe('candidates (tci.validation_candidates)', () => {
  const candidates = fn('validation_candidates')

  it('the manager first, never the caller; admin’s authority is unlimited', () => {
    expect(candidates).toContain('order by (u.id = v_manager) desc, p.full_name nulls last, u.email;')
    expect(candidates).toContain('and u.id <> v_me')
    expect(fn('user_authority_uzs')).toContain("then 'Infinity'::numeric")
  })

  const c = (over: Partial<ValidationCandidate>): ValidationCandidate => ({
    user_id: 'u',
    full_name: 'X',
    email: 'x@demo.invalid',
    is_manager: false,
    authority_uzs: 1,
    ...over,
  })

  it('preselects the manager only', () => {
    expect(defaultCandidate([c({ user_id: 'a' }), c({ user_id: 'm', is_manager: true })])).toBe('m')
    expect(defaultCandidate([c({ user_id: 'a' })])).toBeNull()
    expect(defaultCandidate([])).toBeNull()
  })

  it('reads Postgres Infinity as unlimited', () => {
    expect(candidateAuthority('Infinity')).toBe(Number.POSITIVE_INFINITY)
    expect(candidateAuthority('300000.00')).toBe(300000)
    expect(candidateAuthority(42)).toBe(42)
    expect(candidateAuthority(null)).toBeNull()
  })
})

describe('chains', () => {
  const step = (id: string, chain: string, at: string, status = 'approved', validator = 'v') => ({
    id,
    chain_id: chain,
    created_at: at,
    status: status as 'pending' | 'approved',
    validator_id: validator,
  })

  it('groups steps by chain, newest chain first, steps in order', () => {
    const chains = chainsOf([
      step('b2', 'b', '2026-10-03T00:00:00Z'),
      step('a1', 'a', '2026-10-01T00:00:00Z'),
      step('b1', 'b', '2026-10-02T00:00:00Z'),
    ])
    expect(chains.map((ch) => ch.map((s) => s.id))).toEqual([['b1', 'b2'], ['a1']])
  })

  it('finds the step the caller must answer', () => {
    const steps = [step('1', 'a', 't1', 'forwarded', 'me'), step('2', 'a', 't2', 'pending', 'me')]
    expect(myPendingStep(steps, 'me')?.id).toBe('2')
    expect(myPendingStep(steps, 'other')).toBeNull()
    expect(myPendingStep(steps, undefined)).toBeNull()
  })
})

describe('every 0060 refusal is named on screen', () => {
  it('maps each refusal code the migration raises', () => {
    const codes = [...new Set([...M60.matchAll(/raise exception '([a-z_]+):/g)].map((m) => m[1]!))]
    expect(codes.length).toBeGreaterThanOrEqual(13)
    const mapped = OPERATIONS_REFUSALS.map((r) => r.fragment)
    expect(codes.filter((code) => !mapped.includes(code))).toEqual([])
  })
})
