/**
 * Simple status timelines for the portal home (Prompt 30: «simple status
 * timelines for requests, offers and claims»). Each kind of object has a few
 * steps in the policyholder's words; its status says which step it is on.
 * Only OPEN objects get a timeline — a decided, bound, paid or withdrawn one
 * has nothing left to follow and is listed on its own page.
 *
 * Steps are i18n keys under `portal.timeline.<kind>.<step>`.
 */

export type TimelineKind = 'limit' | 'submission' | 'claim'

export const TIMELINE_STEPS: Readonly<Record<TimelineKind, readonly string[]>> = {
  limit: ['sent', 'review', 'decided'],
  submission: ['sent', 'underwriting', 'yourAnswer', 'accepted'],
  claim: ['filed', 'assessment', 'decision', 'paid'],
}

/** The step a status is on, or null when the object is not open. The waiting
 * step of a limit request («identifying the company», «collecting the
 * buyer's data») is still «sent»: nothing is being decided yet. */
export function timelineStep(kind: TimelineKind, status: string): number | null {
  switch (kind) {
    case 'limit':
      if (['submitted', 'pending_entity', 'information_gathering'].includes(status)) return 0
      if (['under_review', 'escalated'].includes(status)) return 1
      return null
    case 'submission':
      if (status === 'submitted') return 0
      if (['entity_resolution', 'underwriting', 'commercial_review', 'sales_confirmation'].includes(status)) return 1
      if (status === 'client_review') return 2
      if (status === 'accepted') return 3
      return null
    case 'claim':
      if (status === 'submitted') return 0
      if (['under_assessment', 'info_requested'].includes(status)) return 1
      if (['approved', 'partially_approved'].includes(status)) return 2
      return null
  }
}

/** Is it waiting on the POLICYHOLDER (their answer, the information asked)? */
export function waitsOnYou(kind: TimelineKind, status: string): boolean {
  return (kind === 'submission' && status === 'client_review') || (kind === 'claim' && status === 'info_requested')
}
