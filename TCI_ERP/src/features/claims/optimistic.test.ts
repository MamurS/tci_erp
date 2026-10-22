import { describe, expect, it } from 'vitest'

import MIGRATION_0033 from '../../../supabase/migrations/0033_coverage_verification.sql?raw'
import { claimQueryAffected, overrideCleared, overridden, withClaimStatus } from './optimistic'
import type { ClaimInvoiceCoverage } from './types'

const line = {
  claim_invoice_id: 'i1',
  system_verdict: 'covered',
  system_covered_amount: 100,
  override_verdict: null,
  override_covered_amount: null,
  override_justification: null,
  overridden_by: null,
  overridden_at: null,
  effective_verdict: 'covered',
  effective_covered_amount: 100,
  is_overridden: false,
} as unknown as ClaimInvoiceCoverage

describe('coverage overrides', () => {
  it('the effective verdict is coalesce(override, system), as the generated column says', () => {
    expect(MIGRATION_0033).toContain('generated always as (coalesce(override_verdict, system_verdict)) stored')
    const o = overridden(line, 'partial', 40, 'documents', 'me', 'T')
    expect(o).toMatchObject({ effective_verdict: 'partial', effective_covered_amount: 40, is_overridden: true })
    // what the engine said is never overwritten
    expect(o).toMatchObject({ system_verdict: 'covered', system_covered_amount: 100 })
  })

  it('clearing puts the engine verdict back in force', () => {
    const cleared = overrideCleared(overridden(line, 'not_covered', 0, 'x', 'me', 'T'))
    expect(cleared).toMatchObject({ effective_verdict: 'covered', effective_covered_amount: 100, is_overridden: false, override_verdict: null })
  })
})

describe('claim status', () => {
  it('only the status moves', () => {
    expect(withClaimStatus({ id: 'c', status: 'draft' as const, approved_indemnity: null }, 'submitted')).toEqual({
      id: 'c',
      status: 'submitted',
      approved_indemnity: null,
    })
  })
})

describe('claimQueryAffected', () => {
  it('a write on one claim refreshes its own tabs and the lists, not other claims', () => {
    expect(claimQueryAffected(['claims', 'one', 'c1'], 'c1')).toBe(true)
    expect(claimQueryAffected(['claims', 'coverage', 'c1'], 'c1')).toBe(true)
    expect(claimQueryAffected(['claims', 'list', 'all'], 'c1')).toBe(true)
    expect(claimQueryAffected(['claims', 'liability', 'p1'], 'c1')).toBe(true)
    expect(claimQueryAffected(['claims', 'coverage', 'c2'], 'c1')).toBe(false)
    expect(claimQueryAffected(['policies'], 'c1')).toBe(false)
    expect(claimQueryAffected(['claims', 'coverage', 'c2'], undefined)).toBe(true)
  })
})
