import { describe, expect, it } from 'vitest'

import M32 from '../../../supabase/migrations/0032_claims.sql?raw'
import M33 from '../../../supabase/migrations/0033_coverage_verification.sql?raw'
import M34 from '../../../supabase/migrations/0034_indemnity_recoveries.sql?raw'
import M35 from '../../../supabase/migrations/0035_claim_documents.sql?raw'
import M36 from '../../../supabase/migrations/0036_claims_agenda_portal.sql?raw'
import M37 from '../../../supabase/migrations/0037_nql_threshold.sql?raw'
import { CLAIM_REFUSALS, claimErrorKey } from './errors'

const ALL = [M32, M33, M34, M35, M36, M37].join('\n')

describe('claim refusal mapping — contract with 0032-0036', () => {
  it('maps only refusals the database actually raises', () => {
    for (const { fragment } of CLAIM_REFUSALS) {
      expect(ALL, `no exception in the migrations says "${fragment}"`).toContain(fragment)
    }
  })

  it('maps the unique-index violations by their index name', () => {
    // These are not raises, so the test checks the index exists instead.
    expect(M32).toContain('create unique index claims_live_uq')
    expect(M32).toContain('create unique index claims_noa_uq')
    expect(M32).toContain('constraint claim_invoices_number_per_claim unique (claim_id, invoice_number)')
    expect(M35).toContain('constraint claim_documents_storage_path_uq unique (storage_path)')
    expect(
      claimErrorKey({
        message: 'duplicate key value violates unique constraint "claims_live_uq"',
      }),
    ).toBe('claims.errors.alreadyOpen')
  })

  it('finds the key for a real refusal', () => {
    expect(claimErrorKey({ message: 'this claim is not ready to be filed: a, b' })).toBe(
      'claims.errors.notReady',
    )
    expect(
      claimErrorKey({ message: 'this payment would exceed the approved indemnity (0 already paid of 50000)' }),
    ).toBe('claims.errors.overpayment')
    expect(claimErrorKey({ message: 'invalid claim transition: paid -> draft' })).toBe(
      'claims.errors.invalidTransition',
    )
  })

  it('separates "nothing covered" from "below the threshold"', () => {
    // Different facts, and the policyholder is owed the second one plainly.
    expect(M37).toContain('this claim computes to nothing payable')
    expect(M37).toContain('is below the non-qualifying loss threshold')
    expect(
      claimErrorKey({ message: 'the covered loss (900.00) is below the non-qualifying loss threshold (1000.00) - this claim is not indemnifiable' }),
    ).toBe('claims.errors.belowNql')
  })

  it('says nothing about a failure it does not recognise', () => {
    expect(claimErrorKey({ message: 'connection reset by peer' })).toBeNull()
    expect(claimErrorKey(null)).toBeNull()
    expect(claimErrorKey({})).toBeNull()
  })
})
