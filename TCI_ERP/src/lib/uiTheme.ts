/**
 * The COLOUR THEME and the LIGHT / DARK MODE (migration 0082:
 * tci.user_profiles.ui_theme, ui_mode; owner, 2026-10-27).
 *
 * Both are attributes on <html> — `data-theme` (blue, salad, teal, plum,
 * graphite) and `data-mode` (light or dark) — that select the colour tokens
 * generated in tokens.css (src/design/palette.ts: `renderThemeCss`). A theme
 * re-hues the brand ramps only; dark mode replaces every colour by one at
 * the same contrast against the dark surface, so the contrast guard holds in
 * every combination. «Auto» follows the system (prefers-color-scheme) and
 * changes with it. Print routes pin the default theme in light mode while
 * they are open — a report or an offer goes to the client in the house
 * colours whoever prints it — and paper is always light (the dark rules are
 * `@media screen`).
 *
 * NULL in the database means the default (blue, light). The last choice is
 * cached in the browser only for the first paint; the server's value wins
 * once it loads.
 */

import { useSyncExternalStore } from 'react'

/** The themes offered — 0082 accepts exactly these; palette.ts THEMES
 * defines their colours (uiTheme.test.ts keeps the three in step). */
export const UI_THEMES = ['blue', 'salad', 'teal', 'plum', 'graphite'] as const
export type UiTheme = (typeof UI_THEMES)[number]
export const DEFAULT_UI_THEME: UiTheme = 'blue'

export const UI_MODES = ['light', 'dark', 'auto'] as const
export type UiMode = (typeof UI_MODES)[number]
export const DEFAULT_UI_MODE: UiMode = 'light'

const THEME_KEY = 'tci-erp-ui-theme'
const MODE_KEY = 'tci-erp-ui-mode'

export function uiThemeOrDefault(value: unknown): UiTheme {
  return (UI_THEMES as readonly unknown[]).includes(value) ? (value as UiTheme) : DEFAULT_UI_THEME
}

export function uiModeOrDefault(value: unknown): UiMode {
  return (UI_MODES as readonly unknown[]).includes(value) ? (value as UiMode) : DEFAULT_UI_MODE
}

/** What a mode shows: «auto» is the system's choice. */
export function resolveMode(mode: UiMode, systemDark: boolean): 'light' | 'dark' {
  return mode === 'auto' ? (systemDark ? 'dark' : 'light') : mode
}

// ---------------------------------------------------------------------------
// The live values
// ---------------------------------------------------------------------------

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // the page works without storage; only the first paint is affected
  }
}

let theme: UiTheme = typeof window === 'undefined' ? DEFAULT_UI_THEME : uiThemeOrDefault(read(THEME_KEY))
let mode: UiMode = typeof window === 'undefined' ? DEFAULT_UI_MODE : uiModeOrDefault(read(MODE_KEY))
/** A print page shows the house colours (the default theme, light) while
 * it is open. */
let pinnedPaper = false
const listeners = new Set<() => void>()

function systemQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null
}

function paint() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = pinnedPaper ? DEFAULT_UI_THEME : theme
  root.dataset.mode = pinnedPaper ? 'light' : resolveMode(mode, systemQuery()?.matches ?? false)
}

function emit() {
  paint()
  for (const listener of listeners) listener()
}

export function setUiTheme(next: UiTheme) {
  theme = next
  write(THEME_KEY, next)
  emit()
}

export function setUiMode(next: UiMode) {
  mode = next
  write(MODE_KEY, next)
  emit()
}

/** Print routes: the house colours while the page is open. */
export function pinPaperColours(on: boolean) {
  pinnedPaper = on
  emit()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useUiThemeValue(): UiTheme {
  return useSyncExternalStore(subscribe, () => theme, () => DEFAULT_UI_THEME)
}

export function useUiModeValue(): UiMode {
  return useSyncExternalStore(subscribe, () => mode, () => DEFAULT_UI_MODE)
}

/** Paint the cached choice before React renders, and follow the system
 * while the mode is «auto» (main.tsx). */
export function initUiTheme() {
  paint()
  systemQuery()?.addEventListener('change', () => {
    if (mode === 'auto') emit()
  })
}
