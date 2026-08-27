/** Grant validation mirrors the tci.authority_grants constraints. */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0017_authority_matrix.sql?raw'
import { grantIsCurrent, validateGrant } from './authorityForm'

describe('validateGrant', () => {
  it('accepts a well-formed grant', () => {
    expect(
      validateGrant({ maxAmount: 100, validFrom: '2026-01-01', validTo: '2026-12-31' }),
    ).toBeNull()
    expect(validateGrant({ maxAmount: 1, validFrom: '2026-01-01', validTo: null })).toBeNull()
  })

  it('requires a positive amount (DB: check (max_amount > 0))', () => {
    expect(validateGrant({ maxAmount: 0, validFrom: '2026-01-01', validTo: null })).toBe(
      'amountPositive',
    )
    expect(validateGrant({ maxAmount: -5, validFrom: '2026-01-01', validTo: null })).toBe(
      'amountPositive',
    )
    expect(validateGrant({ maxAmount: Number.NaN, validFrom: '2026-01-01', validTo: null })).toBe(
      'amountPositive',
    )
    expect(MIGRATION).toContain('check (max_amount > 0)')
  })

  it('requires valid_to >= valid_from (DB: authority_grants_period)', () => {
    expect(
      validateGrant({ maxAmount: 1, validFrom: '2026-06-01', validTo: '2026-05-31' }),
    ).toBe('periodOrder')
    // same day is fine
    expect(
      validateGrant({ maxAmount: 1, validFrom: '2026-06-01', validTo: '2026-06-01' }),
    ).toBeNull()
    expect(MIGRATION).toContain('check (valid_to is null or valid_to >= valid_from)')
  })

  it('requires a start date', () => {
    expect(validateGrant({ maxAmount: 1, validFrom: '', validTo: null })).toBe('validFromRequired')
  })
})

describe('grantIsCurrent', () => {
  const TODAY = '2026-08-27'
  it('matches the SQL validity window (both bounds inclusive)', () => {
    expect(grantIsCurrent({ valid_from: '2026-01-01', valid_to: null }, TODAY)).toBe(true)
    expect(grantIsCurrent({ valid_from: TODAY, valid_to: TODAY }, TODAY)).toBe(true)
    expect(grantIsCurrent({ valid_from: '2026-09-01', valid_to: null }, TODAY)).toBe(false)
    expect(grantIsCurrent({ valid_from: '2026-01-01', valid_to: '2026-08-26' }, TODAY)).toBe(false)
  })
})

describe('migration 0017 legacy expansion', () => {
  it('expands each old amount-only row across every band', () => {
    expect(MIGRATION).toContain(
      "cross join (values ('A'::tci.grade_band), ('B'), ('C'), ('D'), ('unrated')) as b(band)",
    )
    expect(MIGRATION).toContain('authority migration mismatch')
    expect(MIGRATION).toContain('drop table tci.underwriting_authorities')
  })
})
