/** The four-eyes rule on credit limits (migration 0063), mirrored so the
 * screen can explain instead of offering a button the database will refuse.
 *
 * `tci.limit_four_eyes_refusal(request, user, stream)` is the one rule for
 * the decider, the proposer, the validator and the commercial adjuster:
 *
 *  * whoever RAISED the request never takes it into review, decides it,
 *    proposes a decision on it, validates it or adjusts it;
 *  * on the commercial stage, whoever made a CREDIT decision on the request
 *    does not adjust it either.
 *
 * Admin is not exempt — since 0063 admin makes no limit decisions at all.
 * The database is what refuses; this is a hint for the screen. */

import type { AuthorityScope } from '../../lib/roles'

export type FourEyesRefusal = 'own_request' | 'own_credit_decision'

/** The prefix of each refusal text in tci.limit_four_eyes_refusal. */
export const FOUR_EYES_CODES: Record<FourEyesRefusal, string> = {
  own_request: 'four_eyes_own_request',
  own_credit_decision: 'four_eyes_own_credit_decision',
}

export function fourEyesRefusal(input: {
  userId: string | null | undefined
  requestedBy: string | null | undefined
  stream: AuthorityScope
  /** `decided_by` of the request's CREDIT-stage decisions (commercial only). */
  creditDeciders?: readonly (string | null)[]
}): FourEyesRefusal | null {
  const { userId } = input
  if (!userId) return null
  if (input.requestedBy === userId) return 'own_request'
  if (input.stream === 'commercial' && (input.creditDeciders ?? []).includes(userId)) {
    return 'own_credit_decision'
  }
  return null
}

/** The notice the screen shows in place of the action (an i18n key). */
export function fourEyesNoticeKey(refusal: FourEyesRefusal, stream: AuthorityScope): string {
  if (refusal === 'own_credit_decision') return 'limits.fourEyes.ownCreditDecision'
  return stream === 'commercial' ? 'limits.fourEyes.ownRequestCommercial' : 'limits.fourEyes.ownRequest'
}
