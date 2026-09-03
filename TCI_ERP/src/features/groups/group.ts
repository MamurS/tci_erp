/** Pure group helpers, mirrored from migrations 0038 and 0040.
 *
 * The exposure arithmetic and the over-limit rule are NOT reimplemented here:
 * tci.group_exposure_preflight is the single implementation and the screen
 * calls it. What lives here is presentation — how to lay the ownership tree
 * out, how to rank members, and how to phrase the preflight — plus the
 * thresholds, which a contract test locks to the migration text.
 */

import type {
  EntityRelationship,
  GroupExposureLine,
  GroupMemberFinancials,
  GroupPreflight,
  RelationshipSuggestion,
  SuggestionSignal,
} from './types'
import { SUGGESTION_SIGNALS } from './types'

/** tci.suggestion_threshold(). Below this a pair is not worth a human's time. */
export const SUGGESTION_THRESHOLD = 0.45

/** The weights in tci.relationship_signals. A shared corporate email domain
 * clears the threshold alone; nothing else does. */
export const SIGNAL_WEIGHTS: Readonly<Record<SuggestionSignal, number>> = {
  email_domain: 0.6,
  address: 0.35,
  contact_person: 0.35,
  name_similarity: 0.45,
  registration_prefix: 0.2,
}

/** tci.workflow_settings.group_exposure_warn_pct default. */
export const DEFAULT_GROUP_WARN_PCT = 90

/** tci.workflow_settings.group_depth_cap default. */
export const DEFAULT_GROUP_DEPTH_CAP = 10

export type ExposureTone = 'neutral' | 'pos' | 'warn' | 'neg'

/** How to colour a group's utilisation. Over the limit is a hard error;
 * at or past the warning share is amber; below it is unremarkable. */
export function utilisationTone(
  utilisationPct: number | null | undefined,
  warnPct = DEFAULT_GROUP_WARN_PCT,
): ExposureTone {
  if (utilisationPct === null || utilisationPct === undefined) return 'neutral'
  if (utilisationPct > 100) return 'neg'
  if (utilisationPct >= warnPct) return 'warn'
  return 'pos'
}

/** A node of the ownership tree the Группа tab draws.
 *
 * Built from the LIVE edges only, hung off the ultimate parent. Because the
 * graph can contain cycles (0038), the walk carries a visited set exactly as
 * the SQL does — a node already on the path becomes a leaf marked `cyclic`
 * rather than recursing forever.
 */
export interface TreeNode {
  entityId: string
  name: string
  ownershipPct: number | null
  relationshipType: EntityRelationship['relationship_type'] | null
  children: TreeNode[]
  /** True when this node repeats one already on the path: the edge exists but
   * is not expanded again. */
  cyclic: boolean
}

export function buildOwnershipTree(
  rootId: string,
  rootName: string,
  relationships: readonly EntityRelationship[],
  depthCap = DEFAULT_GROUP_DEPTH_CAP,
): TreeNode {
  const live = relationships.filter((r) => r.is_live)

  function walk(id: string, name: string, path: readonly string[], depth: number): TreeNode {
    const cyclic = path.includes(id)
    const node: TreeNode = {
      entityId: id,
      name,
      ownershipPct: null,
      relationshipType: null,
      children: [],
      cyclic,
    }
    // A repeat, or the cap: show the edge, do not expand it.
    if (cyclic || depth >= depthCap) return node

    const nextPath = [...path, id]
    node.children = live
      .filter((r) => r.parent_entity_id === id)
      .map((r) => {
        const child = walk(r.child_entity_id, r.child_name, nextPath, depth + 1)
        child.ownershipPct = r.ownership_pct
        child.relationshipType = r.relationship_type
        return child
      })
      .sort((a, b) => (b.ownershipPct ?? -1) - (a.ownershipPct ?? -1) || a.name.localeCompare(b.name))
    return node
  }

  return walk(rootId, rootName, [], 0)
}

/** Members that appear in the group but hang off no live parent edge from the
 * root — sisters linked only by `common_owner`, or a member reached through an
 * edge the tree could not expand. They belong on screen, under the tree. */
