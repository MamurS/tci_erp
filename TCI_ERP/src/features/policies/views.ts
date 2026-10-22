/**
 * The views of the «Полисы» section and their ?view= values. The portfolio
 * overview and the bank-statement payments are commercial underwriting's own
 * (and admin's: tci.bank_statement_* is theirs alone); everyone else who may
 * open /policies gets the registry, the contracts and the templates.
 */

import { hasRole } from '../../lib/roles'
import type { UserRole } from '../../lib/roles'

export const POLICY_VIEWS = ['overview', 'registry', 'payments', 'contracts', 'templates'] as const
export type PolicyView = (typeof POLICY_VIEWS)[number]

/** The views only the commercial desk sees. */
const COMMERCIAL_DESK_VIEWS: readonly PolicyView[] = ['overview', 'payments']

/** Commercial underwriting and admin see the portfolio overview and payments. */
export function isCommercialDesk(roles: readonly UserRole[]): boolean {
  return hasRole(roles, 'admin', 'commercial_underwriter')
}

export function policyViewsFor(roles: readonly UserRole[]): readonly PolicyView[] {
  return isCommercialDesk(roles) ? POLICY_VIEWS : POLICY_VIEWS.filter((v) => !COMMERCIAL_DESK_VIEWS.includes(v))
}

/** A known view the roles may see, otherwise the first one: the overview for
 * the commercial desk, the registry for everyone else. */
export function parsePolicyView(value: string | null | undefined, roles: readonly UserRole[]): PolicyView {
  const available = policyViewsFor(roles)
  return (available as readonly string[]).includes(value ?? '') ? (value as PolicyView) : available[0]
}

/** Where the old addresses now live. */
export const LEGACY_POLICY_VIEW_PATHS: Record<string, string> = {
  '/contracts': '/policies?view=contracts',
  '/wording': '/policies?view=templates',
  '/portfolio/policies': '/policies?view=overview',
}
