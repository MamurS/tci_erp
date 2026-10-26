/**
 * Focus rings for keyboard focus only (focusSource.ts, index.css).
 *
 * - The tracker: a click focuses as `pointer`, and a key pressed while the
 *   focus stays put (the Agenda's J/K/T) does not turn the ring on; a key
 *   that MOVES the focus (Tab, arrows, J/K focusing a row) does.
 * - The wiring: index.css narrows the `focus-visible` variant and main.tsx
 *   installs the tracker.
 * - The sweep: no `focus:` utility anywhere in src/ outside the allow-list
 *   below — a focus style is `focus-visible:`, so a mouse click never lights
 *   it. Text fields are the exception, on purpose.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import MAIN from '../main.tsx?raw'
import { FOCUS_SOURCE_ATTR, trackFocusSource } from './focusSource'

// Vite hands a stylesheet to vitest as an empty module: read it from disk.
const CSS = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

const SOURCES: Record<string, string> = {
  ...(import.meta.glob(['../**/*.tsx', '../**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<
    string,
    string
  >),
  '../index.css': CSS,
}

/** Files allowed a `focus:` utility, and why. */
const ALLOWED: Record<string, string> = {
  // Text fields (input / select / textarea, the date, amount and combobox
  // inputs): the ring shows where typing goes, on EVERY focus, the mouse's
  // included — `:focus-visible` matches them on a click anyway.
  '../components/ui/primitives.tsx': 'CONTROL_CLASSES: the text-field ring',
  '../components/ui/DateInput.tsx': 'a text field',
  '../components/ui/AmountInput.tsx': 'a text field',
  '../components/ui/Combobox.tsx': 'a text field',
  '../components/layout/GlobalSearch.tsx': 'the top-bar search: a text field',
  // `focus:outline-none` only: a menu item's indicator is its highlight,
  // which is `focus-visible:`.
  '../components/ui/ActionsMenu.tsx': 'focus:outline-none on menu items (their highlight is focus-visible)',
}

const FOCUS_UTILITY = /(?<![\w-])focus:[\w[\]/.-]+/g

function fakeDocument() {
  const attrs = new Map<string, string>()
  const target = new EventTarget() as EventTarget & { documentElement: Pick<Element, 'getAttribute' | 'setAttribute'> }
  target.documentElement = {
    getAttribute: (name: string) => attrs.get(name) ?? null,
    setAttribute: (name: string, value: string) => void attrs.set(name, value),
  }
  const fire = (type: string, key?: string) => target.dispatchEvent(Object.assign(new Event(type), key ? { key } : {}))
  return { doc: target as unknown as Document, source: () => attrs.get(FOCUS_SOURCE_ATTR), fire }
}

describe('focus source', () => {
  it('starts as keyboard (a focus before any interaction shows its ring)', () => {
    const { doc, source } = fakeDocument()
    const stop = trackFocusSource(doc)
    expect(source()).toBe('keyboard')
    stop()
  })

  it('a click focuses as pointer, and a later key that leaves the focus alone keeps it so', () => {
    const { doc, source, fire } = fakeDocument()
    const stop = trackFocusSource(doc)
    fire('pointerdown')
    fire('focusin')
    expect(source()).toBe('pointer')
    fire('keydown', 'j') // the Agenda's J: no focus change on a segment
    expect(source()).toBe('pointer')
    stop()
  })

  it('a key that moves the focus shows the ring; a modifier alone does not count', () => {
    const { doc, source, fire } = fakeDocument()
    const stop = trackFocusSource(doc)
    fire('pointerdown')
    fire('focusin')
    fire('keydown', 'Shift')
    fire('focusin')
    expect(source()).toBe('pointer')
    fire('keydown', 'Tab')
    fire('focusin')
    expect(source()).toBe('keyboard')
    stop()
  })

  it('a script moving the focus right after a click follows the click (Chrome’s rule)', () => {
    const { doc, source, fire } = fakeDocument()
    const stop = trackFocusSource(doc)
    fire('keydown', 'Tab')
    fire('focusin')
    fire('pointerdown')
    fire('focusin') // a menu focusing its first item
    expect(source()).toBe('pointer')
    stop()
  })
})

describe('focus ring wiring', () => {
  it('index.css narrows focus-visible to non-pointer focus and silences the browser outline under pointer', () => {
    expect(CSS).toContain(
      "@custom-variant focus-visible (&:focus-visible:where(:root:not([data-focus-source='pointer']) *));",
    )
    expect(CSS).toContain(":root[data-focus-source='pointer']")
  })

  it('main.tsx installs the tracker', () => {
    expect(MAIN).toMatch(/^trackFocusSource\(\)$/m)
  })

  it('no `focus:` utility outside the allow-list (use `focus-visible:`)', () => {
    const offenders: string[] = []
    for (const [path, text] of Object.entries(SOURCES)) {
      if (path.endsWith('.test.ts') || path in ALLOWED) continue
      const hits = text.match(FOCUS_UTILITY)
      if (hits) offenders.push(`${path}: ${[...new Set(hits)].join(' ')}`)
    }
    expect(offenders).toEqual([])
  })

  it('every allow-listed file still needs its entry', () => {
    for (const path of Object.keys(ALLOWED)) {
      expect(SOURCES[path], path).toBeDefined()
      expect(SOURCES[path]!.match(FOCUS_UTILITY), `${path} no longer uses focus: — drop it from ALLOWED`).not.toBeNull()
    }
  })
})
