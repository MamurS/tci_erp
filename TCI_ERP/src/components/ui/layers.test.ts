/**
 * The overlay rules (layers.ts, Overlay.tsx, DESIGN.md «Layers»), on the
 * functions and on the source text:
 *
 * - the z-index scale in layers.ts is the one in index.css, in that order;
 * - no screen uses a bare z-index — only the scale's utilities, a component's
 *   own `z-[1]`…`z-[3]`, or a step off a layer (`z-[calc(var(--z-…)…)]`);
 * - every overlay is portalled: a file that positions something `fixed`
 *   renders it through `Portal`, and nothing calls `createPortal` but
 *   Overlay.tsx — except the shell layers listed below, with their reason.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  FLIP_BELOW_PX,
  LAYERS,
  Z_VALUES,
  nextFocusIndex,
  placeAnchored,
  strongerLayer,
  zIndexFor,
} from './layers'

const SOURCES = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
// Read from disk: vitest hands CSS imports over empty, ?raw included.
const SRC = join(__dirname, '..', '..')
const CSS = readFileSync(join(SRC, 'index.css'), 'utf8')
const STYLES: Record<string, string> = Object.fromEntries(
  (readdirSync(SRC, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.css'))
    .map((file) => [`/src/${file}`, readFileSync(join(SRC, file), 'utf8')]),
)

/** Files that place something `fixed` without a portal, and why. */
const FIXED_WITHOUT_PORTAL: Record<string, string> = {
  'components/ui/overlayHooks.ts': 'anchoredStyle positions every popover, inside a Portal',
  'components/layout/AppShell.tsx':
    'the shell: the one sidebar toggle, the hot strip and the peeking panel are layers of the shell itself (at the root, never inside a transformed box); Tab must go from the toggle straight into the panel, which a portal at the end of <body> would break. The drawer and its backdrop ARE portalled.',
  'features/offers/useOfferPrinter.tsx':
    'an off-screen print frame (left −10 000 px), not an overlay',
}

