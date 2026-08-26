/** Legacy /buyers and /policyholders bookmarks must keep working (Phase 3a). */

import { describe, expect, it } from 'vitest'

import { legacyRedirect } from './redirects'

describe('legacyRedirect', () => {
  it('maps registry roots', () => {
    expect(legacyRedirect('/buyers')).toBe('/entities')
    expect(legacyRedirect('/policyholders')).toBe('/entities')
  })

  it('maps cards and nested pages, keeping the id and suffix', () => {
    expect(legacyRedirect('/buyers/abc-123')).toBe('/entities/abc-123')
    expect(legacyRedirect('/policyholders/abc-123')).toBe('/entities/abc-123')
    expect(legacyRedirect('/buyers/abc/report')).toBe('/entities/abc/report')
    expect(legacyRedirect('/buyers/abc/statements/new')).toBe('/entities/abc/statements/new')
    expect(legacyRedirect('/buyers/abc/statements/s1/edit')).toBe('/entities/abc/statements/s1/edit')
  })

  it('leaves non-legacy paths alone', () => {
    expect(legacyRedirect('/entities')).toBeNull()
    expect(legacyRedirect('/policies/xyz')).toBeNull()
    expect(legacyRedirect('/buyersish')).toBeNull()
  })
})
