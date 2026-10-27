/**
 * The mosaic behind the hero band: the brochure's trade motifs
 * (offers/kp/templates/mosaic.ts) re-coloured in the app's navy ramp, so the
 * band reads as one surface with a texture rather than a picture. A data URI
 * (`img-src data:` is allowed by the CSP), built once.
 */

import { RAMPS } from '../../design/palette'
import { mosaic } from '../../features/offers/kp/templates/mosaic'
import type { Tile } from '../../features/offers/kp/templates/mosaic'

const a = RAMPS.accent
const s = RAMPS.sky

const TILES: readonly (readonly Tile[])[] = [
  [
    ['container', a[800], s[300]],
    ['ship', a[900], s[400]],
    ['globe', a[700], s[200]],
    ['crane', a[900], s[300]],
  ],
  [
    ['plane', a[900], s[200]],
    ['parcel', a[700], s[300]],
    ['route', a[800], s[400]],
    ['truck', a[900], s[300]],
  ],
  [
    ['anchor', a[800], s[400]],
    ['warehouse', a[900], s[200]],
    ['exchange', a[700], s[300]],
    ['pallet', a[800], s[200]],
  ],
]

export const HERO_MOSAIC_URI = `data:image/svg+xml;utf8,${encodeURIComponent(
  mosaic(TILES, 480).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '),
)}`

/** The sign-in panel's mosaic: seven across, four down, the same motifs at
 * a larger scale, in the band's colours with the sky and a warm accent. */
const w = RAMPS.warning
const LOGIN_TILES: readonly (readonly Tile[])[] = [
  [
    ['globe', a[900], s[300]],
    ['container', a[800], s[200]],
    ['plane', s[600], a[900]],
    ['parcel', a[900], w[300]],
    ['route', a[800], s[300]],
    ['anchor', a[900], s[400]],
    ['truck', a[700], s[200]],
  ],
  [
    ['ship', a[700], s[300]],
    ['barcode', a[900], s[200]],
    ['crane', a[800], w[300]],
    ['pallet', s[600], a[900]],
    ['exchange', a[900], s[300]],
    ['warehouse', a[800], s[200]],
    ['parcel', a[900], s[400]],
  ],
  [
    ['truck', a[900], w[300]],
    ['globe', a[700], s[200]],
    ['container', a[900], s[300]],
    ['plane', a[800], s[200]],
    ['ship', s[600], a[900]],
    ['barcode', a[800], s[300]],
    ['crane', a[900], s[400]],
  ],
  [
    ['exchange', a[800], s[300]],
    ['pallet', a[900], s[200]],
    ['route', a[700], w[300]],
    ['container', a[900], s[300]],
    ['anchor', a[800], s[200]],
    ['warehouse', s[600], a[900]],
    ['parcel', a[900], s[300]],
  ],
]

export const LOGIN_MOSAIC_URI = `data:image/svg+xml;utf8,${encodeURIComponent(
  mosaic(LOGIN_TILES, 1400).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '),
)}`
