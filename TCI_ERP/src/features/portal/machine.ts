/** Portal-side mirrors of the SQL the portal depends on (migration 0025).
 * Pure module: the database enforces, this only decides what to render. */

/** EXACT mirror of tci.submission_terms_visible. The view nulls the term
 * columns before this point, so the UI must not claim they are simply
 * missing — it says "not agreed yet" instead. */
export const TERMS_VISIBLE_FROM: readonly string[] = [
  'client_review',
  'accepted',
  'declined',
  'bound',
]

export function termsVisible(status: string): boolean {
  return TERMS_VISIBLE_FROM.includes(status)
}

/** The three answers a client has in client_review, mirroring
 * tci.client_respond_to_submission. */
export const CLIENT_ACTIONS = ['accept', 'request_changes', 'decline'] as const
export type ClientSubmissionAction = (typeof CLIENT_ACTIONS)[number]

/** Which of them need the client to say why — the function refuses without. */
export function actionNeedsComment(action: ClientSubmissionAction): boolean {
  return action !== 'accept'
}

/** Only a submission sitting with the client can be answered. */
export function canRespond(status: string): boolean {
  return status === 'client_review'
}
