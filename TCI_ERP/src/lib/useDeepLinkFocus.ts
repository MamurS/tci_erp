/** Bring the part of a screen a deep link points at into view.
 *
 * The Agenda sends a person to the screen where a task is done
 * (`/limits/:id?focus=decision`, `/requests/:id?focus=sales-window` …). The
 * screen marks the section with an `id` — on a wrapper with no look of its
 * own, so the page is unchanged without the link — and this hook waits for
 * that element to exist (the data behind it usually arrives after the first
 * render), scrolls it to the top, and rings it for a moment so the eye lands
 * on it.
 *
 * Deliberately forgiving: when the section never renders (the person may not
 * act on it, or the object moved on to a status that does not show it) the
 * hook gives up quietly and the screen is exactly what it would have been.
 * With no target it does nothing at all.
 */

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/** Clears the sticky header (h-16) when the target is scrolled to the top.
 * Put it on every element a deep link targets. */
export const DEEP_LINK_SCROLL_MARGIN = 'scroll-mt-20'

// The highlight is a ring that fades: the colour goes transparent first (the
// transition makes that a fade), then the classes are removed altogether.
// Literal class names, so Tailwind generates them.
const RING = ['ring-2', 'ring-accent-300', 'transition-shadow', 'duration-700']
const RING_FADE = 'ring-transparent'
const HOLD_MS = 2000
const FADE_MS = 700

/** How long a section may take to appear before the link is given up on. */
const WAIT_MS = 8000

const FIELD_SELECTOR = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])'

interface Options {
  /** Hold off until the content ABOVE the target has loaded, so a late
   * section above it cannot push the target away after the scroll. */
  ready?: boolean
  /** Scroll the target to the top of the viewport. Default true. */
  scroll?: boolean
  /** Ring the target for ~2 s. Default true. */
  highlight?: boolean
  /** Give keyboard focus to the target's first enabled field. */
  focusField?: boolean
}

export function useDeepLinkFocus(targetId: string | null, options: Options = {}): void {
  const { ready = true, scroll = true, highlight = true, focusField = false } = options
  const { key: locationKey } = useLocation()
  // One landing per navigation: re-renders must not scroll the page back.
  const handled = useRef<string | null>(null)

  useEffect(() => {
    if (!targetId || !ready) return
    const landing = `${locationKey}:${targetId}`
    if (handled.current === landing) return

    let frame = 0
    let observer: MutationObserver | null = null
    let giveUp = 0

    const land = (el: HTMLElement) => {
      handled.current = landing
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
      if (scroll) el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
      if (focusField) el.querySelector<HTMLElement>(FIELD_SELECTOR)?.focus({ preventScroll: true })
      if (highlight) {
        el.classList.add(...RING)
        // Not cleared on unmount: they only ever touch this element's classes,
        // and leaving them pending is what lets StrictMode's re-run be a no-op.
        window.setTimeout(() => el.classList.add(RING_FADE), HOLD_MS)
        window.setTimeout(() => el.classList.remove(...RING, RING_FADE), HOLD_MS + FADE_MS)
      }
    }

    const find = (): boolean => {
      const el = document.getElementById(targetId)
      // Present AND laid out: a wrapper whose section rendered nothing yet is
      // `empty:hidden`, and is found again once its content arrives.
      if (!el || el.getClientRects().length === 0) return false
      observer?.disconnect()
      window.clearTimeout(giveUp)
      // After the frame: the layout of the render that produced it is final.
      frame = window.requestAnimationFrame(() => land(el))
      return true
    }

    if (!find()) {
      observer = new MutationObserver(() => {
        find()
      })
      observer.observe(document.body, { childList: true, subtree: true })
      giveUp = window.setTimeout(() => observer?.disconnect(), WAIT_MS)
    }

    return () => {
      observer?.disconnect()
      window.clearTimeout(giveUp)
      window.cancelAnimationFrame(frame)
    }
  }, [targetId, ready, scroll, highlight, focusField, locationKey])
}
