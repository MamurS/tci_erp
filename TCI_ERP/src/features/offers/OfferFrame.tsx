/**
 * THE ONLY PLACE an HTML string is put on screen (DESIGN.md «Commercial
 * offers»): the commercial offer document, built by kp/render.ts with every
 * dynamic value escaped, shown in an iframe sandboxed WITHOUT allow-scripts —
 * nothing inside can run, and the document's styles never mix with the app's.
 * `allow-same-origin` lets the frame load /kp/tci/fonts.css and lets the page
 * call print() on it; `allow-modals` permits the print dialog. ESLint refuses
 * `srcDoc` and `dangerouslySetInnerHTML` everywhere else.
 */

import { forwardRef } from 'react'
import type { CSSProperties } from 'react'

export interface OfferFrameProps {
  /** A complete document from offerSrcdoc(). */
  html: string
  title: string
  className?: string
  style?: CSSProperties
  onLoad?: () => void
  /** A frame only used for printing: out of sight and out of the tab order. */
  hidden?: boolean
}

export const OfferFrame = forwardRef<HTMLIFrameElement, OfferFrameProps>(function OfferFrame(
  { html, title, className, style, onLoad, hidden },
  ref,
) {
  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-same-origin allow-modals"
      srcDoc={html}
      referrerPolicy="no-referrer"
      className={className}
      style={style}
      onLoad={onLoad}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      data-offer-frame=""
    />
  )
})
