/**
 * The interface text size (migration 0076: tci.user_profiles.ui_scale).
 *
 * The whole interface is sized in rem — text, spacing, column reservations —
 * so one number scales it: the root font size, in per cent of the browser's
 * own default. The breakpoints scale with it because they are container
 * queries in rem on <body> (index.css), which resolve against the ROOT font
 * size, unlike media queries: at 200 % on a 1440 px screen the layout is the
 * one a 720 px screen gets, exactly as the browser's own zoom would give,
 * and nothing is cut.
 *
 * NULL in the database means the application default. The last size used is
 * cached in the browser only so the sign-in page and the first paint after a
 * reload are already the right size; the server's value wins once it loads.
 */

import { useSyncExternalStore } from 'react'

export const UI_SCALES = [100, 125, 150, 175, 200] as const
export type UiScale = (typeof UI_SCALES)[number]

/** The owner's choice (2026-10-25): larger than the browser's default. */
export const DEFAULT_UI_SCALE: UiScale = 150

const STORAGE_KEY = 'tci-erp-ui-scale'

export function isUiScale(value: unknown): value is UiScale {
  return typeof value === 'number' && (UI_SCALES as readonly number[]).includes(value)
}

/** A stored value, or the default for anything else (NULL included). */
export function uiScaleOrDefault(value: unknown): UiScale {
  return isUiScale(value) ? value : DEFAULT_UI_SCALE
}

// ---------------------------------------------------------------------------
// The live value: one store, read by the breakpoint hooks and the picker
// ---------------------------------------------------------------------------

let current: UiScale = readCached()
/** A print page holds the interface at 100 % while it is open. */
let pinned: UiScale | null = null
const listeners = new Set<() => void>()

function readCached(): UiScale {
  try {
    return uiScaleOrDefault(Number(window.localStorage.getItem(STORAGE_KEY)))
  } catch {
    return DEFAULT_UI_SCALE
  }
}

function paint() {
  if (typeof document === 'undefined') return
  const scale = pinned ?? current
  document.documentElement.style.fontSize = `${scale}%`
  document.documentElement.dataset.uiScale = String(scale)
}

function emit() {
  paint()
  for (const listener of listeners) listener()
}

/** The size in force now (the print pin aside). */
export function currentUiScale(): UiScale {
  return current
}

/** Apply a size (the person's, or the default when they have none). */
export function setUiScale(scale: UiScale) {
  current = scale
  try {
    window.localStorage.setItem(STORAGE_KEY, String(scale))
  } catch {
    // the page works without storage; only the first paint is affected
  }
  emit()
}

/** Print routes: the A4 page is laid out at 100 % whatever the screen uses. */
export function pinUiScale(scale: UiScale | null) {
  pinned = scale
  emit()
}

export function subscribeUiScale(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useUiScaleValue(): UiScale {
  return useSyncExternalStore(subscribeUiScale, () => pinned ?? current, () => DEFAULT_UI_SCALE)
}

/** Paint the cached size before React renders (main.tsx). */
export function initUiScale() {
  paint()
}
