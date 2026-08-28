import type { UserRole } from '../../lib/roles'

export interface NavItem {
  /** i18n key under "nav." */
  key: string
  path: string
  /** Roles allowed to see this item (ANY match grants access). */
  roles: readonly UserRole[]
}

const STAFF: readonly UserRole[] = [
  'admin',
  'sales',
  'commercial_underwriter',
  'credit_underwriter',
  'claims',
  'information_manager',
]

/**
 * Sidebar navigation and route guards, by department role (Phase 3b).
 * A user may hold several roles - ANY matching role grants the item.
 *
 * Every staff role also gets the Agenda; the client does not (it is the
 * INTERNAL queue, and tci.refresh_agenda() refuses a non-staff caller).
 *
 *   admin                   everything
 *   credit_underwriter      dashboard, agenda, companies, submissions, limits, declarations, claims
 *   commercial_underwriter  dashboard, companies, submissions, policies, limits, declarations, claims
 *   sales                   dashboard, companies, submissions, policies, limits
 *   information_manager     dashboard, companies
 *   claims                  dashboard, companies, claims
 *   client                  portal reads only (no new screens until Phase 3d)
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: 'dashboard', path: '/', roles: STAFF },
  // The Agenda is staff-only: tci.refresh_agenda() refuses a client outright.
  { key: 'agenda', path: '/agenda', roles: STAFF },
  { key: 'entities', path: '/entities', roles: STAFF },
  {
    key: 'requests',
    path: '/requests',
    roles: ['admin', 'sales', 'commercial_underwriter', 'credit_underwriter', 'client'],
  },
  {
    key: 'limits',
    path: '/limits',
    roles: ['admin', 'sales', 'commercial_underwriter', 'credit_underwriter', 'client'],
  },
  {
    key: 'policies',
    path: '/policies',
    roles: ['admin', 'sales', 'commercial_underwriter', 'client'],
  },
  {
    key: 'declarations',
    path: '/declarations',
    // sales too: the declaration-due tasks are addressed to them.
    roles: ['admin', 'sales', 'commercial_underwriter', 'credit_underwriter', 'client'],
  },
  {
    key: 'overdues',
    path: '/overdues',
    roles: ['admin', 'sales', 'commercial_underwriter', 'credit_underwriter', 'claims'],
  },
  {
    key: 'claims',
    path: '/claims',
    roles: ['admin', 'claims', 'commercial_underwriter', 'credit_underwriter'],
  },
  { key: 'admin', path: '/admin', roles: ['admin'] },
]

export function navItemsForRoles(roles: readonly UserRole[]): readonly NavItem[] {
  if (!roles.length) return []
  return NAV_ITEMS.filter((item) => item.roles.some((r) => roles.includes(r)))
}

/** Route guard: may these roles open this path? Sub-paths inherit their
 * section's rule (/entities/:id follows /entities). */
export function canAccessPath(roles: readonly UserRole[], pathname: string): boolean {
  if (!roles.length) return false
  const item = matchNavItem(pathname)
  if (!item) return true // not a guarded section (404 etc.)
  return item.roles.some((r) => roles.includes(r))
}

/** The nav item owning a path: longest matching path wins ('/' only exact). */
export function matchNavItem(pathname: string): NavItem | null {
  if (pathname === '/') return NAV_ITEMS.find((i) => i.path === '/') ?? null
  return (
    [...NAV_ITEMS]
      .filter((i) => i.path !== '/')
      .sort((a, b) => b.path.length - a.path.length)
      .find((i) => pathname === i.path || pathname.startsWith(i.path + '/')) ?? null
  )
}
