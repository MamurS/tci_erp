/**
 * Which tour belongs to which role, and the one way to start a tour from
 * anywhere. Pure (no React): the e2e stub imports the ids from here.
 */

import type { UserRole } from '../../lib/roles'
import type { ReleaseTour, Tour } from './types'
import { ADMIN_TOUR } from './steps/admin'
import { CLAIMS_TOUR } from './steps/claims'
import { COMMERCIAL_UNDERWRITER_TOUR } from './steps/commercialUnderwriter'
import { CREDIT_ANALYST_TOUR } from './steps/creditAnalyst'
import { CREDIT_UNDERWRITER_TOUR } from './steps/creditUnderwriter'
import { INFORMATION_MANAGER_TOUR } from './steps/informationManager'
import { PORTAL_TOUR } from './steps/portal'
import { RELEASE_TOURS } from './steps/releases'
import { SALES_TOUR } from './steps/sales'

/** The tour of each role — the one shown is the ACTING role's (0063). */
export const ROLE_TOURS: Readonly<Record<UserRole, Tour>> = {
  admin: ADMIN_TOUR,
  sales: SALES_TOUR,
  commercial_underwriter: COMMERCIAL_UNDERWRITER_TOUR,
  credit_underwriter: CREDIT_UNDERWRITER_TOUR,
  credit_analyst: CREDIT_ANALYST_TOUR,
  claims: CLAIMS_TOUR,
  information_manager: INFORMATION_MANAGER_TOUR,
  client: PORTAL_TOUR,
}

export { RELEASE_TOURS }

export function tourForRole(role: UserRole | null): Tour | null {
  return role ? ROLE_TOURS[role] : null
}

/** Every tour id, role tours first. */
export const ALL_TOUR_IDS: readonly string[] = [
  ...Object.values(ROLE_TOURS).map((t) => t.id),
  ...RELEASE_TOURS.map((t) => t.id),
]

export function tourById(id: string): Tour | ReleaseTour | null {
  return Object.values(ROLE_TOURS).find((t) => t.id === id) ?? RELEASE_TOURS.find((t) => t.id === id) ?? null
}

/**
 * The window event that starts a tour (the Help page, the user menu, the
 * portal profile dispatch it). `detail.tour` names a tour id, or 'release'
 * for the latest «What's new»; without it, the acting role's tour.
 */
export const TOUR_START_EVENT = 'tci:tour:start'

export interface TourStartDetail {
  tour?: string
}

export function startTour(detail: TourStartDetail = {}): void {
  window.dispatchEvent(new CustomEvent<TourStartDetail>(TOUR_START_EVENT, { detail }))
}
