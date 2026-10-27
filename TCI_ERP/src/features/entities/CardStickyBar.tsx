/**
 * The company card's sticky header (owner, 2026-10-27): the section tabs
 * («Обзор · Анализ · …») stay under the top bar while the card scrolls, and
 * once the hero band has scrolled away a slim navy bar above them names the
 * company — flag, name, grade — so the reader always knows whose figures
 * they are. The hero's tiles scroll away as before.
 *
 * Nothing moves when the bar appears: it is always there, three rem tall,
 * laid over the space the hero leaves at its foot (its bottom padding and
 * margin), transparent until the tabs stick. The container's height is
 * published as `--card-sticky-h`, under which the financial sheets stick
 * their own rows (FinancialsTab, StickyTableFrame).
 */

import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

/** The same edge-to-edge bleed as the hero band (HeroBand `app`). */
const BLEED = '-mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8'

export function CardStickyBar({
  name,
  onHeight,
  children,
}: {
  /** The compact name: flag, name, grade. */
  name: ReactNode
  /** The container's height in px, for the rows that stick under it. */
  onHeight: (px: number) => void
  /** The section tabs. */
  children: ReactNode
}) {
  const sentinel = useRef<HTMLDivElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)

  useLayoutEffect(() => {
    const el = sentinel.current
    if (!el) return
    // The top bar is 4rem of the ROOT font size (the zoom), so measured.
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 4 * rootPx + 1),
      { rootMargin: `-${4 * rootPx}px 0px 0px 0px` },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const el = bar.current
    if (!el) return
    const measure = () => onHeight(el.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [onHeight])

  return (
    <>
      {/* Zero tall; its negative margin lays the bar over the hero's foot. */}
      <div ref={sentinel} aria-hidden className="-mt-12 h-0" />
      <div ref={bar} data-card-sticky className="sticky top-16 z-30">
        <div
          aria-hidden={!stuck}
          className={`${BLEED} flex h-12 items-center gap-3 bg-accent-900 text-white transition-opacity duration-[var(--duration-fast-02)] ${
            stuck ? 'opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          {name}
        </div>
        <div className={`${BLEED} bg-canvas`}>{children}</div>
      </div>
    </>
  )
}
