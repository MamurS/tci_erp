/**
 * Steps every staff tour shares: the frame around the work (workspace, menu,
 * search, Agenda, the user menu, help) and the closing card. Their text is
 * the same for every role (tour.shared.*); a role's tour puts its own steps
 * between them.
 */

import type { TourStep } from '../types'

function shared(id: string, anchor: string | null, extra: Partial<TourStep> = {}): TourStep {
  return { id, anchor, titleKey: `tour.shared.${id}.title`, textKey: `tour.shared.${id}.text`, ...extra }
}

/** The opening card of a role's tour: its own words (tour.<key>.welcome). */
export function welcome(tourKey: string): TourStep {
  return { id: 'welcome', anchor: null, titleKey: 'tour.shared.welcome.title', textKey: `tour.${tourKey}.welcome.text` }
}

/** A step of a tour's own (tour.<key>.<id>). */
export function own(tourKey: string, id: string, anchor: string | null, extra: Partial<TourStep> = {}): TourStep {
  return { id, anchor, titleKey: `tour.${tourKey}.${id}.title`, textKey: `tour.${tourKey}.${id}.text`, ...extra }
}

export const WORKSPACE = shared('workspace', 'workspace-switcher')
export const SIDEBAR = shared('sidebar', 'sidebar')
export const SEARCH = shared('search', 'search')
export const AGENDA = shared('agenda', 'agenda-views', { route: '/agenda' })
export const AGENDA_FILTERS = shared('agendaFilters', 'agenda-chips', { route: '/agenda' })
export const USER_MENU = shared('userMenu', 'user-menu')
/** The Help centre's «?» (its own workstream adds the anchor; skipped without it). */
export const HELP = shared('help', 'help')
export const FINISH = shared('finish', null)

/** The frame before a role's own steps. */
export const STAFF_OPENING: readonly TourStep[] = [WORKSPACE, SIDEBAR, SEARCH]
/** The frame after them. */
export const STAFF_CLOSING: readonly TourStep[] = [AGENDA, AGENDA_FILTERS, USER_MENU, HELP, FINISH]
