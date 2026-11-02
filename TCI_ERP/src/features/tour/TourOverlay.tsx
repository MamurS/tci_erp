/**
 * The tour on screen (after the sister app's WelcomeTour, no library): the
 * step's anchor is cut out of a scrim with a box-shadow, a card beside it says
 * what it is — «Step n of N», Back / Next / Skip / Done. A step may open a
 * route first (and, for a form behind a list, the list's first row); a step
 * whose anchor does not appear is skipped; a list that turns out empty gets a
 * short explanation instead of an empty highlight.
 *
 * Everything is `position: fixed` in a portal on <body>: nothing under it
 * moves. Keyboard: focus goes to the card at every step, Tab stays inside it,
 * Enter or → goes on, ← goes back, Esc ends the tour (recorded as skipped).
 * With reduced motion the highlight jumps and the page scrolls instantly.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'

import { Button } from '../../components/ui'
import { findAnchor, firstRowPath, isEmpty, isLoading, placeCard, visibleRect, waitFor } from './dom'
import type { Rect } from './dom'
import { routeMatches, stepPosition } from './state'
import type { Tour, TourRecord, TourStep } from './types'

/** How long a step waits for its anchor: on the page already, or after a
 * route was opened (a lazy chunk and its data). */
const WAIT_HERE_MS = 700
const WAIT_ROUTE_MS = 6000
const WAIT_LOADED_MS = 4000
/** Space between the anchor and the cut-out's edge, and the card's gap. */
const PAD = 6
const GAP = 12
/** The sticky top bar: what scrolling leaves clear above a highlight. */
const TOP_CLEAR = 96

type Located = { el: HTMLElement | null; noData: boolean }

interface Shown extends Located {
  index: number
}

interface TourOverlayProps {
  tour: Tour
  onClose: (status: TourRecord['status'], lastStep: number) => void
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5
  )
}

const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

