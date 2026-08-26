import type { UserRole } from '../../lib/roles'

export interface NavItem {
  /** i18n key under "nav." */
  key: string
  path: string
  /** Roles allowed to see this item. */
  roles: readonly UserRole[]
}

const STAFF: readonly UserRole[] = ['admin', 'senior_underwriter', 'underwriter']

/**
 * Sidebar navigation, filtered by role.
 * Policyholders see only Policies / Credit Limits / Declarations (future portal scope).
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'dashboard', path: '/', roles: STAFF },
  { key: 'entities', path: '/entities', roles: STAFF },
  { key: 'limits', path: '/limits', roles: [...STAFF, 'policyholder'] },
  { key: 'policies', path: '/policies', roles: [...STAFF, 'policyholder'] },
  { key: 'declarations', path: '/declarations', roles: [...STAFF, 'policyholder'] },
  { key: 'claims', path: '/claims', roles: STAFF },
  { key: 'admin', path: '/admin', roles: ['admin'] },
]

export function navItemsForRole(role: UserRole | null): readonly NavItem[] {
  if (!role) return []
  return NAV_ITEMS.filter((item) => item.roles.includes(role))
}