export function membersOutsideTree(
  tree: TreeNode,
  memberIds: readonly string[],
): string[] {
  const seen = new Set<string>()
  const stack: TreeNode[] = [tree]
  while (stack.length) {
    const n = stack.pop()!
    seen.add(n.entityId)
    stack.push(...n.children)
  }
  return memberIds.filter((id) => !seen.has(id))
}

/** Per-member exposure, summed from the in-force limit lines. */
export function exposureByMember(
  lines: readonly GroupExposureLine[],
): { memberId: string; memberName: string; exposureUzs: number; limits: number; missingRates: number }[] {
  const by = new Map<string, { memberId: string; memberName: string; exposureUzs: number; limits: number; missingRates: number }>()
  for (const l of lines) {
    const row = by.get(l.member_id) ?? {
      memberId: l.member_id,
      memberName: l.member_name,
      exposureUzs: 0,
      limits: 0,
      missingRates: 0,
    }
    row.limits += 1
    if (l.rate_missing) row.missingRates += 1
    else row.exposureUzs += Number(l.amount_uzs ?? 0)
    by.set(l.member_id, row)
  }
  return [...by.values()].sort((a, b) => b.exposureUzs - a.exposureUzs)
}

/** Per-policyholder exposure: WHOSE policies carry the group's risk. */
export function exposureByPolicyholder(
  lines: readonly GroupExposureLine[],
): { policyholderId: string; policyholderName: string; exposureUzs: number; policies: number }[] {
  const by = new Map<string, { policyholderId: string; policyholderName: string; exposureUzs: number; policies: Set<string> }>()
  for (const l of lines) {
    const row = by.get(l.policyholder_id) ?? {
      policyholderId: l.policyholder_id,
      policyholderName: l.policyholder_name,
      exposureUzs: 0,
      policies: new Set<string>(),
    }
    row.policies.add(l.policy_id)
    if (!l.rate_missing) row.exposureUzs += Number(l.amount_uzs ?? 0)
    by.set(l.policyholder_id, row)
  }
  return [...by.values()]
    .map((r) => ({
      policyholderId: r.policyholderId,
      policyholderName: r.policyholderName,
      exposureUzs: r.exposureUzs,
      policies: r.policies.size,
    }))
    .sort((a, b) => b.exposureUzs - a.exposureUzs)
}

export type RankableFigure = 'revenue' | 'net_profit' | 'gross_debt' | 'total_non_current_assets'

/** Members ranked by one figure, largest first. Members without that figure
 * are dropped rather than ranked as zero — absent is not nil. */
export function rankMembers(
  rows: readonly GroupMemberFinancials[],
  by: RankableFigure,
): GroupMemberFinancials[] {
  return rows
    .filter((r) => r[by] !== null && r[by] !== undefined)
    .sort((a, b) => Number(b[by]) - Number(a[by]))
}

/** The signals behind a suggestion, strongest first. */
export function sortedSignals(
  s: RelationshipSuggestion,
): { signal: SuggestionSignal; score: number; value: string }[] {
  return SUGGESTION_SIGNALS.flatMap((signal) => {
    const hit = s.signals?.[signal]
    return hit ? [{ signal, score: Number(hit.score), value: String(hit.value) }] : []
  }).sort((a, b) => b.score - a.score)
}

/** What the decision form says before you submit. Derived entirely from the
 * database's own preflight — this function chooses words, not numbers. */
export function preflightState(
  p: GroupPreflight | null | undefined,
  warnPct = DEFAULT_GROUP_WARN_PCT,
): { kind: 'none' | 'no_limit' | 'ok' | 'warn' | 'over'; tone: ExposureTone } {
  if (!p) return { kind: 'none', tone: 'neutral' }
  if (!p.has_group_limit) return { kind: 'no_limit', tone: 'neutral' }
  if (p.over_limit) return { kind: 'over', tone: 'neg' }
  const pct = p.utilisation_pct
  if (pct !== null && pct >= warnPct) return { kind: 'warn', tone: 'warn' }
  return { kind: 'ok', tone: 'pos' }
}
