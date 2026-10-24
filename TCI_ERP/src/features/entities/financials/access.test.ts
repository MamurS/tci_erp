import { describe, expect, it } from 'vitest'

import M69 from '../../../../supabase/migrations/0069_credit_analysis.sql?raw'
import { STATEMENT_WRITERS, mayEnterStatements } from './access'

describe('statement entry access', () => {
  it('mirrors the data-write policy on financial statements', () => {
    const quoted = STATEMENT_WRITERS.map((r) => `'${r}'::tci.user_role`).join(', ')
    expect(M69).toContain(`alter policy "financial_statements: data write" on tci.financial_statements
  using (tci.has_role(VARIADIC ARRAY[${quoted}]))`)
  })

  it('offers entry to the data, credit and analysis desks only', () => {
    expect(mayEnterStatements(['information_manager'])).toBe(true)
    expect(mayEnterStatements(['credit_underwriter', 'sales'])).toBe(true)
    expect(mayEnterStatements(['credit_analyst'])).toBe(true)
    expect(mayEnterStatements(['sales'])).toBe(false)
    expect(mayEnterStatements(['commercial_underwriter'])).toBe(false)
    expect(mayEnterStatements(['admin'])).toBe(false)
  })
})
