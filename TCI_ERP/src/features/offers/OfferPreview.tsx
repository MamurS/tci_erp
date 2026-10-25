/**
 * The offer's pages stacked one under another and scaled to the column, with
 * «Страница N из M» — the staff screen's live preview and the portal's view.
 * Whatever renders here is what prints: the same frame is printed by
 * «Скачать PDF».
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { OFFER_PAGE_GAP, OFFER_PAGE_HEIGHT, OFFER_PAGE_WIDTH } from './kp/render'
import { OfferFrame } from './OfferFrame'
import type { OfferDocument } from './useOfferDocument'

export interface OfferPreviewHandle {
  frame: HTMLIFrameElement | null
}

interface OfferPreviewProps {
  doc: OfferDocument | null
  className?: string
  /** Height of the scrolling column (CSS). Without it the preview fills the
   * height its container gives it (a grid row beside the form). */
  height?: string
}

export const OfferPreview = forwardRef<OfferPreviewHandle, OfferPreviewProps>(function OfferPreview(
  { doc, className = '', height },
  ref,
) {
  const { t } = useTranslation()
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [scale, setScale] = useState(0.6)
  const [pageNo, setPageNo] = useState(1)
  useImperativeHandle(ref, () => ({
    get frame() {
      return frame.current
    },
  }))

  const pages = doc?.pageCount ?? 0
  const stack = pages * OFFER_PAGE_HEIGHT + Math.max(pages - 1, 0) * OFFER_PAGE_GAP

  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const update = () => setScale(Math.min(1, Math.max(0.2, (el.clientWidth - 32) / OFFER_PAGE_WIDTH)))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // A page count that shrinks under the current position pulls it back.
  const shown = Math.min(Math.max(pageNo, 1), Math.max(pages, 1))

  const onScroll = () => {
    const el = box.current
    if (!el) return
    const step = (OFFER_PAGE_HEIGHT + OFFER_PAGE_GAP) * scale
    setPageNo(Math.floor((el.scrollTop + el.clientHeight / 3) / step) + 1)
  }

  return (
    <section
      aria-label={t('offers.preview.label')}
      className={`flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200/90 bg-[#e4eaf0] shadow-card ${className}`}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 text-[0.7812rem] text-slate-600">
        <span>{t('offers.preview.pages', { count: pages })}</span>
        <span className="tabular-nums" aria-live="polite" data-testid="offer-page-counter">
          {pages ? t('offers.preview.pageOf', { n: shown, total: pages }) : ''}
        </span>
      </div>
      <div
        ref={box}
        onScroll={onScroll}
        className={`scrollbar-thin min-h-[30rem] overflow-x-hidden overflow-y-auto p-4 ${height ? '' : 'h-0 flex-1'}`}
        style={height ? { height } : undefined}
      >
        {doc && (
          <div className="mx-auto" style={{ width: OFFER_PAGE_WIDTH * scale, height: stack * scale }}>
            <OfferFrame
              ref={frame}
              title={doc.title}
              html={doc.html}
              className="block origin-top-left border-0 bg-transparent"
              style={{ width: OFFER_PAGE_WIDTH, height: stack, transform: `scale(${scale})` }}
            />
          </div>
        )}
      </div>
    </section>
  )
})
