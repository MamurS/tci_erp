/**
 * Who may provision whom, in the UI — the exact mirror of
 * app/provisioning_rules.py in the analytics service (authorize_create /
 * authorize_manage / authorize_admin_only).
 *
 * The service is the enforcing side; this module only decides what the
 * screens offer, so that a 403 is a bug rather than a routine outcome.
 */

import { hasRole } from '../../lib/roles'
import type { UserRole } from '../../lib/roles'

/** Roles that may provision anyone, with any role set. */
export const ADMIN_ROLES: readonly UserRole[] = ['admin']

/** Roles that may provision CLIENT users only (owner decision). */
export const CLIENT_PROVISIONER_ROLES: readonly UserRole[] = ['sales', 'commercial_underwriter']

/** May these roles reach a provisioning surface at all? */
export function canProvision(roles: readonly UserRole[]): boolean {
  return hasRole(roles, ...ADMIN_ROLES, ...CLIENT_PROVISIONER_ROLES)
}

/** May they choose the role set freely, or only create client users?
 * Anyone who is not an admin and can provision at all is client-only. */
export function canProvisionAnyRole(roles: readonly UserRole[]): boolean {
  return hasRole(roles, ...ADMIN_ROLES)
}

export function isClientOnlyProvisioner(roles: readonly UserRole[]): boolean {
  return canProvision(roles) && !canProvisionAnyRole(roles)
}

/** Mirror of authorize_create: may this caller create a user holding
 * exactly `requestedRoles`? */
export function canCreateWithRoles(
  callerRoles: readonly UserRole[],
  requestedRoles: readonly UserRole[],
): boolean {
  if (requestedRoles.length === 0) return false
  if (canProvisionAnyRole(callerRoles)) return true
  if (!canProvision(callerRoles)) return false
  return requestedRoles.length === 1 && requestedRoles[0] === 'client'
}

/** Mirror of authorize_manage: may this caller reset the password of a user
 * holding `targetRoles`? */
export function canManageUser(
  callerRoles: readonly UserRole[],
  targetRoles: readonly UserRole[],
): boolean {
  if (canProvisionAnyRole(callerRoles)) return true
  if (!canProvision(callerRoles)) return false
  // A client who also holds a staff role is out of reach: resetting them
  // would hand out a staff account's password.
  return targetRoles.length === 1 && targetRoles[0] === 'client'
}

/** Mirror of authorize_admin_only: disable/enable are administrative. */
export function canDisableUser(
  callerRoles: readonly UserRole[],
  targetUserId: string,
  callerUserId: string | undefined,
): boolean {
  if (!hasRole(callerRoles, ...ADMIN_ROLES)) return false
  // The service refuses this too; not offering it avoids a dead button.
  return targetUserId !== callerUserId
}

/** Does the «Client access» section belong on this company card?
 * Only for staff who can provision, and only once the company is one we
 * would give a portal login to. */
export function showClientAccess(
  callerRoles: readonly UserRole[],
  entity: { isPolicyholder: boolean; hasOwnSubmission: boolean },
): boolean {
  if (!canProvision(callerRoles)) return false
  return entity.isPolicyholder || entity.hasOwnSubmission
}
