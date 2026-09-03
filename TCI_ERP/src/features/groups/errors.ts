/** The group refusals, mapped to readable messages.
 *
 * Same rule as everywhere else (DESIGN.md): a refusal the database makes on
 * purpose names what was refused and why. A contract test asserts every
 * fragment still exists in migrations 0038-0040, so rewording an exception
 * fails the build instead of silently falling back to "something went wrong".
 */

export const GROUP_REFUSALS: readonly { fragment: string; key: string }[] = [
  { fragment: 'not permitted to record corporate relationships', key: 'groups.errors.notPermitted' },
  { fragment: 'a company cannot be related to itself', key: 'groups.errors.selfReference' },
  {
    fragment: 'an ownership percentage only means something on an ownership relationship',
    key: 'groups.errors.pctOnlyOnOwnership',
  },
  { fragment: 'relationship not found', key: 'groups.errors.relationshipNotFound' },
  { fragment: 'company not found', key: 'groups.errors.entityNotFound' },
  { fragment: 'only credit underwriting may set a group limit', key: 'groups.errors.limitNotPermitted' },
  { fragment: 'only credit underwriting may remove a group limit', key: 'groups.errors.limitNotPermitted' },
  { fragment: 'a group limit needs a positive amount', key: 'groups.errors.limitAmount' },
  { fragment: 'exceeds your authority for grade band', key: 'groups.errors.limitAuthority' },
  { fragment: 'this group has no limit in force', key: 'groups.errors.noLimitInForce' },
  { fragment: 'suggestion not found', key: 'groups.errors.suggestionNotFound' },
  { fragment: 'this suggestion is already', key: 'groups.errors.suggestionReviewed' },
  {
    fragment: 'the parent must be one of the two suggested companies',
    key: 'groups.errors.suggestionParent',
  },
  // The commercial stage refuses outright rather than escalating: there is no
  // "escalated" state for an adjustment.
  { fragment: 'this adjustment would take the group to', key: 'groups.errors.adjustmentOverLimit' },
  // Not a raise: the partial unique index is the only stable thing in the
  // message Postgres produces for a duplicate live edge.
  { fragment: 'entity_relationships_live_uq', key: 'groups.errors.duplicateEdge' },
]

/** The i18n key for a group refusal, or null when this is not a rule we
 * recognise — in which case the caller shows the generic message. */
export function groupErrorKey(error: unknown): string | null {
  const message = (error as { message?: string } | null)?.message
  if (!message) return null
  const lower = message.toLowerCase()
  const hit = GROUP_REFUSALS.find((r) => lower.includes(r.fragment.toLowerCase()))
  return hit ? hit.key : null
}
