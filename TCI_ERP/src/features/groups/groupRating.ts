/**
 * The group rating (migration 0074) — pure module.
 *
 * A grade for a whole corporate group, keyed by its ultimate parent and set
 * by a senior credit analyst, that CAPS every member: no member's grade in
 * force is better than the group's. The scale sorts better first (A1 < A2 <
 * B1 < … < D), so the worse of two grades is the larger in byte order —
 * `gradeWorse` mirrors tci.grade_worse. The database decides; this only
 * lets the screen say what will happen before it asks.
 */

export interface GroupRatingRow {
  id: string
  grade: string
  reason: string
  set_by_name: string | null
  set_at: string
}

export interface GroupRatingHistoryItem extends GroupRatingRow {
  status: 'replaced' | 'ended'
  ended_by_name: string | null
  ended_at: string | null
  end_reason: string | null
}

/** tci.group_rating_state(entity). */
export interface GroupRatingState {
  parent_id: string
  parent_name: string | null
  members: number
  may_set: boolean
  seniors: string[]
  active: GroupRatingRow | null
  history: GroupRatingHistoryItem[]
  /** Members whose grade in force is the live group rating's cap. */
  capped: { entity_id: string; name: string; grade: string; engine_grade: string | null }[]
  /** Only on the answer to a set: how many members were capped at once. */
  capped_now?: number
}

/** The worse of two grades (tci.grade_worse): the larger in byte order. */
export function gradeWorse(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return a > b ? a : b
}

/** Whether a grade is better than the cap, i.e. would be lowered to it. */
export function aboveCap(grade: string, cap: string | null): boolean {
  return cap !== null && gradeWorse(grade, cap) !== grade
}
