/** Contract test: fourEyes.ts mirrors tci.limit_four_eyes_refusal (0063) and
 * the functions that consult it. */

import { describe, expect, it } from 'vitest'

import M63 from '../../../supabase/migrations/0063_acting_role.sql?raw'
import { FOUR_EYES_CODES, fourEyesNoticeKey, fourEyesRefusal } from './fourEyes'

function fn(name: string): string {
  const start = M63.search(new RegExp(`create (or replace )?function tci\\.${name}\\(`, 'i'))
  expect(start, name).toBeGreaterThanOrEqual(0)
  const rest = M63.slice(start)
  return rest.slice(0, rest.search(/\n\$(function|\$)?\$?\n?;/))
}

describe('the rule (tci.limit_four_eyes_refusal)', () => {
  const rule = fn('limit_four_eyes_refusal')

  it('the requester first, then — on the commercial stage only — the credit decider', () => {
    expect(rule).toContain(`    when r.requested_by = p_user then\n      '${FOUR_EYES_CODES.own_request}:`)
    expect(rule).toContain("    when p_stream = 'commercial' and exists (")
    expect(rule).toContain("where d.request_id = p_request_id and d.stage = 'credit' and d.decided_by = p_user) then")
    expect(rule).toContain(`      '${FOUR_EYES_CODES.own_credit_decision}:`)
    // nobody is exempt: the rule never mentions a role
    expect(rule).not.toContain('has_role')
  })

  it('the mirror answers the same', () => {
    expect(fourEyesRefusal({ userId: 'u', requestedBy: 'u', stream: 'credit' })).toBe('own_request')
    expect(fourEyesRefusal({ userId: 'u', requestedBy: 'u', stream: 'commercial', creditDeciders: ['u'] })).toBe(
      'own_request',
    )
    expect(fourEyesRefusal({ userId: 'u', requestedBy: 'x', stream: 'commercial', creditDeciders: ['u'] })).toBe(
      'own_credit_decision',
    )
    // a credit decider may still decide on the credit stage (a new decision)
    expect(fourEyesRefusal({ userId: 'u', requestedBy: 'x', stream: 'credit', creditDeciders: ['u'] })).toBeNull()
    expect(fourEyesRefusal({ userId: 'u', requestedBy: 'x', stream: 'commercial', creditDeciders: [null, 'y'] })).toBeNull()
    expect(fourEyesRefusal({ userId: undefined, requestedBy: 'x', stream: 'credit' })).toBeNull()
  })

  it('names the notice for each case', () => {
    expect(fourEyesNoticeKey('own_request', 'credit')).toBe('limits.fourEyes.ownRequest')
    expect(fourEyesNoticeKey('own_request', 'commercial')).toBe('limits.fourEyes.ownRequestCommercial')
    expect(fourEyesNoticeKey('own_credit_decision', 'commercial')).toBe('limits.fourEyes.ownCreditDecision')
  })
})

describe('who consults it', () => {
  it('review, decide and propose ask for the caller on the credit stream', () => {
    for (const f of ['start_limit_review', 'decide_limit_request', 'submit_limit_for_validation'])
      expect(fn(f), f).toContain("v_refusal := tci.limit_four_eyes_refusal(p_request_id, (select auth.uid()), 'credit');")
  })

  it('adjust and propose-adjustment ask on the commercial stream', () => {
    for (const f of ['adjust_limit_commercial', 'submit_adjustment_for_validation'])
      expect(fn(f), f).toContain(
        "v_refusal := tci.limit_four_eyes_refusal(v_credit.request_id, (select auth.uid()), 'commercial');",
      )
  })

  it('a named validator is held to the same rule, by name', () => {
    expect(fn('submit_limit_for_validation')).toContain(
      "v_refusal := tci.limit_four_eyes_refusal(p_request_id, p_validator_id, 'credit');",
    )
    expect(fn('submit_adjustment_for_validation')).toContain(
      "v_refusal := tci.limit_four_eyes_refusal(v_credit.request_id, p_validator_id, 'commercial');",
    )
    expect(fn('resolve_limit_validation')).toContain(
      'if tci.limit_four_eyes_refusal(v_row.request_id, p_forward_to, v_row.stream) is not null then',
    )
  })
})
