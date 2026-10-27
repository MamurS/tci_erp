/** The workspaces group the screens; they never take one away. */

import { describe, expect, it } from 'vitest'

import type { UserRole } from '../../lib/roles'
import { NAV_ITEMS, navItemsForRoles } from './navigation'
import {
  COMMON_ITEMS,
  WORKSPACES,
  availableWorkspaces,
  initialActingRole,
  workspaceForRole,
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
  'credit_analyst',
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

  it('shows only the workspaces of the roles held — admin included, no longer all of them (0063)', () => {
    expect(availableWorkspaces(['commercial_underwriter']).map((w) => w.key)).toEqual(['commercial'])
    expect(availableWorkspaces(['credit_underwriter', 'sales']).map((w) => w.key)).toEqual(['credit', 'sales'])
    expect(availableWorkspaces(['admin']).map((w) => w.key)).toEqual(['admin'])
    expect(availableWorkspaces(['information_manager']).map((w) => w.key)).toEqual(['data'])
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
    expect(workspaceHome(['information_manager'], byKey.data)).toBe('/data')
    expect(workspaceHome(['credit_analyst'], byKey.analysis)).toBe('/limits')
    expect(workspaceNav(['credit_analyst'], byKey.analysis).own.map((i) => i.key)).toEqual(['limits', 'sectors'])
    expect(workspaceNav(['credit_underwriter'], byKey.credit).own.map((i) => i.key)).toContain('sectors')
  })

  it('each workspace is exactly one role to act in', () => {
    const roles = WORKSPACES.map((w) => w.role)
    expect(new Set(roles).size).toBe(roles.length)
    for (const w of WORKSPACES) expect(workspaceForRole(w.role)).toBe(w)
    expect(workspaceForRole('client')).toBeNull()
    expect(workspaceForRole(null)).toBeNull()
  })

  it('starts a session in the remembered workspace while its role is held', () => {
    const owner: UserRole[] = ['admin', 'sales', 'commercial_underwriter', 'credit_underwriter']
    expect(initialActingRole(owner, 'credit')).toBe('credit_underwriter')
    expect(initialActingRole(owner, 'admin')).toBe('admin')
    // remembered but not held: the first workspace in display order
    expect(initialActingRole(['sales', 'credit_underwriter'], 'claims')).toBe('credit_underwriter')
    expect(initialActingRole(['sales', 'credit_underwriter'], null)).toBe('credit_underwriter')
    // no workspace at all: the only role (a client), or none
    expect(initialActingRole(['client'], null)).toBe('client')
    expect(initialActingRole([], null)).toBeNull()
  })
})
