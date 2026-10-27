/**
 * The frame of a financial sheet (balance sheet, P&L, ratios, cash flow,
 * risk). Its column headings stay on screen while the page scrolls (owner,
 * 2026-10-26): they stick under the top bar, the company card's sticky bar
 * (`--card-sticky-h`, EntityDetailPage) and the sheet-tab row
 * (`--fin-tabs-h`, FinancialsTab).
 *
 * The sheets are `border-separate` with no spacing: in a collapsed table
 * the borders do not travel with a sticky head, and the hairline between
 * its two rows let the body show through (owner, 2026-10-27).
 *
 * A heading can stick to the PAGE only while the frame does not scroll
 * sideways (a horizontal scroll box is a scroll container, and sticky would
 * stick inside it). So the frame scrolls sideways only when the table is
 * wider than it; a table that fits — the usual case — gets page-sticky
 * headings.
 */

import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export function StickyTableFrame({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)

  useLayoutEffect(() => {
    const frame = ref.current
    const table = frame?.querySelector('table')
    if (!frame || !table) return
    const measure = () => setOverflows(table.scrollWidth > frame.clientWidth + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    observer.observe(table)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      data-fin-frame
      className={`rounded-lg border border-slate-200 bg-white ${
        overflows
          ? 'overflow-x-auto'
          : '[&_thead]:sticky [&_thead]:top-[calc(4rem+var(--card-sticky-h,0px)+var(--fin-tabs-h,0px))] [&_thead]:z-20 [&_thead]:shadow-[0_1px_0_var(--color-slate-200)]'
      }`}
    >
      {children}
    </div>
  )
}
