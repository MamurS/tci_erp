/**
 * «Скачать PDF» where no preview is on screen (the submission's versions, the
 * company card): the offer is rendered on click — the renderer is loaded on
 * demand — into a hidden sandboxed frame, whose print dialog the browser
 * opens; the person picks «Save as PDF». The PDF is exactly the document of
 * the preview.
 */

import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { OfferRenderInput } from './kp/input'
import { OfferFrame } from './OfferFrame'
import { printOfferFrame } from './printOfferFrame'
import type { OfferDocument } from './useOfferDocument'

export function useOfferPrinter(onError?: (error: unknown) => void): {
  print: (load: () => Promise<OfferRenderInput | null>) => void
  busy: boolean
  frame: ReactNode
} {
  const [doc, setDoc] = useState<OfferDocument | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLIFrameElement>(null)

  const print = useCallback(
    (load: () => Promise<OfferRenderInput | null>) => {
      setBusy(true)
      void Promise.all([load(), import('./useOfferDocument')])
        .then(([input, { buildDocument }]) => {
          const built = buildDocument(input)
          if (!built) throw new Error('offer_document_missing')
          setDoc(built)
        })
        .catch((e: unknown) => {
          setBusy(false)
          onError?.(e)
        })
    },
    [onError],
  )

  const frame = doc ? (
    <OfferFrame
      ref={ref}
      hidden
      title={doc.title}
      html={doc.html}
      onLoad={() => {
        void printOfferFrame(ref.current)
          .catch((e: unknown) => onError?.(e))
          .finally(() => {
            setBusy(false)
            setDoc(null)
          })
      }}
      style={{ position: 'fixed', left: -10_000, top: 0, width: 794, height: 1123, border: 0 }}
    />
  ) : null

  return { print, busy, frame }
}
