import { describe, expect, it } from 'vitest'

import M65 from '../../../supabase/migrations/0065_admin_technical_only.sql?raw'
import { ENTITY_WRITERS, RATING_WRITERS, mayRate, mayWriteEntities } from './access'

const roleArray = (roles: readonly string[]) => roles.map((r) => `'${r}'::tci.user_role`).join(', ')

describe('company and rating access (0065: admin is technical)', () => {
  it('mirrors the write policies on companies and ratings', () => {
    expect(M65).toContain(`alter policy "legal_entities: staff write" on tci.legal_entities
  using (tci.has_role(VARIADIC ARRAY[${roleArray(ENTITY_WRITERS)}]))`)
    expect(M65).toContain(`alter policy "credit_assessments: credit write" on tci.credit_assessments
  using (tci.has_role(VARIADIC ARRAY[${roleArray(RATING_WRITERS)}]))`)
  })

  it('offers the company form to the business desks, never to admin or claims', () => {
    for (const r of ENTITY_WRITERS) expect(mayWriteEntities([r])).toBe(true)
    expect(mayWriteEntities(['admin'])).toBe(false)
    expect(mayWriteEntities(['claims'])).toBe(false)
    expect(mayWriteEntities(['client'])).toBe(false)
  })

  it('offers «calculate rating» to credit underwriting only', () => {
    expect(mayRate(['credit_underwriter'])).toBe(true)
    for (const r of ['admin', 'sales', 'commercial_underwriter', 'information_manager', 'claims'] as const) {
      expect(mayRate([r])).toBe(false)
    }
  })
})
