/**
 * A drag handle between the two columns of a list + detail screen (the
 * Agenda's Triage, a contract's versions, the offer's form and preview). The
 * owner asked for the list side to be resizable (2026-10-27).
 *
 * The grid keeps its own default width (a clamp in its class) and takes the
 * person's width from `--split-w` once they drag: three columns — the left
 * pane, this handle as the gutter, the right pane — from the breakpoint up;
 * below it the handle is hidden and the panes stack. The width is kept per
 * screen in this browser only (a convenience, like the sidebar), in rem so it
 * follows the zoom; double-click, Home or the reset entry puts the default
 * back. Keyboard: ← / → move it by 1 rem (Shift: 4 rem).
 */

import { useCallback, useEffect, useState } from 'react'
import type { KeyboardEvent, PointerEvent, RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { clampSplit, rootRem } from './splitWidth'

export function SplitHandle({
  containerRef,
  rem,
  onChange,
  minRem = 16,
  maxFraction = 0.65,
  breakpoint = 'lg',
  label,
}: {
  containerRef: RefObject<HTMLElement | null>
  rem: number | null
  onChange: (rem: number | null) => void
  minRem?: number
  maxFraction?: number
  breakpoint?: 'lg' | 'xl'
  label?: string
}) {
  const { t } = useTranslation()
  const [dragging, setDragging] = useState(false)

  const measure = useCallback(() => {
    const box = containerRef.current?.getBoundingClientRect()
    const unit = rootRem()
    return { left: box?.left ?? 0, widthRem: (box?.width ?? 0) / unit, unit }
  }, [containerRef])

  const current = useCallback((): number => {
    if (rem !== null) return rem
    const first = containerRef.current?.firstElementChild as HTMLElement | null
    return (first?.getBoundingClientRect().width ?? 0) / rootRem()
  }, [containerRef, rem])

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    const { left, widthRem, unit } = measure()
    onChange(clampSplit((e.clientX - left) / unit, minRem, widthRem, maxFraction))
  }
  const stop = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setDragging(false)
    e.currentTarget.releasePointerCapture(e.pointerId)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 4 : 1
    const { widthRem } = measure()
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      const next = current() + (e.key === 'ArrowRight' ? step : -step)
      onChange(clampSplit(next, minRem, widthRem, maxFraction))
    } else if (e.key === 'Home') {
      e.preventDefault()
      onChange(null)
    }
  }

  // While dragging, the whole page shows the resize cursor and selects nothing.
  useEffect(() => {
    if (!dragging) return
    const root = document.documentElement
    const before = root.style.cursor
    root.style.cursor = 'col-resize'
    root.style.userSelect = 'none'
    return () => {
      root.style.cursor = before
      root.style.userSelect = ''
    }
  }, [dragging])

  const shown = breakpoint === 'lg' ? 'hidden lg:flex' : 'hidden xl:flex'
  const name = label ?? t('common.split.resize')
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={name}
      aria-valuenow={rem === null ? undefined : Math.round(rem)}
      title={t('common.split.hint')}
      tabIndex={0}
      data-split-handle
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onDoubleClick={() => onChange(null)}
      onKeyDown={onKeyDown}
      className={`${shown} group min-h-0 cursor-col-resize touch-none items-stretch justify-center focus-visible:outline-none`}
    >
      <span
        aria-hidden
        className={`my-2 w-1 rounded-full transition-colors group-hover:bg-accent-300 group-focus-visible:bg-accent-500 ${
          dragging ? 'bg-accent-500' : 'bg-transparent'
        }`}
      />
    </div>
  )
}
