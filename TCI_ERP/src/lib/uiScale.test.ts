/** Contract test: the text sizes offered are the ones 0076 accepts, and the
 * breakpoints that follow them are container queries in rem (index.css). */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import M76 from '../../supabase/migrations/0076_ui_scale.sql?raw'
import { DEFAULT_UI_SCALE, isUiScale, UI_SCALES, uiScaleOrDefault } from './uiScale'

// Vitest serves CSS imports empty; read the files themselves.
const CSS = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const REPORT_CSS = readFileSync(new URL('../features/entities/report/report.css', import.meta.url), 'utf8')

describe('interface text size', () => {
  it('offers exactly the sizes the database accepts', () => {
    expect(M76).toContain('check (ui_scale in (100, 125, 150, 175, 200))')
    expect([...UI_SCALES]).toEqual([100, 125, 150, 175, 200])
  })

  it('NULL and anything unknown read as the default, 150 %', () => {
    expect(DEFAULT_UI_SCALE).toBe(150)
    expect(uiScaleOrDefault(null)).toBe(150)
    expect(uiScaleOrDefault(300)).toBe(150)
    expect(uiScaleOrDefault(200)).toBe(200)
    expect(isUiScale(125)).toBe(true)
    expect(isUiScale('125')).toBe(false)
  })

  it('every breakpoint is a container query in rem on <body>, so it scales', () => {
    for (const [name, rem] of [['sm', 40], ['md', 48], ['lg', 64], ['xl', 80], ['2xl', 96]] as const) {
      expect(CSS).toContain(`@custom-variant ${name} (@container app (width >= ${rem}rem));`)
    }
    expect(CSS).toContain('container: app / inline-size;')
    expect(CSS).toMatch(/@media print \{\s*html \{\s*font-size: 100% !important;/)
  })

  it('no text or box is sized in px, so everything follows the size', () => {
    const sources = import.meta.glob(['../**/*.tsx', '../**/*.ts', '!../**/*.test.ts'], {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    const offenders = Object.entries(sources).flatMap(([file, text]) =>
      [...text.matchAll(/\b(?:text|size|max-w|min-w|min-h|max-h)-\[\d+(?:\.\d+)?px\]/g)].map((m) => `${file}: ${m[0]}`),
    )
    expect(offenders).toEqual([])
    // The report's own type is in rem too (its print routes hold 100 %).
    expect(REPORT_CSS).not.toMatch(/font-size:\s*\d+(?:\.\d+)?px/)
  })
})