export function TourOverlay({ tour, onClose }: TourOverlayProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const titleId = useId()
  const textId = useId()

  const [index, setIndex] = useState(0)
  const [shown, setShown] = useState<Shown | null>(null)
  const [busy, setBusy] = useState(true)
  const [skipped, setSkipped] = useState<ReadonlySet<number>>(() => new Set())
  const [rect, setRect] = useState<Rect | null>(null)
  const [cardSize, setCardSize] = useState<{ width: number; height: number } | null>(null)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))

  const cardRef = useRef<HTMLDivElement>(null)
  const direction = useRef<1 | -1>(1)
  const closed = useRef(false)
  // The latest values for the async locator and the key handler.
  const live = useRef({ navigate, location, onClose })
  live.current = { navigate, location, onClose }

  const close = useCallback((status: TourRecord['status'], lastStep: number) => {
    if (closed.current) return
    closed.current = true
    live.current.onClose(status, lastStep)
  }, [])

  /** Moves one step in a direction; past the end the tour is done; before
   * the start (every earlier step skipped) it turns round. */
  const indexRef = useRef(0)
  const go = useCallback(
    (dir: 1 | -1) => {
      const next = indexRef.current + dir
      if (next >= tour.steps.length) {
        close('completed', tour.steps.length - 1)
        return
      }
      direction.current = next < 0 ? 1 : dir
      indexRef.current = next < 0 ? indexRef.current + 1 : next
      setIndex(indexRef.current)
    },
    [tour.steps.length, close],
  )

  // ---------------------------------------------------------------------------
  // Locate the step: open its route, wait for its anchor, judge its data.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const step = tour.steps[index]
    if (!step) return
    const controller = new AbortController()
    const { signal } = controller
    setBusy(true)

    const open = (to: string) => {
      const { location: here } = live.current
      if (!routeMatches(to, here.pathname, here.search)) {
        live.current.navigate(to)
        return true
      }
      return false
    }

    const settle = async (el: HTMLElement, current: TourStep): Promise<Located> => {
      await waitFor(() => (isLoading(el) ? null : true), WAIT_LOADED_MS, signal)
      const now = (current.anchor && findAnchor(current.anchor)) || el
      if (current.needsData && isEmpty(now)) return { el: null, noData: true }
      return { el: now, noData: false }
    }

    /** An anchor that appears after `stale` — the element the page showed
     * before a navigation, which may linger until the new page commits. */
    const appears = (anchor: string, stale: HTMLElement | null, timeoutMs: number, loaded = false) =>
      waitFor(
        () => {
          const el = findAnchor(anchor)
          return el && el !== stale && !(loaded && isLoading(el)) ? el : null
        },
        timeoutMs,
        signal,
      )

    const locate = async (current: TourStep): Promise<Located | null> => {
      const { location: here } = live.current
      const onRoute = !current.route || routeMatches(current.route, here.pathname, here.search)
      if (!current.anchor) {
        if (!onRoute) open(current.route!)
        return { el: null, noData: false }
      }
      const present = findAnchor(current.anchor)
      // Already there: on the step's route, or on the page its list opened.
      if (present && (onRoute || current.openFirst)) return settle(present, current)
      let moved = onRoute ? false : open(current.route!)
      // Another page may show an anchor of the same name until it is replaced;
      // a query change on the same page (a tab) re-renders it in place.
      const samePage = current.route ? new URL(current.route, 'http://tour.invalid').pathname === here.pathname : true
      let stale = moved && !samePage ? present : null
      if (current.openFirst) {
        const listBefore = moved && !samePage ? findAnchor(current.openFirst) : null
        const list = await appears(current.openFirst, listBefore, WAIT_ROUTE_MS, true)
        if (!list) return null
        const path = firstRowPath(list)
        if (!path) return current.needsData ? { el: null, noData: true } : null
        stale = findAnchor(current.anchor)
        live.current.navigate(path)
        moved = true
      }
      const el = await appears(current.anchor, stale, moved ? WAIT_ROUTE_MS : WAIT_HERE_MS)
      return el ? settle(el, current) : null
    }

    void locate(step).then((found) => {
      if (signal.aborted) return
      if (!found) {
        if (import.meta.env.DEV) console.debug(`[tour] ${tour.id}: step «${step.id}» skipped — no [data-tour="${step.anchor}"] on screen`)
        setSkipped((s) => new Set(s).add(index))
        go(direction.current)
        return
      }
      setSkipped((s) => {
        if (!s.has(index)) return s
        const next = new Set(s)
        next.delete(index)
        return next
      })
      setShown({ index, ...found })
      setBusy(false)
    })
    return () => controller.abort()
  }, [index, tour, go])

  // ---------------------------------------------------------------------------
  // Follow the anchor: bring it into view, then track its box.
  // ---------------------------------------------------------------------------
  const el = busy ? null : (shown?.el ?? null)
  useLayoutEffect(() => {
    if (!el) {
      setRect(null)
      return
    }
    const r = el.getBoundingClientRect()
    if (r.top < TOP_CLEAR - PAD || r.bottom > window.innerHeight - PAD) {
      const top =
        r.height + TOP_CLEAR > window.innerHeight
          ? window.scrollY + r.top - TOP_CLEAR
          : window.scrollY + r.top - (window.innerHeight - r.height) / 2
      window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion() ? 'auto' : 'smooth' })
    }
    const update = () => {
      if (!el.isConnected) return
      const next = visibleRect(el)
      setRect((prev) => (sameRect(prev, next) ? prev : next))
      setViewport((prev) =>
        prev.width === window.innerWidth && prev.height === window.innerHeight
          ? prev
          : { width: window.innerWidth, height: window.innerHeight },
      )
    }
    update()
    // Data arriving, a font loading or a sticky header can move it too.
    const timer = window.setInterval(update, 200)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [el])

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // The card's own size, for placing it (it grows with the text size).
  const hasCard = shown !== null
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const measure = () =>
      setCardSize((prev) =>
        prev && prev.width === card.offsetWidth && prev.height === card.offsetHeight
          ? prev
          : { width: card.offsetWidth, height: card.offsetHeight },
      )
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(card)
    return () => observer.disconnect()
  }, [hasCard])

  // Focus: the card at every step; back where it was when the tour ends.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    return () => {
      if (before?.isConnected) before.focus({ preventScroll: true })
    }
  }, [])
  const shownIndex = shown?.index ?? -1
  const measured = cardSize !== null
  useEffect(() => {
    if (shownIndex >= 0) cardRef.current?.focus({ preventScroll: true })
  }, [shownIndex, measured])

  const position = stepPosition(shownIndex < 0 ? 0 : shownIndex, tour.steps.length, skipped)
  const last = shownIndex === tour.steps.length - 1
  const next = useCallback(() => {
    if (busy) return
    if (last) close('completed', shownIndex)
    else go(1)
  }, [busy, last, shownIndex, close, go])
  const first = position.n <= 1
  const back = useCallback(() => {
    if (!busy && !first) go(-1)
  }, [busy, first, go])
  const skip = useCallback(() => close('skipped', Math.max(0, shownIndex)), [close, shownIndex])

  // ---------------------------------------------------------------------------
  // Keyboard: ahead of the page's own shortcuts, which stay quiet meanwhile.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const card = cardRef.current
      e.stopPropagation()
      if (e.key === 'Escape') {
        e.preventDefault()
        skip()
      } else if (e.key === 'ArrowRight' || (e.key === 'Enter' && e.target === card)) {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        back()
      } else if (e.key === 'Tab' && card) {
        const items = [...card.querySelectorAll<HTMLElement>(FOCUSABLE)]
        if (!items.length) return
        const at = items.indexOf(document.activeElement as HTMLElement)
        const to = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === -1 || at === items.length - 1 ? 0 : at + 1
        e.preventDefault()
        items[to]!.focus()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [next, back, skip])

  const step = shown ? tour.steps[shown.index] : null
  const highlight = !busy && rect !== null
  const place = placeCard(
    highlight ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD } : null,
    cardSize ?? { width: 352, height: 240 },
    viewport,
    GAP,
  )

  return createPortal(
    <div className="fixed inset-0 z-[90] print:hidden" data-testid="tour" data-tour-id={tour.id}>
      {highlight ? (
        <div
          aria-hidden
          data-tour-highlight
          className="pointer-events-none absolute rounded-lg ring-2 ring-sky-300 transition-[top,left,width,height] motion-reduce:transition-none"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + 2 * PAD,
            height: rect.height + 2 * PAD,
            boxShadow: '0 0 0 200vmax color-mix(in oklab, var(--color-scrim) 55%, transparent)',
          }}
        />
      ) : (
        <div aria-hidden className="absolute inset-0 bg-scrim/55" />
      )}
      {step && shown && (
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={textId}
          aria-busy={busy || undefined}
          tabIndex={-1}
          data-tour-step={step.id}
          className="absolute flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-pop outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          // Placed once measured; transparent (still focusable) until then.
          style={{ top: place.top, left: place.left, opacity: cardSize ? 1 : 0 }}
        >
          <div className="text-caption font-medium text-slate-500 tabular-nums">
            {t('tour.ui.step', { n: position.n, total: position.of })}
          </div>
          <h2 id={titleId} className="text-lead font-semibold text-slate-900">
            {t(step.titleKey)}
          </h2>
          <div id={textId} className="flex flex-col gap-3">
            <p className="text-body leading-relaxed text-slate-600">{t(step.textKey)}</p>
            {shown.noData && (
              <p data-tour-no-data className="rounded-md border border-info-200 bg-info-50 px-3 py-2 text-small text-slate-700">
                {t('tour.ui.noData')}
              </p>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <Button variant="ghost" size="sm" className="-ml-2" onClick={skip}>
              {t('tour.ui.skip')}
            </Button>
            <div className="flex gap-2">
              {!first && (
                <Button variant="secondary" size="sm" disabled={busy} onClick={back}>
                  {t('tour.ui.back')}
                </Button>
              )}
              <Button size="sm" disabled={busy} onClick={next}>
                {last ? t('tour.ui.done') : t('tour.ui.next')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}
