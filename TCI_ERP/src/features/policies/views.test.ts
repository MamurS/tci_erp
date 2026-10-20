import { describe, expect, it } from 'vitest'

import { canAccessPath } from '../../components/layout/navigation'
import { LEGACY_POLICY_VIEW_PATHS, POLICY_VIEWS, parsePolicyView, policyViewsFor } from './views'

describe('the policies section views', () => {
  it('gives the commercial desk the portfolio overview and everyone else the rest', () => {
    expect(policyViewsFor(['commercial_underwriter'])).toEqual(POLICY_VIEWS)
    expect(policyViewsFor(['admin'])).toEqual(POLICY_VIEWS)
    expect(policyViewsFor(['sales'])).toEqual(['registry', 'contracts', 'templates'])
  })

  it('reads the view from the address and falls back to the first view', () => {
    expect(parsePolicyView('contracts', ['sales'])).toBe('contracts')
    expect(parsePolicyView('templates', ['commercial_underwriter'])).toBe('templates')
    expect(parsePolicyView(null, ['commercial_underwriter'])).toBe('overview')
    expect(parsePolicyView(null, ['sales'])).toBe('registry')
    // a view the roles may not see falls back rather than leaking
    expect(parsePolicyView('overview', ['sales'])).toBe('registry')
    expect(parsePolicyView('admin', ['admin'])).toBe('overview')
  })

  it('sends the old addresses into the section, guarded like policies', () => {
    expect(LEGACY_POLICY_VIEW_PATHS['/contracts']).toBe('/policies?view=contracts')
    expect(LEGACY_POLICY_VIEW_PATHS['/wording']).toBe('/policies?view=templates')
    expect(LEGACY_POLICY_VIEW_PATHS['/portfolio/policies']).toBe('/policies?view=overview')
    expect(canAccessPath(['commercial_underwriter'], '/policies')).toBe(true)
    expect(canAccessPath(['sales'], '/policies')).toBe(true)
    expect(canAccessPath(['credit_underwriter'], '/policies')).toBe(false)
  })
})
