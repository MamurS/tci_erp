/** Which submissions a draft contract can be generated for: every one that
 *  is still alive. A draft has no terms yet, and a declined or withdrawn one
 *  will never become a contract. */

import type { InsuranceRequestStatus } from '../requests/types'

export const NO_CONTRACT_STATUSES: readonly InsuranceRequestStatus[] = ['draft', 'declined', 'withdrawn']

export function contractSubmissions<T extends { status: InsuranceRequestStatus }>(requests: readonly T[]): T[] {
  return requests.filter((r) => !NO_CONTRACT_STATUSES.includes(r.status))
}
