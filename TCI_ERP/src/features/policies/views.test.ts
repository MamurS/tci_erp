import { describe, expect, it } from 'vitest'

import { canAccessPath } from '../../components/layout/navigation'
import { LEGACY_POLICY_VIEW_PATHS, parsePolicyView } from './views'

describe('the policies section views', () => {
  it('reads the view from the address and falls back to the registry', () => {
    expect(parsePolicyView('contracts')).toBe('contracts')
    expect(parsePolicyView('templates')).toBe('templates')
    expect(parsePolicyView(null)).toBe('registry')
    expect(parsePolicyView('admin')).toBe('registry')
  })

  it('sends the old contracts and templates addresses into the section, guarded like policies', () => {
    expect(LEGACY_POLICY_VIEW_PATHS['/contracts']).toBe('/policies?view=contracts')
    expect(LEGACY_POLICY_VIEW_PATHS['/wording']).toBe('/policies?view=templates')
    expect(canAccessPath(['commercial_underwriter'], '/policies')).toBe(true)
    expect(canAccessPath(['sales'], '/policies')).toBe(true)
    expect(canAccessPath(['credit_underwriter'], '/policies')).toBe(false)
  })
})
