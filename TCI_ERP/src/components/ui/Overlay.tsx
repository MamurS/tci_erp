/**
 * The overlay components (layers.ts says why): `Portal` renders an overlay
 * on `document.body` on one layer of the z-index scale; `LayerScope` marks a
 * part of the shell that is itself a layer without being portalled (the
 * sidebar peeking over the page), so what opens inside it goes above it.
 * The hooks that place, dismiss and trap focus are in overlayHooks.ts.
 */

import { useContext } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { ParentLayer } from './layerContext'
import { strongerLayer } from './layers'
import type { OverlayLayer } from './layers'

/** What opens inside `children` is drawn above `layer`. */
export function LayerScope({ layer, children }: { layer: OverlayLayer; children: ReactNode }) {
  const parent = useContext(ParentLayer)
  return (
    <ParentLayer.Provider value={strongerLayer(layer, parent)}>{children}</ParentLayer.Provider>
  )
}

/**
 * An overlay's content on `document.body`, outside every ancestor that could
 * clip it or become its containing block. React context, events and focus
 * still follow the component tree.
 */
export function Portal({ layer, children }: { layer: OverlayLayer; children: ReactNode }) {
  const parent = useContext(ParentLayer)
  if (typeof document === 'undefined') return null
  return createPortal(
    <ParentLayer.Provider value={strongerLayer(layer, parent)}>{children}</ParentLayer.Provider>,
    document.body,
  )
}