const short = (path: string) => path.replace(/^\/src\//, '')

describe('the z-index scale', () => {
  it('rises in the order of LAYERS', () => {
    const values = LAYERS.map((layer) => Z_VALUES[layer])
    expect([...values].sort((a, b) => a - b)).toEqual(values)
    expect(new Set(values).size).toBe(values.length)
  })

  it('is the scale index.css defines, with a utility per layer', () => {
    for (const layer of LAYERS) {
      expect(CSS, layer).toContain(`--z-${layer}: ${Z_VALUES[layer]};`)
      expect(CSS, layer).toContain(`@utility z-${layer} {\n  z-index: var(--z-${layer});\n}`)
    }
  })

  it('puts a popover opened inside a dialog or a drawer just above it', () => {
    expect(zIndexFor('dropdown', null)).toBe('var(--z-dropdown)')
    expect(zIndexFor('dropdown', 'modal')).toBe('calc(var(--z-modal) + 1)')
    expect(zIndexFor('dropdown', 'drawer')).toBe('calc(var(--z-drawer) + 1)')
    expect(zIndexFor('modal', 'drawer')).toBe('var(--z-modal)')
    expect(zIndexFor('tour', 'modal')).toBe('var(--z-tour)')
    expect(strongerLayer('dropdown', 'modal')).toBe('modal')
    expect(strongerLayer('modal', 'dropdown')).toBe('modal')
    expect(strongerLayer('drawer', null)).toBe('drawer')
  })
})

describe('anchored placement', () => {
  const viewport = { width: 1280, height: 720 }
  const anchor = (top: number, left: number, width = 100, height = 32) => ({
    top,
    bottom: top + height,
    left,
    right: left + width,
    width,
  })

  it('opens under the anchor, its height capped by the room left', () => {
    const p = placeAnchored(anchor(16, 400), viewport, { align: 'start', width: 256 })
    expect(p).toEqual({ top: 56, left: 400, width: 256, maxHeight: 720 - 48 - 8 - 8, above: false })
  })

  it('opens above when the room below is short and the room above larger', () => {
    const p = placeAnchored(anchor(650, 400), viewport, { align: 'start', width: 256 })
    expect(p.above).toBe(true)
    expect(p.bottom).toBe(720 - 650 + 8)
    expect(p.maxHeight).toBe(650 - 8 - 8)
    // Exactly at the threshold it stays below.
    const room = placeAnchored(anchor(720 - 32 - 8 - 8 - FLIP_BELOW_PX, 400), viewport, {
      align: 'start',
    })
    expect(room.above).toBe(false)
  })

  it('never crosses the left or right edge', () => {
    expect(placeAnchored(anchor(16, 1250, 24), viewport, { align: 'start', width: 256 }).left).toBe(
      1280 - 8 - 256,
    )
    expect(placeAnchored(anchor(16, 4, 24), viewport, { align: 'end', width: 256 }).left).toBe(8)
    expect(placeAnchored(anchor(16, 1000, 200), viewport, { align: 'end', width: 256 }).left).toBe(
      1200 - 256,
    )
  })

  it('stretches to the anchor, at least the least width, at most the viewport', () => {
    expect(
      placeAnchored(anchor(16, 300, 500), viewport, { align: 'stretch', minWidth: 352 }).width,
    ).toBe(500)
    expect(
      placeAnchored(anchor(16, 300, 200), viewport, { align: 'stretch', minWidth: 352 }).width,
    ).toBe(352)
    expect(placeAnchored(anchor(16, 0, 2000), viewport, { align: 'stretch' }).width).toBe(1280 - 16)
  })
})

describe('focus inside a dialog', () => {
  it('goes round with Tab and Shift+Tab', () => {
    expect(nextFocusIndex(-1, 3, false)).toBe(0)
    expect(nextFocusIndex(0, 3, false)).toBe(1)
    expect(nextFocusIndex(2, 3, false)).toBe(0)
    expect(nextFocusIndex(0, 3, true)).toBe(2)
    expect(nextFocusIndex(-1, 3, true)).toBe(2)
    expect(nextFocusIndex(2, 3, true)).toBe(1)
    expect(nextFocusIndex(0, 0, false)).toBeNull()
  })
})

describe('the overlay rules on the source', () => {
  const files = Object.entries(SOURCES).map(([path, text]) => [short(path), text] as const)

  it('scans the application', () => {
    expect(files.length).toBeGreaterThan(200)
    expect(Object.keys(STYLES).length).toBeGreaterThan(1)
  })

  it('uses no bare z-index', () => {
    const offenders: string[] = []
    for (const [path, text] of files) {
      for (const m of text.matchAll(/(?<![\w-])z-(\d+|\[[^\]]*\])(?![\w-])/g)) {
        const value = m[1] ?? ''
        if (/^\[[123]\]$/.test(value) || /^\[calc\(var\(--z-[a-z]+\)_[+-]_\d\)\]$/.test(value))
          continue
        offenders.push(`${path}: z-${value}`)
      }
      for (const m of text.matchAll(/zIndex:\s*(\d+)/g)) offenders.push(`${path}: zIndex ${m[1]}`)
    }
    for (const [path, text] of Object.entries(STYLES)) {
      for (const m of text.matchAll(/z-index:\s*(-?\d+)/g))
        offenders.push(`${short(path)}: z-index ${m[1]}`)
    }
    expect(offenders).toEqual([])
  })

  it('portals every fixed overlay', () => {
    const offenders: string[] = []
    for (const [path, text] of files) {
      if (path in FIXED_WITHOUT_PORTAL) continue
      // Generated documents (an offer's HTML) are not the app's DOM.
      if (path.includes('/kp/templates/')) continue
      const fixed =
        /className=\{?[`'"][^`'"]*(?<![\w-])fixed(?![\w-])/.test(text) ||
        /position:\s*['"]fixed['"]/.test(text)
      if (fixed && !/<Portal\b/.test(text)) offenders.push(path)
    }
    expect(offenders).toEqual([])
  })

  it('calls createPortal only in Overlay.tsx', () => {
    const offenders = files.filter(
      ([path, text]) => path !== 'components/ui/Overlay.tsx' && /\bcreatePortal\b/.test(text),
    )
    expect(offenders.map(([path]) => path)).toEqual([])
  })

  it('lists only files that still need the exemption', () => {
    for (const path of Object.keys(FIXED_WITHOUT_PORTAL)) {
      const text = files.find(([p]) => p === path)?.[1]
      expect(text, path).toBeDefined()
    }
  })
})
