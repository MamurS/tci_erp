/** Routes a session that does not meet the MFA policy to where it can:
 * the verify page when a factor exists (step-up), the account page when the
 * policy demands a factor the person has not enrolled yet.
 *
 * Sits inside RequirePasswordChange: rotate the temporary password first,
 * then the second factor. The database closed the gates already
 * (tci.mfa_satisfied inside has_role/is_staff); this only points the way.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { decideMfaRoute } from './mfaGate'
import { isPortalUser } from '../features/portal/navigation'

export function RequireMfa() {
  const { authStatus, roles } = useAuth()
  const location = useLocation()

  const decision = decideMfaRoute(authStatus, location.pathname, isPortalUser(roles))
  if (decision.kind !== 'pass') {
    return <Navigate to={decision.to} replace state={{ from: location }} />
  }
  return <Outlet />
}
