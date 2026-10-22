/** What a limit write is CERTAIN to change, painted before the answer.
 *
 * A request's status after submit / start review / withdraw is fixed by the
 * state machine (0013), so it is painted. A DECISION is not: whether it is
 * decided, escalated or stopped at the group limit is the database's call,
 * so the decision form shows its pending state and nothing else. Release and
 * hold are certain on the decision row (0020): released now (sales
 * confirmed), or held with the comment. */

import type { EffectiveLimit, LimitRequestStatus } from './types'

/** The status the state machine moves a request to on each of these. */
export const REQUEST_ACTION_STATUS = {
  submit_limit_request: 'submitted',
  start_limit_review: 'under_review',
  withdraw_limit_request: 'withdrawn',
} as const satisfies Record<string, LimitRequestStatus>

export function withStatus<T extends { status: string }>(row: T, status: T['status']): T {
  return { ...row, status }
}

/** Sales confirmed now: the policyholder sees it at once. */
export function released(limit: EffectiveLimit, at: string): EffectiveLimit {
  return {
    ...limit,
    released_at: limit.released_at ?? at,
    release_kind: limit.release_kind ?? 'sales_confirmed',
    held: false,
    hold_comment: null,
  }
}

/** Held: the silent-consent clock stops until sales releases it. */
export function held(limit: EffectiveLimit, comment: string): EffectiveLimit {
  return { ...limit, held: true, hold_comment: comment }
}
