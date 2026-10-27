/**
 * The interface ZOOM (migration 0076: tci.user_profiles.ui_scale) and the
 * TEXT SIZE (migration 0081: tci.user_profiles.ui_text_scale).
 *
 * Zoom —
 * The whole interface is sized in rem — text, spacing, column reservations —
 * so one number scales it: the root font size, in per cent of the browser's
 * own default. The breakpoints scale with it because they are container
 * queries in rem on <body> (index.css), which resolve against the ROOT font
 * size, unlike media queries: at 200 % on a 1440 px screen the layout is the
 * one a 720 px screen gets, exactly as the browser's own zoom would give,
 * and nothing is cut.
 *
 * Text size — only the type grows: the seven text tokens (tokens.css) and
 * the few boxes that are a line of text (badges, counters: the `h-text-*` /
 * `leading-text-*` utilities in index.css) are multiplied by `--ui-text`,
 * set on <html>; spacing, boxes and breakpoints stay at the zoom. Table
 * columns reserve room for their text, so the Table primitive widens them by
 * the same factor (owner, 2026-10-27: «the text at 100 % is too small, the
 * rest is right»).
 *
 * NULL in the database means the application default. The last value used is
 * cached in the browser only so the sign-in page and the first paint after a
 * reload are already right; the server's value wins once it loads.
 */

import { useSyncExternalStore } from 'react'

export const UI_SCALES = [100, 125, 150, 175, 200] as const
export type UiScale = (typeof UI_SCALES)[number]

/** The owner's choice (2026-10-25): larger than the browser's default. */
export const DEFAULT_UI_SCALE: UiScale = 150

const STORAGE_KEY = 'tci-erp-ui-scale'

/** The text sizes offered (0081 accepts exactly these). */
export const UI_TEXT_SCALES = [100, 110, 125, 140, 150] as const
export type UiTextScale = (typeof UI_TEXT_SCALES)[number]

/** The tokens as designed; a person who wants larger type says so. */
export const DEFAULT_UI_TEXT_SCALE: UiTextScale = 100

const TEXT_STORAGE_KEY = 'tci-erp-ui-text'

export function isUiTextScale(value: unknown): value is UiTextScale {
  return typeof value === 'number' && (UI_TEXT_SCALES as readonly number[]).includes(value)
}

/** A stored text size, or the default for anything else (NULL included). */
export function uiTextScaleOrDefault(value: unknown): UiTextScale {
  return isUiTextScale(value) ? value : DEFAULT_UI_TEXT_SCALE
}

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
let currentText: UiTextScale = readCachedText()
/** A print page holds the interface (zoom and text) at 100 % while it is open. */
let pinned: UiScale | null = null
const listeners = new Set<() => void>()

function readCached(): UiScale {
  try {
    return uiScaleOrDefault(Number(window.localStorage.getItem(STORAGE_KEY)))
  } catch {
    return DEFAULT_UI_SCALE
  }
}

function readCachedText(): UiTextScale {
  try {
    return uiTextScaleOrDefault(Number(window.localStorage.getItem(TEXT_STORAGE_KEY)))
  } catch {
    return DEFAULT_UI_TEXT_SCALE
  }
}

function paint() {
  if (typeof document === 'undefined') return
  const scale = pinned ?? current
  const text = pinned === null ? currentText : 100
  const root = document.documentElement
  root.style.fontSize = `${scale}%`
  root.dataset.uiScale = String(scale)
  root.style.setProperty('--ui-text', String(text / 100))
  root.dataset.uiText = String(text)
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

/** Apply a text size (the person's, or the default when they have none). */
export function setUiTextScale(text: UiTextScale) {
  currentText = text
  try {
    window.localStorage.setItem(TEXT_STORAGE_KEY, String(text))
  } catch {
    // as above
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

export function useUiTextScaleValue(): UiTextScale {
  return useSyncExternalStore(
    subscribeUiScale,
    () => (pinned === null ? currentText : 100),
    () => DEFAULT_UI_TEXT_SCALE,
  )
}

/** Paint the cached sizes before React renders (main.tsx). */
export function initUiScale() {
  paint()
}
