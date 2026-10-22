/** `/declarations?policy=<id>&period=<YYYY-MM-DD>` — the Agenda's link for a
 * declaration that is due or overdue (`declaration_due` /
 * `declaration_overdue`, keyed on the POLICY because the point of the task is
 * that the declaration may not exist yet).
 *
 * The same rule as the task itself (tci.refresh_agenda, migration 0029, restated last in 0043): a
 * period counts as declared when a declaration of that policy starts on it and
 * is not `corrected` — a correction is superseded by the one that replaced it.
 */

import { isIsoDate } from '../../lib/deepLink'
import type { DeclarationStatus } from './types'

export type PeriodLinkOutcome =
  /** No usable `period`: the list as it has always been. */
  | { kind: 'none' }
  /** The period is declared: open that declaration instead of the list. */
  | { kind: 'open'; id: string }
  /** Nothing declared for it yet: say so above the policy's list. */
  | { kind: 'missing'; period: string }

export function resolvePeriodLink(
  rows: readonly { id: string; period_start: string; status: DeclarationStatus }[],
  policyId: string | null | undefined,
  period: string | null | undefined,
): PeriodLinkOutcome {
  if (!policyId || !isIsoDate(period)) return { kind: 'none' }
  const live = rows.filter((d) => d.period_start === period && d.status !== 'corrected')
  if (live.length === 1) return { kind: 'open', id: live[0].id }
  // More than one live row cannot happen (one per period is a unique rule);
  // if it ever did, the list is the honest answer, not a guess.
  return live.length === 0 ? { kind: 'missing', period } : { kind: 'none' }
}
