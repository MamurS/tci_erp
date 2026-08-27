/** Blocks every route while the user still holds a temporary password.
 *
 * Sits inside ProtectedRoute (a session already exists) and outside the
 * role guard, so the rotation happens before anything else is reachable.
 * /change-password itself is mounted above this gate.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { PASSWORD_CHANGE_PATH, shouldForcePasswordChange } from './passwordGate'

export function RequirePasswordChange() {
  const { mustChangePassword } = useAuth()
  const location = useLocation()

  if (shouldForcePasswordChange(mustChangePassword, location.pathname)) {
    return <Navigate to={PASSWORD_CHANGE_PATH} replace />
  }
  return <Outlet />
}
