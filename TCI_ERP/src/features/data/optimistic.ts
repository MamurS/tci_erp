/** What a data-request write is certain to change (0054), painted before the
 * answer: taking it makes it the caller's and in progress; handing it over
 * makes it the other person's and new again; resolving closes it with its
 * typed outcome. */

import type { EntityRequest } from './types'

export function taken(request: EntityRequest, me: string, at: string): EntityRequest {
  return request.assigned_to === me
    ? { ...request, status: request.status === 'new' ? 'in_progress' : request.status }
    : { ...request, assigned_to: me, assigned_at: at, status: 'in_progress' }
}

export function assigned(request: EntityRequest, userId: string, at: string): EntityRequest {
  return request.assigned_to === userId ? request : { ...request, assigned_to: userId, assigned_at: at, status: 'new' }
}

export function resolved(
  request: EntityRequest,
  outcome: 'created' | 'linked' | 'updated' | 'rejected',
  entityId: string | null,
  note: string | null,
  me: string | null,
  at: string,
): EntityRequest {
  return {
    ...request,
    status: outcome,
    entity_id: outcome === 'updated' ? request.entity_id : (entityId ?? request.entity_id),
    resolution_note: note,
    resolved_by: me,
    resolved_at: at,
  }
}
