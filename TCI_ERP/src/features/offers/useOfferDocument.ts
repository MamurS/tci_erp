/** The offer document a screen shows: rendered from its inputs (kp/render)
 * and debounced, so typing a note does not re-lay the frame on every key. */

import { useEffect, useMemo, useState } from 'react'

import type { OfferRenderInput } from './kp/input'
import { offerSrcdoc, renderOffer } from './kp/render'

export interface OfferDocument {
  title: string
  html: string
  pageCount: number
}

/** The document for an input, rebuilt `delay` ms after the input last
 * changed (the first one at once): typing a note does not re-lay the frame
 * on every key. */
export function useOfferDocument(input: OfferRenderInput | null, delay = 200): OfferDocument | null {
  const key = useMemo(() => (input ? JSON.stringify(input) : ''), [input])
  const [state, setState] = useState(() => ({ key, doc: buildDocument(input) }))
  useEffect(() => {
    if (state.key === key) return
    const handle = window.setTimeout(() => setState({ key, doc: buildDocument(input) }), state.doc ? delay : 0)
    return () => window.clearTimeout(handle)
    // `key` stands for the input's content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, state.key])
  return state.doc
}

export function buildDocument(input: OfferRenderInput | null): OfferDocument | null {
  if (!input) return null
  const r = renderOffer(input.params, input.data, input.ctx)
  return { title: r.title, html: offerSrcdoc(r, input.ctx.lang), pageCount: r.pagesHtml.length }
}

