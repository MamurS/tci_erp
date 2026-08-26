/** Computed-roles rule — pure mirror of tci.v_entity_roles (migration 0015).
 * Roles are never stored: an entity is a policyholder because it has
 * policies, a buyer because it has limit requests. is_prospect is reserved
 * for Phase 3c ("has insurance_request but no policy"). */

import type { EntityRoles } from './types'

export function computeRoles(input: {
  entityId: string
  policiesCount: number
  limitRequestsCount: number
}): EntityRoles {
  return {
    entity_id: input.entityId,
    is_policyholder: input.policiesCount > 0,
    is_buyer: input.limitRequestsCount > 0,
    is_prospect: false,
  }
}
