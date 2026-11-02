/**
 * The online guided tour (Prompt 32, part 3): what a tour IS. Steps are data
 * (steps/*.ts); the overlay (TourOverlay.tsx) only walks them.
 *
 * A step points at a stable `data-tour="…"` attribute on a real component —
 * never a CSS class — and may first open a route. A step whose anchor is not
 * on screen is skipped (console.debug in development); a step that needs
 * data shows a short explanation instead of an empty highlight when the list
 * it points at is empty (an EmptyState inside it carries `data-tour-empty`).
 */

export interface TourStep {
  /** Unique within its tour; recorded as the last step reached. */
  id: string
  /** The `data-tour` value to highlight; null: a card in the middle of the screen. */
  anchor: string | null
  /** A route to open first (pathname plus optional ?query) when the browser
   * is not already on it. Two steps on one page may each name a route that
   * differs only in its query (a tab): give them different anchors, since an
   * anchor that stays on screen across the switch cannot tell the step that
   * the new view has rendered. */
  route?: string
  /** i18n keys (tour.*), rendered in the viewer's language. */
  titleKey: string
  textKey: string
  /** The anchor is a list: when it is empty, say so instead of highlighting
   * nothing (and suggest Demo mode). */
  needsData?: boolean
  /** Open the first row of this anchor's list (a LinkRow's `data-link-row`)
   * before looking for the step's own anchor — e.g. the decision form behind
   * the first request of the queue. No row: the step explains (needsData). */
  openFirst?: string
}

export interface Tour {
  /** Recorded in tci.user_profiles.ui_tour_state under this key (0098). */
  id: string
  steps: readonly TourStep[]
}

/** A «What's new» tour, shown once to those who were here before it. */
export interface ReleaseTour extends Tour {
  /** «YYYY.MM», compared as numbers. */
  version: string
  /** The release date (YYYY-MM-DD): people whose first tour is later learnt
   * these things from their role tour and are not shown this one. */
  date: string
  /** Who sees it. */
  audience: 'staff' | 'client' | 'all'
}

/** One tour's outcome, as 0098 checks it. */
export interface TourRecord {
  status: 'completed' | 'skipped'
  /** Index of the step the person was on. */
  last_step: number
  /** ISO timestamp. */
  at: string
}

/** tci.user_profiles.ui_tour_state: tour id → outcome. */
export type TourState = Readonly<Record<string, TourRecord>>
