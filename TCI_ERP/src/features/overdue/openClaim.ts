/** Opening a claim from an overdue notification, on the staff side — the
 * rules tci.open_claim (migration 0043) and the claims unique indexes
 * (migration 0032) enforce, restated so the NOA page offers the button only
 * where the database would accept it. The database still decides; a refusal
 * that slips past this mirror is shown as a mapped message, never raw text.
 */

import { refusalKey } from '../../lib/refusals'
import { hasRole } from '../../lib/roles'
import type { UserRole } from '../../lib/roles'
import { claimErrorKey } from '../claims/errors'
import type { ClaimStatus } from '../claims/types'
import type { NoaStatus } from './types'

/** Staff who may open a claim on the policyholder's behalf:
 * `tci.has_role('claims', 'sales')`. (The client's own path is the
 * portal's `client_open_claim`.) */
export const OPEN_CLAIM_ROLES = ['claims', 'sales'] as const satisfies readonly UserRole[]

/** A claim in one of these no longer holds the (policy, buyer) slot:
 * `claims_live_uq … where status not in ('declined', 'closed', 'withdrawn')`. */
export const SETTLED_CLAIM_STATUSES = ['declined', 'closed', 'withdrawn'] as const satisfies readonly ClaimStatus[]

interface NoaFacts {
  id: string
  policy_id: string
  buyer_entity_id: string
  status: NoaStatus
}

interface ClaimFacts {
  id: string
  policy_id: string
  buyer_entity_id: string
  overdue_notification_id: string | null
  status: ClaimStatus
}

/** The claim that already occupies what a new one would need: a live claim
 * on the same policy and buyer (`claims_live_uq`), or any claim but a
 * withdrawn one raised from this very notification (`claims_noa_uq`). */
export function blockingClaim<C extends ClaimFacts>(noa: NoaFacts, claims: readonly C[]): C | null {
  return (
    claims.find(
      (c) =>
        (c.policy_id === noa.policy_id &&
          c.buyer_entity_id === noa.buyer_entity_id &&
          !(SETTLED_CLAIM_STATUSES as readonly ClaimStatus[]).includes(c.status)) ||
        (c.overdue_notification_id === noa.id && c.status !== 'withdrawn'),
    ) ?? null
  )
}

/** Offer «Open a claim» on this notification? Only while it is open — a
 * resolved or withdrawn NOA is a debt that was paid or never was — and only
 * when no claim already holds its place. The waiting period is NOT a reason
 * to hide it: the database lets a draft be opened at once and refuses only
 * the FILING before the period has run (`claims.blocker.waitingPeriod`), and
 * insolvency waives the period altogether. */
export function mayOpenClaimFromNoa(
  roles: readonly UserRole[],
  noa: NoaFacts,
  claims: readonly ClaimFacts[],
): boolean {
  return hasRole(roles, ...OPEN_CLAIM_ROLES) && noa.status === 'open' && blockingClaim(noa, claims) === null
}

/** The readable message for a refused `open_claim`: the claims catalogue
 * first (an occupied slot, a draft policy), then the SQLSTATE fallbacks. */
export function openClaimErrorKey(error: unknown): string {
  return claimErrorKey(error) ?? refusalKey(error)
}
