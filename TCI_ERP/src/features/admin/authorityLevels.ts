/**
 * Authority levels (migration 0071) — pure helpers for the admin screen.
 * Ranks 1–4 of a stream carry band authority as the LEVEL's grants and hold
 * members; rank 5 is the committee (no amount cap, a chair). A person sits
 * at one rank 1–4 per stream and may also sit on the committee. The
 * database refuses everything else (add_authority_level_member,
 * save_authority_level_grant, set_committee_chair); this only decides what
 * the screen offers.
 */

import type { AuthorityScope, GradeBand, UserRole } from '../../lib/roles'

export interface AuthorityLevel {
  id: string
  stream: AuthorityScope
  rank: number
  is_committee: boolean
  chair_id: string | null
}

export interface LevelGrant {
  id: string
  level_id: string
  grade_band: GradeBand
  max_amount: number | string
  currency_code: string
  valid_from: string
  valid_to: string | null
}

export interface LevelMember {
  id: string
  level_id: string
  user_id: string
  valid_from: string
  valid_to: string | null
}

/** In force today: started, not ended (valid_to inclusive). */
export function isLive(row: { valid_from: string; valid_to: string | null }, todayIso: string): boolean {
  return row.valid_from <= todayIso && (row.valid_to === null || row.valid_to >= todayIso)
}

/** The department a stream's levels draw from (tci.validation_role). */
export function levelRole(stream: AuthorityScope): UserRole {
  return stream === 'credit' ? 'credit_underwriter' : 'commercial_underwriter'
}

/** Who may be added to a level: holds the stream's role, is not already a
 * live member of it, and — for ranks 1–4 — sits at no other rank 1–4 of the
 * stream. */
export function memberCandidates<P extends { user_id: string; roles: readonly string[] }>(
  people: readonly P[],
  level: AuthorityLevel,
  levels: readonly AuthorityLevel[],
  members: readonly LevelMember[],
  todayIso: string,
): P[] {
  const live = members.filter((m) => m.valid_to === null || m.valid_to >= todayIso)
  const rankedElsewhere = new Set(
    live
      .filter((m) => {
        const l = levels.find((x) => x.id === m.level_id)
        return l !== undefined && l.stream === level.stream && !l.is_committee
      })
      .map((m) => m.user_id),
  )
  const here = new Set(live.filter((m) => m.level_id === level.id).map((m) => m.user_id))
  return people.filter(
    (p) =>
      p.roles.includes(levelRole(level.stream)) &&
      !here.has(p.user_id) &&
      (level.is_committee || !rankedElsewhere.has(p.user_id)),
  )
}
