/**
 * Who may register or edit a company — mirrors the "legal_entities: staff
 * write" policy (since 0065 without admin: admin is a technical role). The UI
 * only uses it to decide whether to OFFER the form; the policy is what
 * refuses.
 */

import { hasCapability } from '../../lib/creditAnalysis'
import type { CreditAnalysisMode } from '../../lib/creditAnalysis'
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

/** Who records a rating: the "credit_assessments: credit write" policy asks
 * tci.has_capability('rate') since 0069 — credit analysts, and credit
 * underwriting in combined mode. Anyone on staff may still read it and print
 * the report. */
export function mayRate(roles: readonly UserRole[], mode: CreditAnalysisMode): boolean {
  return hasCapability(roles, mode, 'rate')
}

/** Who confirms the engine's grade (tci.confirm_rating), never the one who
 * calculated it (four eyes, 0069). */
export function mayConfirmRating(
  roles: readonly UserRole[],
  mode: CreditAnalysisMode,
  rating: { created_by: string | null; confirmed_at: string | null } | null,
  userId: string | null | undefined,
): boolean {
  if (!rating || rating.confirmed_at || !userId) return false
  return hasCapability(roles, mode, 'confirm_rating') && rating.created_by !== userId
}
