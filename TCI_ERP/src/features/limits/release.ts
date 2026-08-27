/**
 * Release & visibility of a limit decision — pure module, EXACT mirror of
 * tci.decision_is_released and tci.apply_emergency_release (migration
 * 0020). Nothing here runs on a timer: the state is derived from
 * (released_at, decided_at, held) every time it is rendered, exactly as the
 * view and the client RLS policy derive it.
 *
 *   released_at set  -> the client sees it
 *   held             -> the client does not, and the clock is SUSPENDED
 *   otherwise        -> visible once now >= decided_at + salesWindowHours
 *                       (silent consent)
 */

export type ReleaseKind = 'sales_confirmed' | 'silent_consent' | 'immediate'

export interface ReleaseFacts {
  released_at: string | null
  decided_at: string
  held: boolean
  release_kind: ReleaseKind | null
}

/** tci.decision_is_released(released_at, decided_at, held). */
export function decisionIsReleased(
  facts: ReleaseFacts,
  salesWindowHours: number,
  nowIso: string,
): boolean {
  if (facts.released_at !== null) return true
  if (facts.held) return false
  return new Date(nowIso).getTime() >= windowEndsAt(facts.decided_at, salesWindowHours).getTime()
}

/** The instant silent consent takes effect. */
export function windowEndsAt(decidedAt: string, salesWindowHours: number): Date {
  return new Date(new Date(decidedAt).getTime() + salesWindowHours * 3_600_000)
}

/** Milliseconds left in the sales window; 0 once it has elapsed. */
export function windowRemainingMs(
  decidedAt: string,
  salesWindowHours: number,
  nowIso: string,
): number {
  const left = windowEndsAt(decidedAt, salesWindowHours).getTime() - new Date(nowIso).getTime()
  return left > 0 ? left : 0
}

export type ReleaseStatus =
  /** The client has it — with the reason it got there. */
  | { state: 'released'; kind: ReleaseKind; at: string | null }
  /** Sales suspended the clock. */
  | { state: 'held'; comment: string | null }
  /** The sales window is still running. */
  | { state: 'window'; endsAt: Date; remainingMs: number }

/** The single source of the badge shown on every decision row. */
export function releaseStatus(
  facts: ReleaseFacts & { hold_comment?: string | null },
  salesWindowHours: number,
  nowIso: string,
): ReleaseStatus {
  if (facts.released_at !== null) {
    return {
      state: 'released',
      // A row released before release_kind existed reads as sales_confirmed.
      kind: facts.release_kind ?? 'sales_confirmed',
      at: facts.released_at,
    }
  }
  if (facts.held) return { state: 'held', comment: facts.hold_comment ?? null }
  if (decisionIsReleased(facts, salesWindowHours, nowIso)) {
    return { state: 'released', kind: 'silent_consent', at: null }
  }
  return {
    state: 'window',
    endsAt: windowEndsAt(facts.decided_at, salesWindowHours),
    remainingMs: windowRemainingMs(facts.decided_at, salesWindowHours, nowIso),
  }
}

/**
 * tci.apply_emergency_release: an action that makes the limit WORSE for the
 * client bypasses both the commercial stage and the sales window.
 * `previousAmount` is the amount the client currently has on this
 * (policy, buyer) pair, or null when there is none.
 */
export function isEmergencyAction(
  outcome: 'approved' | 'partial' | 'declined' | 'revoked',
  newAmount: number | null,
  previousAmount: number | null,
): boolean {
  if (outcome === 'revoked') return true
  if (outcome !== 'approved' && outcome !== 'partial') return false
  if (newAmount === null || previousAmount === null) return false
  return newAmount < previousAmount
}

/** Sales may only release or hold, and only before the client has seen it
 * (tci.hold_decision refuses a released decision outright). */
export function canHold(facts: ReleaseFacts): boolean {
  return facts.released_at === null && !facts.held
}

export function canRelease(facts: ReleaseFacts): boolean {
  return facts.released_at === null
}

/**
 * Stage precedence — the mirror of the ORDER BY of tci.v_effective_limits:
 *
 *   distinct on (policy_id, entity_id)
 *   order by ..., (stage = 'commercial') desc, decided_at desc
 *
 * Among the effective decisions of ONE (policy, buyer) pair, the commercial
 * adjustment governs when there is one, otherwise the credit decision; ties
 * inside a stage go to the newest. Both rows are kept in the table, so the
 * credit → commercial chain stays visible.
 */
export interface StagedDecision {
  id: string
  stage: 'credit' | 'commercial'
  decided_at: string
  lifecycle: string
  valid_until: string | null
}

export function pickEffective<T extends StagedDecision>(
  decisions: readonly T[],
  todayIso: string,
): T | null {
  const live = decisions.filter(
    (d) => d.lifecycle === 'effective' && (d.valid_until === null || d.valid_until >= todayIso),
  )
  if (!live.length) return null
  return [...live].sort((a, b) => {
    const stageRank = Number(b.stage === 'commercial') - Number(a.stage === 'commercial')
    if (stageRank !== 0) return stageRank
    return b.decided_at.localeCompare(a.decided_at)
  })[0]
}
