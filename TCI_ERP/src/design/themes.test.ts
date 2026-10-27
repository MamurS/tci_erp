/**
 * Colour themes and dark mode (0082): the lists in uiTheme.ts, palette.ts
 * and the migration are one list, «auto» follows the system, and dark mode
 * keeps its page, cards and veil right. That every colour in use reads in
 * every theme and mode is contrast.test.ts's audit, run per theme and mode.
 */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../supabase/migrations/0082_ui_theme.sql?raw'
import { DEFAULT_UI_MODE, DEFAULT_UI_THEME, UI_MODES, UI_THEMES, resolveMode } from '../lib/uiTheme'
import { contrast, luminance } from './oklch'
import {
  DEFAULT_THEME,
  TEXT_MIN,
  THEME_NAMES,
  colorTokens,
  darkColorTokens,
} from './palette'

describe('the theme lists agree', () => {
  it('uiTheme.ts, palette.ts and 0082 name the same themes and modes', () => {
    expect([...UI_THEMES]).toEqual(THEME_NAMES)
    expect(DEFAULT_UI_THEME).toBe(DEFAULT_THEME)
    expect(DEFAULT_UI_MODE).toBe('light')
    expect(MIGRATION).toContain(`check (ui_theme in (${UI_THEMES.map((t) => `'${t}'`).join(', ')}))`)
    expect(MIGRATION).toContain(`check (ui_mode in (${UI_MODES.map((m) => `'${m}'`).join(', ')}))`)
  })

  it('«auto» follows the system', () => {
    expect(resolveMode('auto', true)).toBe('dark')
    expect(resolveMode('auto', false)).toBe('light')
    expect(resolveMode('dark', false)).toBe('dark')
    expect(resolveMode('light', true)).toBe('light')
  })
})

describe('dark mode', () => {
  it('the cards lift off the page, and text reads on both', () => {
    const dark = darkColorTokens(DEFAULT_THEME)
    expect(luminance(dark.white)).toBeGreaterThan(luminance(dark.canvas))
    expect(contrast(dark['slate-500'], dark.canvas)).toBeGreaterThanOrEqual(TEXT_MIN)
    expect(contrast(dark['slate-900'], dark.white)).toBeGreaterThanOrEqual(TEXT_MIN)
  })

  it('the veil under a dialog stays dark', () => {
    for (const theme of THEME_NAMES) {
      expect(darkColorTokens(theme).scrim).toBe(colorTokens(theme).scrim)
      expect(darkColorTokens(theme).black).toBe('#000000')
    }
  })
})
