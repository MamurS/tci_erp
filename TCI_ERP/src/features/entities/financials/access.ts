/**
 * Who may enter a financial statement — mirrors the
 * "financial_statements: data write" policy of migration 0016. The UI only
 * uses it to decide whether to OFFER the entry form; the policy is what
 * refuses.
 */

import { hasRole } from '../../../lib/roles'
import type { UserRole } from '../../../lib/roles'

export const STATEMENT_WRITERS = ['information_manager', 'credit_underwriter'] as const satisfies readonly UserRole[]

export function mayEnterStatements(roles: readonly UserRole[]): boolean {
  return hasRole(roles, ...STATEMENT_WRITERS)
}
