/**
 * Who may enter a financial statement — mirrors the
 * "financial_statements: data write" policy (0016, restated by 0065 and 0069). The UI only
 * uses it to decide whether to OFFER the entry form; the policy is what
 * refuses.
 */

import { hasRole } from '../../../lib/roles'
import type { UserRole } from '../../../lib/roles'

export const STATEMENT_WRITERS = [
  'information_manager',
  'credit_underwriter',
  // 0069: the credit analyst enters what they analyse
  'credit_analyst',
] as const satisfies readonly UserRole[]

export function mayEnterStatements(roles: readonly UserRole[]): boolean {
  return hasRole(roles, ...STATEMENT_WRITERS)
}
