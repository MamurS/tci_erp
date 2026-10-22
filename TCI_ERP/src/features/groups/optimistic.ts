/** What a relationship write is certain to change, painted before the
 * answer. The edge's own fields are exactly what was typed; whether the
 * GROUP changes (members, exposure, the ultimate parent) is the database's
 * walk, so those screens refetch rather than guess. */

import type { EntityRelationship, RelationshipType } from './types'

export interface EdgeEdit {
  relationshipType: RelationshipType
  ownershipPct?: number | null
  validFrom?: string | null
  validTo?: string | null
  sourceNote?: string | null
}

export function edgeEdited(edge: EntityRelationship, edit: EdgeEdit): EntityRelationship {
  return {
    ...edge,
    relationship_type: edit.relationshipType,
    ownership_pct: edit.ownershipPct ?? null,
    valid_from: edit.validFrom ?? edge.valid_from,
    valid_to: edit.validTo ?? null,
    source_note: edit.sourceNote ?? null,
  }
}

/** Ended on `validTo` (default today — `valid_to` is inclusive, 0038): it
 * stays live through that day and no further. */
export function edgeEnded(edge: EntityRelationship, validTo: string | null | undefined, today: string): EntityRelationship {
  const end = validTo ?? today
  return { ...edge, valid_to: end, is_live: edge.is_live && end >= today }
}
