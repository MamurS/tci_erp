/**
 * The overlay hooks (layers.ts says why): `useLayerZ` gives an overlay its
 * z-index; `useAnchoredPlacement` keeps a popover beside its anchor;
 * `useFocusTrap` keeps Tab inside a dialog and gives focus back when it
 * closes; `useDismiss` closes a popover on a press outside it (its anchor and
 * its portalled body both count as inside) and on Escape.
 */

import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'

import { ParentLayer } from './layerContext'
import { FOCUSABLE_SELECTOR, nextFocusIndex, placeAnchored, zIndexFor } from './layers'
import type { AnchorOptions, AnchoredPlacement, OverlayLayer } from './layers'

/** The z-index (a CSS value) for an overlay on `layer` opened here. */
export function useLayerZ(layer: OverlayLayer): string {
  return zIndexFor(layer, useContext(ParentLayer))
}

/**
 * The fixed position of a popover anchored to `anchor`, kept up to date while
 * it is open (scrolling anywhere, resizing, the anchor moving). Null while
 * closed or before the first measure.
 */
export function useAnchoredPlacement(
  anchor: RefObject<HTMLElement | null>,
  open: boolean,
  options: AnchorOptions,
): AnchoredPlacement | null {
  const [placement, setPlacement] = useState<AnchoredPlacement | null>(null)
  const { align, gap, width, minWidth, margin } = options

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null)
      return
    }
    let frame = 0
    const measure = () => {
      const el = anchor.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const next = placeAnchored(
        { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width },
        { width: document.documentElement.clientWidth, height: window.innerHeight },
        { align, gap, width, minWidth, margin },
      )
      setPlacement((prev) =>
        prev &&
        prev.top === next.top &&
        prev.bottom === next.bottom &&
        prev.left === next.left &&
        prev.width === next.width &&
        prev.maxHeight === next.maxHeight
          ? prev
          : next,
      )
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    measure()
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    if (anchor.current) observer?.observe(anchor.current)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
      observer?.disconnect()
    }
  }, [anchor, open, align, gap, width, minWidth, margin])

  return placement
}

/** `rem` in px at the person's zoom (the root font size, uiScale.ts). */
export function remToPx(rem: number): number {
  if (typeof document === 'undefined') return rem * 16
  return rem * (Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
}

/** The style of a popover placed by `useAnchoredPlacement`. */
export function anchoredStyle(placement: AnchoredPlacement, zIndex: string): CSSProperties {
  return {
    position: 'fixed',
    zIndex,
    left: placement.left,
    ...(placement.width !== undefined ? { width: placement.width } : {}),
    maxHeight: placement.maxHeight,
    ...(placement.above ? { bottom: placement.bottom } : { top: placement.top }),
  }
}

/**
 * Closes a popover on a press outside it — outside its anchor AND outside its
 * portalled body, which is no longer the anchor's DOM descendant — and on
 * Escape (the popover's own Escape, before a dialog under it sees the key).
 */
export function useDismiss(
  open: boolean,
  refs: readonly RefObject<HTMLElement | null>[],
  onDismiss: () => void,
): void {
  const dismiss = useRef(onDismiss)
  useEffect(() => {
    dismiss.current = onDismiss
  }, [onDismiss])
  const refsRef = useRef(refs)
  useEffect(() => {
    refsRef.current = refs
  })

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (refsRef.current.some((ref) => ref.current?.contains(target))) return
      dismiss.current()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // A dialog under this popover must not close with it.
      event.preventDefault()
      event.stopImmediatePropagation()
      dismiss.current()
    }
    window.addEventListener('mousedown', onDown)
    // Capture: the popover answers Escape before a dialog's own listener.
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])
}

function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (el) =>
      !el.closest('[inert]') &&
      (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0),
  )
}

/**
 * Focus inside a dialog while it is open: it moves in when the dialog opens —
 * to what the dialog focused itself (an `autoFocus` field), else to the first
 * field of `initial`, else to the dialog — Tab and Shift+Tab go round inside
 * it, and focus returns to where it was when the dialog closes.
 */
export function useFocusTrap(
  dialog: RefObject<HTMLElement | null>,
  open: boolean,
  initial?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return
    const root = dialog.current
    if (!root) return
    const before = document.activeElement as HTMLElement | null
    if (!root.contains(document.activeElement)) {
      const first = initial?.current ? focusables(initial.current)[0] : undefined
      ;(first ?? root).focus({ preventScroll: true })
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = focusables(root)
      const at = items.indexOf(document.activeElement as HTMLElement)
      const next = nextFocusIndex(at, items.length, event.shiftKey)
      event.preventDefault()
      if (next === null) root.focus({ preventScroll: true })
      else items[next]?.focus()
    }
    root.addEventListener('keydown', onKey)
    return () => {
      root.removeEventListener('keydown', onKey)
      if (before && before !== document.body && document.contains(before))
        before.focus({ preventScroll: true })
    }
  }, [dialog, open, initial])
}
