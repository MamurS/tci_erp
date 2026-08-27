/**
 * Issuing the policy an accepted submission agreed to — pure module mirroring
 * tci.bind_insurance_request (migration 0023) and the policy CHECK
 * constraints of migration 0012.
 *
 * The database is what enforces; this exists so the modal can name the
 * problem before the round trip, and so a button is never offered for a
 * refusal we already know about.
 */

import { hasRole } from '../../lib/roles'
import type { UserRole } from '../../lib/roles'
import type { InsuranceRequest } from './types'

/** Terms tci.bind_insurance_request requires before it will project a policy.
 * Same list, same order as the v_missing array in the SQL function. */
export const REQUIRED_TERMS = [
  'product_structure',
  'currency_code',
  'insured_percentage',
  'nql_amount',
  'premium_rate_pct',
  'minimum_premium',
  'discretionary_limit',
  'waiting_period_days',
  'max_extension_period_days',
  'max_payment_terms_days',
  'declaration_frequency',
] as const

export type RequiredTerm = (typeof REQUIRED_TERMS)[number]

/** Mirrors the function's role gate. */
export function canBindAs(roles: readonly UserRole[]): boolean {
  return hasRole(roles, 'admin', 'commercial_underwriter')
}

/** Mirrors the status + idempotency guards. */
export function bindBlocker(
  request: Pick<InsuranceRequest, 'status' | 'bound_policy_id'>,
): 'alreadyBound' | 'notAccepted' | null {
  if (request.bound_policy_id) return 'alreadyBound'
  if (request.status !== 'accepted') return 'notAccepted'
  return null
}

/** The terms the submission still lacks — same check the function raises on,
 * so the modal can list them instead of surfacing a bare refusal. */
export function missingTerms(request: Partial<InsuranceRequest>): RequiredTerm[] {
  return REQUIRED_TERMS.filter((term) => request[term] === null || request[term] === undefined)
}

export interface BindFormValues {
  policy_number: string
  inception_date: string
  expiry_date: string
}

/** field -> i18n key under requests.bind.validation. Blocking, all of them:
 * each mirrors a refusal in the SQL function or a policies CHECK. */
export function validateBind(values: BindFormValues): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!values.policy_number.trim()) errors.policy_number = 'required'
  if (!values.inception_date) errors.inception_date = 'required'
  if (!values.expiry_date) errors.expiry_date = 'required'
  // CHECK policies_period, restated by the function's own expiry guard.
  if (
    values.inception_date &&
    values.expiry_date &&
    values.expiry_date <= values.inception_date
  ) {
    errors.expiry_date = 'periodOrder'
  }
  return errors
}

/** A sensible default cover year: today to today + 1 year, minus a day so the
 * period is a year inclusive rather than a year and a day. */
export function defaultBindDates(today: Date): { inception_date: string; expiry_date: string } {
  const inception = today.toISOString().slice(0, 10)
  const expiry = new Date(
    Date.UTC(today.getUTCFullYear() + 1, today.getUTCMonth(), today.getUTCDate() - 1),
  )
  return { inception_date: inception, expiry_date: expiry.toISOString().slice(0, 10) }
}
