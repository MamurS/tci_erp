/**
 * App-shell behaviour that is worth a test (pure): the sidebar's remembered
 * state, its keyboard shortcut, and which section the current URL is in.
 */

import { NAV_ITEMS } from './navigation'
import type { NavItem } from './navigation'

export type SidebarState = 'open' | 'closed'

export const SIDEBAR_KEY = 'tci-erp-sidebar'

/** Hover intent of the peek: rest this long before the hidden panel shows… */
export const PEEK_OPEN_MS = 100
/** …and it goes this long after the pointer has left the panel and the toggle. */
export const PEEK_CLOSE_MS = 300

/** Anything but an explicit "closed" opens: a first visit sees the menu. */
export function parseSidebarState(stored: string | null | undefined): SidebarState {
  return stored === 'closed' ? 'closed' : 'open'
}

/** Ctrl+B / ⌘B — the toggle Claude and most editors use for a side panel. */
export function isSidebarShortcut(
  e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
): boolean {
  return e.key.toLowerCase() === 'b' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey
}

/**
 * The navigation item the path belongs to: the longest item path that is a
 * prefix of it ("/" only matches the dashboard itself).
 */
export function sectionFor(pathname: string, items: readonly NavItem[] = NAV_ITEMS): NavItem | null {
  let best: NavItem | null = null
  for (const item of items) {
    const match =
      item.path === '/'
        ? pathname === '/'
        : pathname === item.path || pathname.startsWith(`${item.path}/`)
    if (match && (!best || item.path.length > best.path.length)) best = item
  }
  return best
}
