/**
 * The views of «Кредитные лимиты» and their ?view= values. The section is the
 * credit underwriter's workbench; everyone else who may open /limits (sales,
 * commercial underwriting) gets the decision queue and the in-force register
 * only — the rest is credit underwriting's own work.
 */

import { hasRole } from '../../../lib/roles'
import type { UserRole } from '../../../lib/roles'

export const LIMIT_VIEWS = [
  'overview',
  'queue',
  'inforce',
  'monitoring',
  'ratings',
  'groups',
  'authority',
] as const
export type LimitView = (typeof LIMIT_VIEWS)[number]

const SHARED_VIEWS: readonly LimitView[] = ['queue', 'inforce']

/** Credit underwriting and admin see the whole workbench. */
export function isCreditDesk(roles: readonly UserRole[]): boolean {
  return hasRole(roles, 'admin', 'credit_underwriter')
}

export function limitViewsFor(roles: readonly UserRole[]): readonly LimitView[] {
  return isCreditDesk(roles) ? LIMIT_VIEWS : SHARED_VIEWS
}

/**
 * The view to show. A known view the roles may see wins; an old
 * `/limits?tab=…` link (the dashboard's escalation signal) opens the queue;
 * otherwise the first view: the overview for the credit desk, the queue for
 * everyone else.
 */
export function parseLimitView(
  view: string | null | undefined,
  tab: string | null | undefined,
  roles: readonly UserRole[],
): LimitView {
  const available = limitViewsFor(roles)
  if ((available as readonly string[]).includes(view ?? '')) return view as LimitView
  if (tab) return 'queue'
  return available[0]
}

/** Where the old «Портфель лимитов» address now lives. */
export const LEGACY_LIMIT_VIEW_PATHS: Record<string, string> = {
  '/portfolio/credit': '/limits?view=overview',
}
