/**
 * Layout rules that a type checker cannot see, checked on the source text.
 *
 * - A Card has no padding of its own (it is also the frame of flush lists and
 *   tables), so every Card states one — or `overflow-hidden`, which marks a
 *   flush container whose rows pad themselves. A bare <Card> put text on the
 *   border on ~50 screens before the October 2026 audit.
 * - A Table draws its own frame; wrapped in a padding-less Card it draws two.
 * - Dates reach the screen through format.ts, never as a sliced ISO string.
 */
import { describe, expect, it } from 'vitest'

const SOURCES = import.meta.glob('../../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const files = Object.entries(SOURCES).filter(([path]) => !path.endsWith('.test.tsx'))

describe('layout contract', () => {
  it('scans the application', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('every Card states its padding (or is a flush overflow-hidden frame)', () => {
    const offenders: string[] = []
    for (const [path, text] of files) {
      if (path.endsWith('/primitives.tsx') || path.endsWith('/detail.tsx')) continue
      for (const m of text.matchAll(/<Card\b([^>]*)>/g)) {
        const attrs = m[1] ?? ''
        const padded = /\bp[xy]?-\d|\bp-0\b|overflow-hidden/.test(attrs)
        if (!padded) offenders.push(`${path}: <Card${attrs}>`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('no Table is wrapped directly in a Card', () => {
    const offenders = files
      .filter(([, text]) => /<Card[^>]*>\s*<Table\b/.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('no ISO date is sliced for display', () => {
    const offenders: string[] = []
    for (const [path, text] of files) {
      for (const line of text.split('\n')) {
        // `.slice(0, 10)` / `.slice(0, 16)` on a timestamp, inside JSX or a
        // template — computing "today" for an <input type="date"> is fine.
        if (/(_at|_date|date|Date)\)?\.slice\(0, 1[06]\)/.test(line) && !/useState|today|toISOString/.test(line))
          offenders.push(`${path}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
