/**
 * The height that makes an element end at the bottom of the viewport: the
 * window's height less the element's own top (in the document, so a scrolled
 * page measures the same) and less what the page still shows below it (its
 * next sibling — the Agenda's key legend — and <main>'s bottom padding).
 * Re-measured when the window resizes or anything on the page changes size
 * (a callout appearing above, the legend changing language).
 *
 * The triage layout (TriageView) gives this height to its two panes, so
 * they end on one line and scroll inside themselves, never the page.
 */

import { useLayoutEffect, useState } from 'react'
import type { RefObject } from 'react'

export function useFillViewport(ref: RefObject<HTMLElement | null>, minimum = 448): number | null {
  const [height, setHeight] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const top = el.getBoundingClientRect().top + window.scrollY
      const next = el.nextElementSibling as HTMLElement | null
      const below = next
        ? next.getBoundingClientRect().height + parseFloat(getComputedStyle(next).marginTop || '0')
        : 0
      const main = el.closest('main')
      const padding = main ? parseFloat(getComputedStyle(main).paddingBottom || '0') : 0
      const fit = Math.floor(window.innerHeight - top - below - padding)
      setHeight(Math.max(minimum, fit))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(document.body)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [ref, minimum])
  return height
}
