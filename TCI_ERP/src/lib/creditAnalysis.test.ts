import { describe, expect, it } from 'vitest'

import M69 from '../../supabase/migrations/0069_credit_analysis.sql?raw'
import { USER_ROLES } from './roles'
import { CREDIT_ANALYSIS_MODES, hasCapability, ratingTaskRole } from './creditAnalysis'

describe('credit analysis capabilities (mirror of tci.has_capability, 0069)', () => {
  it('rates and confirms by mode', () => {
    for (const cap of ['rate', 'confirm_rating'] as const) {
      expect(hasCapability(['credit_underwriter'], 'combined', cap)).toBe(true)
      expect(hasCapability(['credit_analyst'], 'combined', cap)).toBe(true)
      expect(hasCapability(['credit_underwriter'], 'separate', cap)).toBe(false)
      expect(hasCapability(['credit_analyst'], 'separate', cap)).toBe(true)
    }
  })

  it('decides by credit underwriting only, in every mode', () => {
    for (const mode of CREDIT_ANALYSIS_MODES) {
      for (const role of USER_ROLES) {
        expect(hasCapability([role], mode, 'decide')).toBe(role === 'credit_underwriter')
      }
    }
  })

  it('never gives a capability to anyone outside credit', () => {
    for (const mode of CREDIT_ANALYSIS_MODES) {
      for (const role of USER_ROLES.filter((r) => r !== 'credit_underwriter' && r !== 'credit_analyst')) {
        for (const cap of ['rate', 'confirm_rating', 'decide'] as const) {
          expect(hasCapability([role], mode, cap)).toBe(false)
        }
      }
    }
  })

  it('is the rule of the migration', () => {
    expect(M69).toContain(`    when 'rate' then
      case tci.credit_analysis_mode()
        when 'separate' then tci.has_role('credit_analyst')
        else tci.has_role('credit_analyst', 'credit_underwriter') end`)
    expect(M69).toContain(`    when 'confirm_rating' then
      case tci.credit_analysis_mode()
        when 'separate' then tci.has_role('credit_analyst')
        else tci.has_role('credit_analyst', 'credit_underwriter') end`)
    expect(M69).toContain("when 'decide' then tci.has_role('credit_underwriter')")
    expect(M69).toContain("check (credit_analysis_mode in ('combined', 'separate'))")
    expect(M69).toContain("add column if not exists credit_analysis_mode text not null default 'combined'")
  })

  it('sends the rating tasks to whoever rates', () => {
    expect(ratingTaskRole('combined')).toBe('credit_underwriter')
    expect(ratingTaskRole('separate')).toBe('credit_analyst')
    expect(M69).toContain("when 'separate' then 'credit_analyst'::tci.user_role")
  })
})
