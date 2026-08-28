/** Puts each signed-in user on their own side of the app.
 *
 * A client who types a staff URL is not shown "no access" — that reads as a
 * fault, and from their point of view the staff app does not exist. They are
 * sent to the portal. Staff who open /portal are sent back, because the
 * portal would render perfectly and be entirely empty for them (the
 * tci.v_client_* views are gated on the policyholder mapping), which looks
 * like data loss.
 *
 * This is convenience, not security: the database is what refuses. A client
 * who defeated this redirect would still read nothing from a staff screen. */

import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from './AuthContext'
import { redirectFor } from '../features/portal/navigation'

export function PortalRedirect() {
  const { roles, loading } = useAuth()
  const location = useLocation()

  // Roles arrive a tick after the session; redirecting on an empty array
  // would bounce every user to the staff app for a frame.
  if (loading) return null

  const target = redirectFor(roles, location.pathname)
  if (target) return <Navigate to={target} replace />
  return <Outlet />
}
