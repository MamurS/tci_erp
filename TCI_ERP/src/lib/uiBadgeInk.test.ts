import { describe, expect, it } from 'vitest'

import MIGRATION from '../../supabase/migrations/0089_ui_badge_ink.sql?raw'
import { BADGE_TONES } from '../components/ui/badgeStyles'
import { gradeBadgeTone } from '../components/ui/gradeTone'
import { DEFAULT_UI_BADGE_INK, effectiveBadgeInk, UI_BADGE_INKS, uiBadgeInkOrDefault } from './uiTheme'

describe('text on coloured badges (0089)', () => {
  it('offers exactly what the database accepts, white by default', () => {
    expect(MIGRATION).toContain(`check (ui_badge_ink in (${UI_BADGE_INKS.map((v) => `'${v}'`).join(', ')}))`)
    expect(MIGRATION).toContain('NULL = the application default, white')
    expect(DEFAULT_UI_BADGE_INK).toBe('white')
    expect(uiBadgeInkOrDefault(null)).toBe('white')
    expect(uiBadgeInkOrDefault('dark')).toBe('dark')
    expect(uiBadgeInkOrDefault('grey')).toBe('white')
  })

  it('applies white in light mode only, never on paper', () => {
    expect(effectiveBadgeInk('white', 'light', false)).toBe('white')
    expect(effectiveBadgeInk('white', 'dark', false)).toBe('dark')
    expect(effectiveBadgeInk('white', 'light', true)).toBe('dark')
    expect(effectiveBadgeInk('dark', 'light', false)).toBe('dark')
  })

  it('gives every coloured tone and grade a white variant, and the grey neutral none', () => {
    for (const tone of ['accent', 'pos', 'neg', 'warn'] as const) {
      expect(BADGE_TONES[tone]).toMatch(/in-data-\[badge-ink=white\]:bg-\S+-700 in-data-\[badge-ink=white\]:text-white/)
    }
    expect(BADGE_TONES.neutral).not.toContain('badge-ink')
    for (const grade of ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D']) {
      expect(gradeBadgeTone(grade)).toContain(`in-data-[badge-ink=white]:bg-grade-${grade.toLowerCase()}-ink in-data-[badge-ink=white]:text-white`)
    }
  })
})
