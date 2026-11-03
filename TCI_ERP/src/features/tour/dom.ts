/**
 * Finding a step's anchor on the screen. The tour reads the DOM only through
 * `data-tour="…"` (the anchor), `data-tour-empty` (an EmptyState, or a list's
 * own empty card), `data-link-row` (a LinkRow's object) and the loading marks
 * the primitives already carry — never a CSS class.
 */

export type Rect = { top: number; left: number; width: number; height: number }

const LOADING = '[data-skeleton-row], [aria-busy="true"], .animate-spin'

function selector(anchor: string): string {
  return `[data-tour="${CSS.escape(anchor)}"]`
}

function shown(el: Element): boolean {
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0
}

/** The first element carrying the anchor that is on the page and has a size
 * (the sidebar of a hidden panel, a menu not open, has none). */
export function findAnchor(anchor: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(selector(anchor))) if (shown(el)) return el
  return null
}

/** Still loading: a skeleton row, a busy region or a spinner inside. */
export function isLoading(el: Element): boolean {
  return el.querySelector(LOADING) !== null
}

/** The list is empty: it is, or holds, a `data-tour-empty` element. */
export function isEmpty(el: Element): boolean {
  return el.hasAttribute('data-tour-empty') || el.querySelector('[data-tour-empty]') !== null
}

/** The object of the first row of a list (a LinkRow), or null. */
export function firstRowPath(el: Element): string | null {
  return el.querySelector('[data-link-row]')?.getAttribute('data-link-row') ?? null
}

/** The element's box, clipped to the viewport (a tall list is highlighted
 * where it is visible); null when nothing of it is on screen. */
export function visibleRect(el: Element): Rect | null {
  const r = el.getBoundingClientRect()
  const top = Math.max(r.top, 0)
  const left = Math.max(r.left, 0)
  const bottom = Math.min(r.bottom, window.innerHeight)
  const right = Math.min(r.right, window.innerWidth)
  if (bottom <= top || right <= left) return null
  return { top, left, width: right - left, height: bottom - top }
}

/** Polls until `find` answers, the time runs out (null) or the signal aborts. */
export function waitFor<T>(find: () => T | null, timeoutMs: number, signal: AbortSignal, everyMs = 100): Promise<T | null> {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = () => {
      if (signal.aborted) return resolve(null)
      const found = find()
      if (found !== null) return resolve(found)
      if (Date.now() - started >= timeoutMs) return resolve(null)
      window.setTimeout(tick, everyMs)
    }
    tick()
  })
}

/** Where the card goes: below the highlight, else above, else beside it,
 * else at the foot of the screen; always inside the viewport. Pure. */
export function placeCard(
  rect: Rect | null,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  gap: number,
): { top: number; left: number } {
  const margin = 16
  const clampLeft = (x: number) => Math.max(margin, Math.min(x, viewport.width - card.width - margin))
  const clampTop = (y: number) => Math.max(margin, Math.min(y, viewport.height - card.height - margin))
  if (!rect) return { top: clampTop((viewport.height - card.height) / 2), left: clampLeft((viewport.width - card.width) / 2) }
  const below = rect.top + rect.height + gap
  if (below + card.height <= viewport.height - margin) return { top: below, left: clampLeft(rect.left) }
  const above = rect.top - gap - card.height
  if (above >= margin) return { top: above, left: clampLeft(rect.left) }
  const right = rect.left + rect.width + gap
  if (right + card.width <= viewport.width - margin) return { top: clampTop(rect.top), left: right }
  const left = rect.left - gap - card.width
  if (left >= margin) return { top: clampTop(rect.top), left }
  return { top: clampTop(viewport.height - card.height - margin), left: clampLeft(rect.left) }
}
