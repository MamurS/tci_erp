/** Route guard: renders the section only when the signed-in user's roles
 * cover it (mirror of the sidebar map in navigation.ts). A forbidden
 * direct URL shows the styled "no access" page instead of crashing. */

import { Outlet, useLocation } from 'react-router-dom'

import { useAuth } from './AuthContext'
import { canAccessPath } from '../components/layout/navigation'
import { NoAccessPage } from '../pages/NoAccessPage'

export function RoleGuard() {
  const { roles } = useAuth()
  const location = useLocation()

  if (!canAccessPath(roles, location.pathname)) return <NoAccessPage />
  return <Outlet />
}
