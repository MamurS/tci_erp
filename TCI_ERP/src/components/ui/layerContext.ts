/** Which overlay layer the component tree is inside (Overlay.tsx). */
import { createContext } from 'react'

import type { OverlayLayer } from './layers'

export const ParentLayer = createContext<OverlayLayer | null>(null)
