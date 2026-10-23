/**
 * Who may register or edit a company — mirrors the "legal_entities: staff
 * write" policy (since 0065 without admin: admin is a technical role). The UI
 * only uses it to decide whether to OFFER the form; the policy is what
 * refuses.
 */

import { hasRole } from '../../lib/roles'
import type { UserRole } from '../../lib/roles'

export const ENTITY_WRITERS = [
  'sales',
  'information_manager',
  'credit_underwriter',
  'commercial_underwriter',
] as const satisfies readonly UserRole[]

export function mayWriteEntities(roles: readonly UserRole[]): boolean {
  return hasRole(roles, ...ENTITY_WRITERS)
}

/** Who records a rating: the "credit_assessments: credit write" policy —
 * credit underwriting only since 0065. Anyone on staff may still read it and
 * print the report. */
export const RATING_WRITERS = ['credit_underwriter'] as const satisfies readonly UserRole[]

export function mayRate(roles: readonly UserRole[]): boolean {
  return hasRole(roles, ...RATING_WRITERS)
}
