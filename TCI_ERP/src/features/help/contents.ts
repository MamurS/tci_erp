/**
 * The Help centre's contents, ordered for the reader (pure, tested):
 * the sections written for the acting role first, then those for every staff
 * role (getting started, glossary, FAQ), then the other roles' sections and
 * the portal's. A client sees the portal's sections only.
 */
import { STAFF_ROLES } from '../../lib/roles'
import { helpVisibleTo } from './pages'
import type { HelpSection } from './types'

export interface OrderedSections {
  mine: HelpSection[]
  shared: HelpSection[]
  other: HelpSection[]
}

export function orderSections(sections: readonly HelpSection[], role: string | null): OrderedSections {
  const readable = sections.filter((s) => helpVisibleTo(s.roles, role))
  const mine = readable.filter((s) => role !== null && s.roles.includes(role))
  const shared = readable.filter((s) => !mine.includes(s) && s.roles.includes('all'))
  // staff may read the other departments' sections (and the portal's) too
  const other = readable.filter((s) => !mine.includes(s) && !shared.includes(s))
  return { mine, shared, other }
}

/** The roles whose quick-start PDF the Help home offers: the reader's own
 * first; staff see every staff role's, a client only the portal's. */
export function quickStartRoles(role: string | null): string[] {
  if (role === 'client') return ['client']
  const staff = STAFF_ROLES as readonly string[]
  return role && staff.includes(role) ? [role, ...staff.filter((r) => r !== role)] : [...staff]
}
