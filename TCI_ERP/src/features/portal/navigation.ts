/**
 * Where a signed-in user belongs, and what the portal's own navigation is.
 *
 * Pure module: App.tsx and the guards both read it, and it is the single
 * place that answers "is this person a client or staff?".
 */

import { hasRole, isStaff } from '../../lib/roles'
import type { UserRole } from '../../lib/roles'

export interface PortalNavItem {
  /** i18n key under "portal.nav." */
  key: string
  path: string
}

/**
 * Deliberately short. The portal is not a smaller copy of the staff app: a
 * policyholder has four things to look at and one thing to do.
 */
export const PORTAL_NAV_ITEMS: readonly PortalNavItem[] = [
  { key: 'policies', path: '/portal' },
  { key: 'limits', path: '/portal/limits' },
  // Phase 4: the policyholder declares, pays and reports overdue accounts.
  { key: 'declarations', path: '/portal/declarations' },
  { key: 'premium', path: '/portal/premium' },
  { key: 'overdues', path: '/portal/overdues' },
  { key: 'submissions', path: '/portal/submissions' },
  { key: 'account', path: '/portal/account' },
]

/**
 * A portal user holds `client` and NO staff role.
 *
 * The union rule matters here: the owner's own account holds every role
 * including `client`, and must land in the staff app. Someone whose only
 * role is `client` is the person the portal exists for. Anyone holding both
 * is staff who happens to be mapped to a company, and staff wins - the
 * portal views would return nothing for them anyway, because
 * tci.my_client_entities() is gated on the mapping, not on the role alone.
 */
export function isPortalUser(roles: readonly UserRole[]): boolean {
  return hasRole(roles, 'client') && !isStaff(roles)
}

/** Where this user's "/" is. */
export function landingPath(roles: readonly UserRole[]): string {
  return isPortalUser(roles) ? '/portal' : '/'
}

export function isPortalPath(pathname: string): boolean {
  return pathname === '/portal' || pathname.startsWith('/portal/')
}

/**
 * Both directions of the redirect, in one place.
 *
 * A portal user who types a staff URL is not shown "no access" - that reads
 * as a fault. They are simply sent to their own home, because from their
 * point of view the staff app does not exist.
 *
 * Staff who open /portal are sent back for the opposite reason: the portal
 * would render correctly and be entirely empty, which looks like data loss.
 *
 * Returns null when the user is already where they belong.
 */
export function redirectFor(
  roles: readonly UserRole[],
  pathname: string,
): string | null {
  // Unauthenticated or role-less users are handled upstream by
  // ProtectedRoute and the no-access page; nothing to say here.
  if (!roles.length) return null

  if (isPortalUser(roles)) {
    return isPortalPath(pathname) || isSharedPath(pathname) ? null : '/portal'
  }
  return isPortalPath(pathname) ? '/' : null
}

/**
 * Routes that belong to neither side: the forced password change, and the
 * pages the auth flow itself needs. A portal user must be able to reach
 * /change-password, which lives above the role split.
 */
function isSharedPath(pathname: string): boolean {
  return pathname === '/change-password' || pathname === '/no-access'
}
