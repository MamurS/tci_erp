/** Contract test: bind.ts must mirror tci.bind_insurance_request and the
 * nullable-policy_id scoping of migration 0023 — the required-terms list, the
 * role gate, the idempotency guard, the unique-index predicate and the
 * effective-limit grouping key. */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0023_nullable_policy_bind.sql?raw'
import {
  bindBlocker,
  canBindAs,
  defaultBindDates,
  missingTerms,
  REQUIRED_TERMS,
  validateBind,
} from './bind'
import type { InsuranceRequest } from './types'

const ACCEPTED = {
  status: 'accepted',
  bound_policy_id: null,
} as Pick<InsuranceRequest, 'status' | 'bound_policy_id'>

describe('required terms', () => {
  it('matches the v_missing array of the SQL function, in the same order', () => {
    const block = MIGRATION.slice(MIGRATION.indexOf('v_missing := array_remove(array['))
    const list = block.slice(0, block.indexOf('], null);'))
    const inSql = [...list.matchAll(/then '([a-z_]+)' end/g)].map((m) => m[1])
    expect(inSql).toEqual([...REQUIRED_TERMS])
  })

  it('names the terms a half-filled submission still lacks', () => {
    const partial = {
      product_structure: 'whole_turnover',
      currency_code: 'UZS',
      insured_percentage: 85,
      nql_amount: null,
      premium_rate_pct: 0.6,
      minimum_premium: null,
    } as Partial<InsuranceRequest>
    expect(missingTerms(partial)).toEqual([
      'nql_amount',
      'minimum_premium',
      'discretionary_limit',
      'waiting_period_days',
      'max_extension_period_days',
      'max_payment_terms_days',
      'declaration_frequency',
    ])
  })
})

describe('who may bind', () => {
  it('mirrors the function role gate', () => {
    expect(MIGRATION).toContain("if not tci.has_role('admin', 'commercial_underwriter') then")
    expect(canBindAs(['commercial_underwriter'])).toBe(true)
    expect(canBindAs(['admin'])).toBe(true)
    expect(canBindAs(['sales'])).toBe(false)
    expect(canBindAs(['credit_underwriter'])).toBe(false)
    expect(canBindAs([])).toBe(false)
  })
})

describe('guards', () => {
  it('mirrors the idempotency guard: a bound submission refuses a second policy', () => {
    expect(MIGRATION).toContain('if v_request.bound_policy_id is not null then')
    expect(bindBlocker({ ...ACCEPTED, bound_policy_id: 'p1' })).toBe('alreadyBound')
  })

  it('mirrors the status guard', () => {
    expect(MIGRATION).toContain("if v_request.status <> 'accepted' then")
    expect(bindBlocker({ ...ACCEPTED, status: 'client_review' })).toBe('notAccepted')
    expect(bindBlocker(ACCEPTED)).toBeNull()
  })
})

describe('form validation', () => {
  it('requires a number and both dates, as the function does', () => {
    expect(MIGRATION).toContain("raise exception 'a policy needs a number'")
    const errors = validateBind({ policy_number: '  ', inception_date: '', expiry_date: '' })
    expect(errors).toEqual({
      policy_number: 'required',
      inception_date: 'required',
      expiry_date: 'required',
    })
  })

  it('mirrors the period order guard', () => {
    expect(MIGRATION).toContain('if p_expiry_date <= p_inception_date then')
    expect(
      validateBind({
        policy_number: 'P-1',
        inception_date: '2026-01-01',
        expiry_date: '2026-01-01',
      }).expiry_date,
    ).toBe('periodOrder')
    expect(
      validateBind({
        policy_number: 'P-1',
        inception_date: '2026-01-01',
        expiry_date: '2026-12-31',
      }),
    ).toEqual({})
  })

  it('defaults to a one-year period that passes its own validation', () => {
    const dates = defaultBindDates(new Date('2026-08-27T09:00:00Z'))
    expect(dates).toEqual({ inception_date: '2026-08-27', expiry_date: '2027-08-26' })
    expect(validateBind({ policy_number: 'P-1', ...dates })).toEqual({})
  })
})

describe('nullable policy_id scoping', () => {
  it('keys the one-open-request index on the scope, not on the policy', () => {
    expect(MIGRATION).toContain(
      'on tci.credit_limit_requests (tci.limit_scope(policy_id, insurance_request_id), entity_id)',
    )
    expect(MIGRATION).toContain(
      "where status in ('draft', 'submitted', 'under_review', 'escalated')",
    )
  })

  it('defines the scope as policy first, submission second', () => {
    expect(MIGRATION).toContain('select coalesce(p_policy_id, p_insurance_request_id)')
  })

  it('never lets a request end up with no scope at all', () => {
    expect(MIGRATION).toContain(
      'check (policy_id is not null or insurance_request_id is not null)',
    )
  })

  it('groups v_effective_limits by the same scope key', () => {
    expect(MIGRATION).toContain(
      'distinct on (tci.limit_scope(r.policy_id, r.insurance_request_id), r.entity_id)',
    )
  })

  it('keeps a pre-bind limit out of policy exposure', () => {
    expect(MIGRATION).toContain('and v.policy_id is not null')
  })

  it('writes no rendered text into the policy or the history', () => {
    // Provenance is structural (bound_policy_id); a stored English sentence
    // would show up untranslated in ru and uz.
    expect(MIGRATION).not.toContain('Created from submission')
    expect(MIGRATION).toContain("perform tci.advance_insurance_request(p_request_id, 'bound', null)")
  })

  it('adopts the package limits onto the new policy at bind', () => {
    expect(MIGRATION).toContain('update tci.credit_limit_requests')
    expect(MIGRATION).toContain('set policy_id = v_policy.id')
    expect(MIGRATION).toContain('where insurance_request_id = p_request_id')
  })
})
