/**
 * One badge spec (DESIGN.md «Badges», badgeStyles.ts), checked on the source:
 *
 * - two sizes, `sm` and `md`, each with one height, padding, text size,
 *   weight; the body font and sentence case are part of the base (so a badge
 *   inside an uppercase, display-face heading does not inherit either);
 * - no `size="lg"` (retired) and no hand-made pill: a `rounded-full` span
 *   with its own small text and padding is a badge drawn by hand, which is
 *   how the company card ended up with two badges of different heights,
 *   fonts and radii side by side. Draw it with <Badge>, <Count>, or
 *   `badgeClassName` + `data-badge`.
 */
import { describe, expect, it } from 'vitest'

import { BADGE_SIZES, badgeClassName } from './badgeStyles'

const SOURCES = import.meta.glob('../../**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

/** Files rebuilt elsewhere (October 2026): their badges are not ours to change. */
const EXCLUDED = ['/features/offers/', '/features/brochure/']

/** Round things that are not badges, by file. */
const NOT_BADGES: Record<string, string> = {
  'components/layout/Header.tsx': 'the avatar (initials in a circle) and the search box',
  'features/agenda/parts.tsx': 'the owner avatar',
  'features/agenda/TriageView.tsx': 'the comment author avatar',
  'features/agenda/AgendaPage.tsx': 'the filter chips are toggle BUTTONS (h-8, as a small Button), not labels',
  'components/ui/CountryFlag.tsx': 'the ISO code shown in place of a missing flag',
  'components/ui/primitives.tsx': 'Count — the counter form of the sm badge itself',
}

// Glob keys are relative to this file; resolve them to /src/… paths.
const files = Object.entries(SOURCES)
  .map(([path, text]) => [new URL(path, 'file:///src/components/ui/').pathname, text] as const)
  .filter(([path]) => !path.endsWith('.test.tsx') && !EXCLUDED.some((x) => path.includes(x)))

describe('badges', () => {
  it('has two sizes, each fixing height, padding, text size and weight', () => {
    expect(Object.keys(BADGE_SIZES)).toEqual(['sm', 'md'])
    for (const size of ['sm', 'md'] as const) {
      const cls = BADGE_SIZES[size]
      // The height grows with the text size (`h-text-*`, index.css).
      expect(cls).toMatch(/\bh-text-\d/)
      expect(cls).toMatch(/\bpx-/)
      expect(cls).toMatch(/\btext-/)
      expect(cls).toMatch(/\bfont-(medium|semibold)\b/)
      expect(cls).toMatch(/\bleading-/)
    }
  })

  it('sets the body font and sentence case in the base, whatever the parent sets', () => {
    const cls = badgeClassName('md')
    expect(cls).toContain('font-sans')
    expect(cls).toContain('normal-case')
    expect(cls).toContain('tracking-normal')
    expect(cls).toContain('rounded-full')
  })

  it('marks every badge with its size class for the layout guard', () => {
    const primitives = files.find(([p]) => p.endsWith('/src/components/ui/primitives.tsx'))?.[1] ?? ''
    expect(primitives).toContain('<span data-badge={resolved}')
    expect(primitives).toContain('data-badge="sm"') // Count
  })

  it('never asks for the retired `lg` size', () => {
    const offenders = files.filter(([, text]) => /<Badge\b[^>]*\bsize=["']lg["']/.test(text)).map(([p]) => p)
    expect(offenders).toEqual([])
  })

  it('draws no pill by hand', () => {
    const offenders: string[] = []
    for (const [path, text] of files) {
      if (path.endsWith('/badgeStyles.ts') || Object.keys(NOT_BADGES).some((n) => path.endsWith(`/src/${n}`))) continue
      for (const m of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const cls = m[1] ?? m[2] ?? ''
        const round = /\brounded-full\b/.test(cls)
        const small = /\btext-(xs|\[1[0-3](\.5)?px\])/.test(cls)
        const padded = /\bpx-(1|1\.5|2|2\.5)\b/.test(cls)
        if (round && small && padded) offenders.push(`${path}: ${cls.slice(0, 90)}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
