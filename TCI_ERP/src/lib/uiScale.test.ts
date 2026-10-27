/** Contract test: the zooms offered are the ones 0076 accepts and the text
 * sizes the ones 0081 accepts; the breakpoints that follow the zoom are
 * container queries in rem (index.css); the text size multiplies the type
 * tokens and nothing else. */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import M76 from '../../supabase/migrations/0076_ui_scale.sql?raw'
import M81 from '../../supabase/migrations/0081_ui_text_scale.sql?raw'
import { renderTokensCss, TYPE_SCALE } from '../design/palette'
import {
  DEFAULT_UI_SCALE,
  DEFAULT_UI_TEXT_SCALE,
  isUiScale,
  isUiTextScale,
  UI_SCALES,
  UI_TEXT_SCALES,
  uiScaleOrDefault,
  uiTextScaleOrDefault,
} from './uiScale'

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

  it('offers exactly the text sizes the database accepts; NULL reads as 100 %', () => {
    expect(M81).toContain('check (ui_text_scale in (100, 110, 125, 140, 150))')
    expect([...UI_TEXT_SCALES]).toEqual([100, 110, 125, 140, 150])
    expect(DEFAULT_UI_TEXT_SCALE).toBe(100)
    expect(uiTextScaleOrDefault(null)).toBe(100)
    expect(uiTextScaleOrDefault(175)).toBe(100)
    expect(isUiTextScale(125)).toBe(true)
  })

  it('the text size multiplies every type token, and the boxes that are one line of text', () => {
    const tokens = renderTokensCss()
    for (const [name, [size, lineHeight]] of Object.entries(TYPE_SCALE)) {
      expect(tokens).toContain(`--text-${name}: calc(${size} * var(--ui-text, 1));`)
      expect(tokens).toContain(`--text-${name}--line-height: calc(${lineHeight} * var(--ui-text, 1));`)
    }
    expect(CSS).toContain('@apply text-body leading-normal')
    expect(CSS).toMatch(/@utility h-text-\* \{\s*height: calc\(--value\(integer\) \* var\(--spacing\) \* var\(--ui-text, 1\)\);/)
    expect(CSS).toMatch(/@utility leading-text-\* \{\s*line-height: calc\(--value\(integer\) \* var\(--spacing\) \* var\(--ui-text, 1\)\);/)
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
