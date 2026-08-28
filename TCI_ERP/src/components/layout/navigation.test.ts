/** The sidebar map IS the route guard: what a role cannot see, it cannot
 * open by URL either. */

import { describe, expect, it } from 'vitest'

import { NAV_ITEMS, canAccessPath, matchNavItem, navItemsForRoles } from './navigation'
import type { UserRole } from '../../lib/roles'

const keys = (roles: UserRole[]) => navItemsForRoles(roles).map((i) => i.key)

describe('role → screen map', () => {
  it('admin sees everything', () => {
    expect(keys(['admin'])).toEqual(NAV_ITEMS.map((i) => i.key))
  })

  it('matches the documented map per role', () => {
    expect(keys(['credit_underwriter'])).toEqual([
      'dashboard',
      'agenda',
      'entities',
      'requests',
      'limits',
      'declarations',
      'overdues',
      'claims',
    ])
    expect(keys(['commercial_underwriter'])).toEqual([
      'dashboard',
      'agenda',
      'entities',
      'requests',
      'limits',
      'policies',
      'declarations',
      'overdues',
      'claims',
    ])
    // Sales chases declarations (the declaration_due tasks are theirs) and
    // sees the overdue queue, but does not accept or dispute.
    expect(keys(['sales'])).toEqual([
      'dashboard',
      'agenda',
      'entities',
      'requests',
      'limits',
      'policies',
      'declarations',
      'overdues',
    ])
    expect(keys(['information_manager'])).toEqual(['dashboard', 'agenda', 'entities'])
    expect(keys(['claims'])).toEqual([
      'dashboard',
      'agenda',
      'entities',
      'overdues',
      'claims',
    ])
  })

  it('only admin sees the admin section', () => {
    for (const role of [
      'sales',
      'commercial_underwriter',
      'credit_underwriter',
      'claims',
      'information_manager',
      'client',
    ] as const) {
      expect(keys([role])).not.toContain('admin')
    }
  })

  it('multi-role users get the union', () => {
    expect(keys(['claims', 'sales'])).toEqual([
      'dashboard',
      'agenda',
      'entities',
      'requests',
      'limits',
      'policies',
      'declarations',
      'overdues',
      'claims',
    ])
  })

  it('the Agenda is staff-only — refresh_agenda refuses a client', () => {
    expect(keys(['client'])).not.toContain('agenda')
    expect(canAccessPath(['client'], '/agenda')).toBe(false)
    for (const role of [
      'admin',
      'sales',
      'commercial_underwriter',
      'credit_underwriter',
      'claims',
      'information_manager',
    ] as const) {
      expect(keys([role])).toContain('agenda')
    }
  })

  it('a user with no roles sees nothing', () => {
    expect(keys([])).toEqual([])
  })
})

describe('route guard', () => {
  it('sub-paths inherit their section', () => {
    expect(matchNavItem('/entities/abc-123')?.key).toBe('entities')
    expect(matchNavItem('/entities/abc/statements/new')?.key).toBe('entities')
    expect(matchNavItem('/limits/req-1')?.key).toBe('limits')
    expect(matchNavItem('/requests/ir-1')?.key).toBe('requests')
    expect(matchNavItem('/policies/new')?.key).toBe('policies')
    expect(matchNavItem('/')?.key).toBe('dashboard')
  })

  it('grants exactly what the sidebar shows', () => {
    expect(canAccessPath(['claims'], '/claims')).toBe(true)
    expect(canAccessPath(['claims'], '/limits')).toBe(false)
    expect(canAccessPath(['claims'], '/limits/req-1')).toBe(false)
    expect(canAccessPath(['claims'], '/requests')).toBe(false)
    expect(canAccessPath(['sales'], '/requests/ir-1')).toBe(true)
    expect(canAccessPath(['information_manager'], '/requests')).toBe(false)
    expect(canAccessPath(['information_manager'], '/entities/abc')).toBe(true)
    expect(canAccessPath(['information_manager'], '/policies')).toBe(false)
    expect(canAccessPath(['sales'], '/admin')).toBe(false)
    expect(canAccessPath(['admin'], '/admin')).toBe(true)
  })

  it('denies everything to a user with no roles', () => {
    expect(canAccessPath([], '/')).toBe(false)
    expect(canAccessPath([], '/entities')).toBe(false)
  })

  it('leaves unguarded paths (404, redirects) alone', () => {
    expect(canAccessPath(['claims'], '/no-access')).toBe(true)
    expect(canAccessPath(['claims'], '/something-else')).toBe(true)
  })
})
