import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../../supabase/migrations/0016_department_roles.sql?raw'
import { STATEMENT_WRITERS, mayEnterStatements } from './access'

describe('statement entry access', () => {
  it('mirrors the data-write policy on financial statements', () => {
    const quoted = STATEMENT_WRITERS.map((r) => `'${r}'`).join(', ')
    expect(MIGRATION).toContain(`create policy "financial_statements: data write"
  on tci.financial_statements for all to authenticated
  using (tci.has_role(${quoted}))`)
  })

  it('offers entry to the data and credit desks only', () => {
    expect(mayEnterStatements(['information_manager'])).toBe(true)
    expect(mayEnterStatements(['credit_underwriter', 'sales'])).toBe(true)
    expect(mayEnterStatements(['sales'])).toBe(false)
    expect(mayEnterStatements(['commercial_underwriter'])).toBe(false)
  })
})
