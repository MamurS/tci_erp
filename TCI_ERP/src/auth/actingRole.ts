/**
 * The acting role (migration 0063): a person who holds several roles acts in
 * exactly one at a time — the role of the active workspace — and the database
 * answers every gate for that role only. The server keeps it per sign-in
 * session (tci.set_acting_role); this module only decides which role the
 * screen asks for when a session starts.
 */

import { isUserRole } from '../lib/roles'
import type { UserRole } from '../lib/roles'
import { canAccessPath } from '../components/layout/navigation'
import { initialActingRole } from '../components/layout/workspaces'

/** Tabs of one browser share the sign-in session, and with it the acting
 * role: a switch in one tab is announced to the others under this key. */
export const ACTING_ROLE_KEY = 'tci-erp-acting-role'

export interface ActingRoleChoice {
  /** The role the screen acts in. */
  role: UserRole | null
  /** True when the server must be told (it holds another role, or none,
   * for a person with several roles). */
  mustSet: boolean
}

/**
 * The server's acting role wins while it is still held; otherwise the
 * remembered workspace's role, the first workspace's, or the only role. A
 * person with ONE role never sets anything — the server acts in it already.
 */
export function chooseActingRole(
  heldRoles: readonly UserRole[],
  serverRole: unknown,
  storedWorkspace: string | null | undefined,
): ActingRoleChoice {
  if (heldRoles.length === 0) return { role: null, mustSet: false }
  if (isUserRole(serverRole) && heldRoles.includes(serverRole)) return { role: serverRole, mustSet: false }
  if (heldRoles.length === 1) return { role: heldRoles[0], mustSet: false }
  const role = initialActingRole(heldRoles, storedWorkspace)
  return { role, mustSet: role !== null }
}

/** The other roles a person holds that open `pathname` — what the «no
 * access» page offers to switch to (a link from the Agenda, or from a
 * colleague, may lead to a section of another workspace). */
export function rolesOpening(
  heldRoles: readonly UserRole[],
  actingRole: UserRole | null,
  pathname: string,
): UserRole[] {
  return heldRoles.filter((role) => role !== actingRole && canAccessPath([role], pathname))
}
