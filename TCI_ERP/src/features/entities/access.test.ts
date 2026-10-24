import { describe, expect, it } from 'vitest'

import M65 from '../../../supabase/migrations/0065_admin_technical_only.sql?raw'
import M69 from '../../../supabase/migrations/0069_credit_analysis.sql?raw'
import { ENTITY_WRITERS, mayConfirmRating, mayRate, mayWriteEntities } from './access'

const roleArray = (roles: readonly string[]) => roles.map((r) => `'${r}'::tci.user_role`).join(', ')

describe('company and rating access (0065: admin is technical)', () => {
  it('mirrors the write policies on companies and ratings', () => {
    expect(M65).toContain(`alter policy "legal_entities: staff write" on tci.legal_entities
  using (tci.has_role(VARIADIC ARRAY[${roleArray(ENTITY_WRITERS)}]))`)
    expect(M69).toContain(`alter policy "credit_assessments: credit write" on tci.credit_assessments
  using (tci.has_capability('rate'))`)
  })

  it('offers the company form to the business desks, never to admin or claims', () => {
    for (const r of ENTITY_WRITERS) expect(mayWriteEntities([r])).toBe(true)
    expect(mayWriteEntities(['admin'])).toBe(false)
    expect(mayWriteEntities(['claims'])).toBe(false)
    expect(mayWriteEntities(['client'])).toBe(false)
  })

  it('offers «calculate rating» to whoever rates under the mode', () => {
    expect(mayRate(['credit_underwriter'], 'combined')).toBe(true)
    expect(mayRate(['credit_underwriter'], 'separate')).toBe(false)
    expect(mayRate(['credit_analyst'], 'separate')).toBe(true)
    for (const r of ['admin', 'sales', 'commercial_underwriter', 'information_manager', 'claims'] as const) {
      expect(mayRate([r], 'combined')).toBe(false)
    }
  })

  it('offers «confirm» on an unconfirmed rating, never to the one who calculated it', () => {
    const rating = { created_by: 'u1', confirmed_at: null }
    expect(mayConfirmRating(['credit_analyst'], 'separate', rating, 'u2')).toBe(true)
    expect(mayConfirmRating(['credit_analyst'], 'separate', rating, 'u1')).toBe(false)
    expect(mayConfirmRating(['credit_underwriter'], 'separate', rating, 'u2')).toBe(false)
    expect(mayConfirmRating(['credit_underwriter'], 'combined', rating, 'u2')).toBe(true)
    expect(mayConfirmRating(['credit_analyst'], 'combined', { ...rating, confirmed_at: '2026-10-23' }, 'u2')).toBe(false)
    expect(mayConfirmRating(['credit_analyst'], 'combined', null, 'u2')).toBe(false)
    expect(M69).toContain("raise exception 'four_eyes_own_rating: you calculated this rating and cannot confirm it'")
  })
})
