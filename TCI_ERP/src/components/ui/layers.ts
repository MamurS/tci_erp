/**
 * Overlays (bug 2026-11-03: «Запросить организацию» from the top-bar search
 * opened inside the top bar). The top bar has `backdrop-filter`, and an
 * element with `backdrop-filter`, `filter` or `transform` becomes the
 * containing block of every `position: fixed` descendant — so a dialog
 * rendered inside it was sized to the 64 px bar, its backdrop covered the bar
 * only and the dialog was cut off at the bar's bottom edge. The same happened
 * anywhere an ancestor had one of those properties or `overflow: hidden`.
 *
 * The rule since: every overlay is rendered through `Portal` (Overlay.tsx) to
 * `document.body`, wherever it is opened from, and sits on ONE layer of the
 * z-index scale below (DESIGN.md «Layers»). This module is the pure part —
 * the scale and where an anchored popover goes — and is unit-tested.
 */

/** The z-index scale, lowest first. The values live in index.css as
 * `--z-<layer>`; `layers.test.ts` keeps the two in step. */
export const LAYERS = [
  'base',
  'raised',
  'sticky',
  'dropdown',
  'drawer',
  'modal',
  'toast',
  'tour',
] as const
export type Layer = (typeof LAYERS)[number]

/** The layers an overlay may be portalled on. */
export type OverlayLayer = 'dropdown' | 'drawer' | 'modal' | 'toast' | 'tour'

export const Z_VALUES: Record<Layer, number> = {
  base: 0,
  raised: 10,
  sticky: 20,
  dropdown: 30,
  drawer: 40,
  modal: 50,
  toast: 60,
  tour: 70,
}

function rank(layer: Layer): number {
  return LAYERS.indexOf(layer)
}

/** The stronger of two layers (null = none). */
export function strongerLayer(a: OverlayLayer, b: OverlayLayer | null): OverlayLayer {
  return b && rank(b) > rank(a) ? b : a
}

/**
 * The z-index of an overlay on `layer` opened from inside an overlay on
 * `parent`: its own layer, or — for a popover opened in a dialog or a drawer
 * (a company picker in a form) — just above that parent, so it is never drawn
 * under the dialog that opened it.
 */
export function zIndexFor(layer: OverlayLayer, parent: OverlayLayer | null): string {
  if (parent && rank(parent) > rank(layer)) return `calc(var(--z-${parent}) + 1)`
  return `var(--z-${layer})`
}

export interface AnchorRect {
  top: number
  bottom: number
  left: number
  right: number
  width: number
}

export interface Viewport {
  width: number
  height: number
}

export interface AnchorOptions {
  /** start: the popover's left edge at the anchor's; end: its right edge at
   * the anchor's; stretch: as wide as the anchor (at least `minWidth`). */
  align: 'start' | 'end' | 'stretch'
  /** Space between the anchor and the popover, px. */
  gap?: number
  /** The popover's width, px, when it is known (start / end). */
  width?: number
  /** stretch: the least width, px. */
  minWidth?: number
  /** Kept clear of the viewport's edges, px. */
  margin?: number
}

export interface AnchoredPlacement {
  top?: number
  bottom?: number
  left: number
  width?: number
  maxHeight: number
  above: boolean
}

/** Below this much room under the anchor a popover opens above it, when
 * there is more room there. */
export const FLIP_BELOW_PX = 200

/**
 * Where a popover anchored to an element goes, in viewport coordinates
 * (`position: fixed`): under the anchor, or above it when the room under it
 * is short and the room above is larger; never past the viewport's edges —
 * its height is capped by the room on its side (it scrolls inside), and it is
 * moved in from the left / right edge when it would cross it.
 */
export function placeAnchored(
  anchor: AnchorRect,
  viewport: Viewport,
  options: AnchorOptions,
): AnchoredPlacement {
  const gap = options.gap ?? 8
  const margin = options.margin ?? 8
  const roomBelow = viewport.height - anchor.bottom - gap - margin
  const roomAbove = anchor.top - gap - margin
  const above = roomBelow < FLIP_BELOW_PX && roomAbove > roomBelow
  const maxWidth = Math.max(0, viewport.width - 2 * margin)

  let width: number | undefined
  let left: number
  if (options.align === 'stretch') {
    width = Math.min(maxWidth, Math.max(anchor.width, options.minWidth ?? 0))
    left = anchor.left
  } else {
    width = options.width !== undefined ? Math.min(maxWidth, options.width) : undefined
    const w = width ?? 0
    left = options.align === 'end' ? anchor.right - w : anchor.left
  }
  const w = width ?? 0
  left = Math.max(margin, Math.min(left, viewport.width - margin - w))

  const maxHeight = Math.max(0, above ? roomAbove : roomBelow)
  return above
    ? { bottom: viewport.height - anchor.top + gap, left, width, maxHeight, above }
    : { top: anchor.bottom + gap, left, width, maxHeight, above }
}

/** What is focusable inside a dialog, in tab order. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/**
 * Tab inside a dialog: where focus goes from `index` (−1 = the dialog itself)
 * among `count` focusable elements — round from the last to the first, and
 * from the first back to the last with Shift. Null: nothing to focus.
 */
export function nextFocusIndex(index: number, count: number, backwards: boolean): number | null {
  if (count === 0) return null
  if (backwards) return index <= 0 ? count - 1 : index - 1
  return index < 0 || index >= count - 1 ? 0 : index + 1
}
