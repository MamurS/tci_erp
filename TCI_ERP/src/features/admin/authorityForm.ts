/** Authority grant validation — pure module, mirrors the DB constraints
 * of tci.authority_grants (max_amount > 0, valid_to >= valid_from). */

import type { AuthorityGrant } from '../limits/types'

export type GrantProblem = 'amountPositive' | 'periodOrder' | 'validFromRequired'

export function validateGrant(input: {
  maxAmount: number
  validFrom: string
  validTo: string | null
}): GrantProblem | null {
  if (!input.validFrom) return 'validFromRequired'
  if (!Number.isFinite(input.maxAmount) || input.maxAmount <= 0) return 'amountPositive'
  if (input.validTo && input.validTo < input.validFrom) return 'periodOrder'
  return null
}

/** A grant currently in force (mirrors the my_authority_uzs date filter). */
export function grantIsCurrent(
  grant: Pick<AuthorityGrant, 'valid_from' | 'valid_to'>,
  todayIso: string,
): boolean {
  if (grant.valid_from > todayIso) return false
  if (grant.valid_to !== null && grant.valid_to < todayIso) return false
  return true
}
