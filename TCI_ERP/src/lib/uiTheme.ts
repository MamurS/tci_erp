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
 *
 * The TEXT ON COLOURED BADGES (0089, ui_badge_ink) is a third attribute,
 * `data-badge-ink`: «white» fills a status, grade or tone badge with its
 * dark shade behind white text (badgeStyles.ts, gradeTone.ts — the
 * `in-data-[badge-ink=white]:` classes), «dark» keeps the pale tint with
 * dark text — the PASTEL badge. It applies in light mode only — dark mode
 * already draws light text on dark tints — and never on paper. NULL means
 * pastel since 0093 (the owner asked for lighter badges, 2026-10-27; white
 * before).
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

/** «dark» is the pastel badge (the default since 0093), «white» the bold one. */
export const UI_BADGE_INKS = ['dark', 'white'] as const
export type UiBadgeInk = (typeof UI_BADGE_INKS)[number]
export const DEFAULT_UI_BADGE_INK: UiBadgeInk = 'dark'

const THEME_KEY = 'tci-erp-ui-theme'
const MODE_KEY = 'tci-erp-ui-mode'
const BADGE_INK_KEY = 'tci-erp-ui-badge-ink'

export function uiThemeOrDefault(value: unknown): UiTheme {
  return (UI_THEMES as readonly unknown[]).includes(value) ? (value as UiTheme) : DEFAULT_UI_THEME
}

export function uiBadgeInkOrDefault(value: unknown): UiBadgeInk {
  return (UI_BADGE_INKS as readonly unknown[]).includes(value) ? (value as UiBadgeInk) : DEFAULT_UI_BADGE_INK
}

/** What the badges show: white only in light mode and never on paper. */
export function effectiveBadgeInk(ink: UiBadgeInk, shownMode: 'light' | 'dark', paper: boolean): UiBadgeInk {
  return !paper && shownMode === 'light' ? ink : 'dark'
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
let badgeInk: UiBadgeInk = typeof window === 'undefined' ? DEFAULT_UI_BADGE_INK : uiBadgeInkOrDefault(read(BADGE_INK_KEY))
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
  const shown = pinnedPaper ? 'light' : resolveMode(mode, systemQuery()?.matches ?? false)
  root.dataset.mode = shown
  root.dataset.badgeInk = effectiveBadgeInk(badgeInk, shown, pinnedPaper)
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

export function setUiBadgeInk(next: UiBadgeInk) {
  badgeInk = next
  write(BADGE_INK_KEY, next)
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

export function useUiBadgeInkValue(): UiBadgeInk {
  return useSyncExternalStore(subscribe, () => badgeInk, () => DEFAULT_UI_BADGE_INK)
}

/** Paint the cached choice before React renders, and follow the system
 * while the mode is «auto» (main.tsx). */
export function initUiTheme() {
  paint()
  systemQuery()?.addEventListener('change', () => {
    if (mode === 'auto') emit()
  })
}
