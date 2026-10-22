import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0012_policyholders_policies.sql?raw'
import { liabilityBasis, liabilityColumns } from './maxLiability'

describe('max liability basis', () => {
  it('reads the basis the stored terms are on', () => {
    expect(liabilityBasis(1_000_000, null)).toBe('amount')
    expect(liabilityBasis(null, 20)).toBe('multiple')
    expect(liabilityBasis('', '20')).toBe('multiple')
    expect(liabilityBasis(null, null)).toBe('amount')
  })

  it('saves the chosen basis and NULLs the other column', () => {
    expect(liabilityColumns('amount', 5)).toEqual({ max_liability_amount: 5, max_liability_premium_multiple: null })
    expect(liabilityColumns('multiple', 20)).toEqual({ max_liability_amount: null, max_liability_premium_multiple: 20 })
  })

  it('stays within the database rule: one column is enough for a non-draft policy', () => {
    expect(MIGRATION).toContain('or max_liability_amount is not null')
    expect(MIGRATION).toContain('or max_liability_premium_multiple is not null')
  })
})
