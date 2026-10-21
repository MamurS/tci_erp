/** The workspaces group the screens; they never take one away. */

import { describe, expect, it } from 'vitest'

import type { UserRole } from '../../lib/roles'
import { NAV_ITEMS, navItemsForRoles } from './navigation'
import {
  COMMON_ITEMS,
  WORKSPACES,
  availableWorkspaces,
  resolveWorkspace,
  workspaceHome,
  workspaceNav,
} from './workspaces'

const STAFF_ROLES: UserRole[] = [
  'admin',
  'sales',
  'commercial_underwriter',
  'credit_underwriter',
  'claims',
  'information_manager',
]

describe('workspaces', () => {
  it('every screen belongs to the common set or to a workspace, and nothing else', () => {
    const placed = new Set([...COMMON_ITEMS, ...WORKSPACES.flatMap((w) => w.items)])
    expect([...placed].sort()).toEqual(NAV_ITEMS.map((i) => i.key).sort())
  })

  it('a role can reach every screen it may open from its own workspaces', () => {
    for (const role of STAFF_ROLES) {
      const reachable = new Set(
        [null, ...availableWorkspaces([role])].flatMap((w) => {
          const nav = workspaceNav([role], w)
          return [...nav.common, ...nav.own].map((i) => i.key)
        }),
      )
      for (const item of navItemsForRoles([role])) expect(reachable, `${role} → ${item.key}`).toContain(item.key)
    }
  })

  it('shows only the workspaces of the roles held; admin gets all of them', () => {
    expect(availableWorkspaces(['commercial_underwriter']).map((w) => w.key)).toEqual(['commercial'])
    expect(availableWorkspaces(['credit_underwriter', 'sales']).map((w) => w.key)).toEqual(['credit', 'sales'])
    expect(availableWorkspaces(['admin']).map((w) => w.key)).toEqual(WORKSPACES.map((w) => w.key))
    expect(availableWorkspaces(['information_manager'])).toEqual([])
    expect(availableWorkspaces(['client'])).toEqual([])
  })

  it('lists the shared tools first and only what the roles may open', () => {
    const commercial = WORKSPACES.find((w) => w.key === 'commercial')!
    const nav = workspaceNav(['commercial_underwriter'], commercial)
    expect(nav.common.map((i) => i.key)).toEqual(['dashboard', 'agenda', 'entities'])
    expect(nav.own.map((i) => i.key)).toContain('policies')
    // a credit underwriter opening the commercial workspace still sees only what they may open
    expect(workspaceNav(['credit_underwriter'], commercial).own.map((i) => i.key)).not.toContain('policies')
  })

  it('lands each workspace on its own first tool', () => {
    const byKey = Object.fromEntries(WORKSPACES.map((w) => [w.key, w]))
    expect(workspaceHome(['admin'], byKey.commercial)).toBe('/policies')
    expect(workspaceHome(['admin'], byKey.credit)).toBe('/limits')
    expect(workspaceHome(['sales'], byKey.sales)).toBe('/requests')
    expect(workspaceHome(['admin'], byKey.admin)).toBe('/admin')
  })

  it('keeps the remembered workspace while it contains the page', () => {
    const all: UserRole[] = ['admin']
    expect(resolveWorkspace(all, 'credit', '/limits/abc')).toBe('credit')
    expect(resolveWorkspace(all, 'sales', '/limits')).toBe('sales')
    // shared tools never move you
    expect(resolveWorkspace(all, 'claims', '/entities/e1')).toBe('claims')
    expect(resolveWorkspace(all, 'claims', '/')).toBe('claims')
  })

  it('moves to a workspace that contains a page opened from elsewhere', () => {
    expect(resolveWorkspace(['admin'], 'claims', '/policies/p1')).toBe('commercial')
    expect(resolveWorkspace(['admin'], 'admin', '/limits/r1')).toBe('commercial')
    expect(resolveWorkspace(['credit_underwriter', 'sales'], 'credit', '/policies/p1')).toBe('sales')
  })

  it('falls back to the first available workspace and to none without one', () => {
    expect(resolveWorkspace(['sales', 'credit_underwriter'], null, '/')).toBe('credit')
    expect(resolveWorkspace(['sales'], 'admin', '/')).toBe('sales')
    expect(resolveWorkspace(['information_manager'], null, '/entities')).toBeNull()
  })
})
