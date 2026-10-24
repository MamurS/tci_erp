/**
 * The geometric mosaic of the TCI brochure: square tiles in the brand palette,
 * each carrying one flat, geometric motif of trade — a shipping container, a
 * parcel, a truck, a cargo ship, an aircraft, a pallet, a port crane, a
 * warehouse, a globe, a trade route, a barcode, an exchange of goods and an
 * anchor — drawn as inline SVG: no photograph, no external image, nothing
 * that needs a licence. A motif is cut out of its tile with the tile's own
 * colour, so every one reads in two colours like the rest of the brochure.
 * Deterministic: the same call always draws the same picture, so the
 * template hash covers it.
 */

import { C } from './shared'

type Shape =
  | 'container'
  | 'parcel'
  | 'truck'
  | 'ship'
  | 'plane'
  | 'pallet'
  | 'crane'
  | 'warehouse'
  | 'globe'
  | 'route'
  | 'barcode'
  | 'exchange'
  | 'anchor'
  | 'plain'

/** [shape, background, foreground] */
export type Tile = readonly [Shape, string, string]

function shape(kind: Shape, fg: string, bg: string): string {
  switch (kind) {
    case 'container':
      // A shipping container, side on: the box, its corrugation, the corner castings.
      return (
        `<rect x="10" y="28" width="80" height="46" fill="${fg}"></rect>` +
        [22, 34, 46, 58, 70]
          .map((x) => `<rect x="${x}" y="34" width="4" height="34" fill="${bg}"></rect>`)
          .join('') +
        `<rect x="10" y="74" width="80" height="4" fill="${fg}"></rect>`
      )
    case 'parcel':
      // A taped carton, seen from a corner.
      return (
        `<path d="M50 14 L86 31 L86 71 L50 88 L14 71 L14 31 Z" fill="${fg}"></path>` +
        `<path d="M14 31 L50 48 L86 31 M50 48 L50 88" fill="none" stroke="${bg}" stroke-width="3.5"></path>` +
        `<path d="M31 22.5 L67 39.5 L67 56" fill="none" stroke="${bg}" stroke-width="6"></path>`
      )
    case 'truck':
      // A box truck: the load box, the cab with its window, two wheels.
      return (
        `<rect x="8" y="30" width="54" height="38" fill="${fg}"></rect>` +
        `<path d="M64 42 L80 42 L92 56 L92 68 L64 68 Z" fill="${fg}"></path>` +
        `<path d="M69 47 L78 47 L85 56 L69 56 Z" fill="${bg}"></path>` +
        `<circle cx="26" cy="72" r="10" fill="${fg}" stroke="${bg}" stroke-width="3"></circle>` +
        `<circle cx="76" cy="72" r="10" fill="${fg}" stroke="${bg}" stroke-width="3"></circle>` +
        `<circle cx="26" cy="72" r="3.5" fill="${bg}"></circle><circle cx="76" cy="72" r="3.5" fill="${bg}"></circle>`
      )
    case 'ship':
      // A container ship: the hull and a stack of boxes on deck.
      return (
        `<path d="M8 60 L92 60 L80 82 L20 82 Z" fill="${fg}"></path>` +
        `<rect x="20" y="44" width="17" height="14" fill="${fg}"></rect>` +
        `<rect x="40" y="44" width="17" height="14" fill="${fg}"></rect>` +
        `<rect x="60" y="44" width="17" height="14" fill="${fg}"></rect>` +
        `<rect x="30" y="28" width="17" height="14" fill="${fg}"></rect>` +
        `<rect x="50" y="28" width="17" height="14" fill="${fg}"></rect>` +
        `<rect x="80" y="38" width="6" height="20" fill="${fg}"></rect>`
      )
    case 'plane':
      // A freighter in flight, climbing to the upper right.
      return (
        `<g transform="rotate(45 50 50)">` +
        `<rect x="44" y="10" width="12" height="80" rx="6" fill="${fg}"></rect>` +
        `<path d="M50 38 L90 58 L90 66 L50 54 L10 66 L10 58 Z" fill="${fg}"></path>` +
        `<path d="M50 76 L68 86 L68 91 L50 86 L32 91 L32 86 Z" fill="${fg}"></path>` +
        `</g>`
      )
    case 'pallet':
      // Three cartons stacked on a pallet.
      return (
        `<rect x="14" y="48" width="34" height="26" fill="${fg}"></rect>` +
        `<rect x="52" y="48" width="34" height="26" fill="${fg}"></rect>` +
        `<rect x="33" y="18" width="34" height="26" fill="${fg}"></rect>` +
        `<rect x="28" y="48" width="6" height="10" fill="${bg}"></rect>` +
        `<rect x="66" y="48" width="6" height="10" fill="${bg}"></rect>` +
        `<rect x="47" y="18" width="6" height="10" fill="${bg}"></rect>` +
        `<rect x="10" y="78" width="80" height="6" fill="${fg}"></rect>` +
        `<rect x="14" y="84" width="10" height="6" fill="${fg}"></rect>` +
        `<rect x="45" y="84" width="10" height="6" fill="${fg}"></rect>` +
        `<rect x="76" y="84" width="10" height="6" fill="${fg}"></rect>`
      )
    case 'crane':
      // A quay crane: the tower, the boom, the cable and a box on the hook.
      return (
        `<rect x="20" y="22" width="9" height="68" fill="${fg}"></rect>` +
        `<rect x="10" y="84" width="30" height="6" fill="${fg}"></rect>` +
        `<rect x="12" y="20" width="80" height="8" fill="${fg}"></rect>` +
        `<path d="M24 20 L36 8 L44 8 L32 20 Z" fill="${fg}"></path>` +
        `<rect x="70" y="28" width="3" height="26" fill="${fg}"></rect>` +
        `<rect x="57" y="54" width="29" height="18" fill="${fg}"></rect>` +
        `<rect x="64" y="58" width="3" height="10" fill="${bg}"></rect><rect x="76" y="58" width="3" height="10" fill="${bg}"></rect>`
      )
    case 'warehouse':
      // A warehouse with a roller door.
      return (
        `<path d="M10 42 L50 18 L90 42 L90 86 L10 86 Z" fill="${fg}"></path>` +
        `<rect x="30" y="50" width="40" height="36" fill="${bg}"></rect>` +
        [56, 64, 72, 80].map((y) => `<rect x="30" y="${y}" width="40" height="3" fill="${fg}"></rect>`).join('')
      )
    case 'globe':
      // The world, with its meridians and parallels.
      return (
        `<circle cx="50" cy="50" r="36" fill="${fg}"></circle>` +
        `<ellipse cx="50" cy="50" rx="15" ry="36" fill="none" stroke="${bg}" stroke-width="3.5"></ellipse>` +
        `<path d="M50 14 L50 86 M14 50 L86 50 M20 32 L80 32 M20 68 L80 68" fill="none" stroke="${bg}" stroke-width="3.5"></path>`
      )
    case 'route':
      // A trade lane: two ports joined by an arc.
      return (
        `<path d="M20 78 Q24 24 80 24" fill="none" stroke="${fg}" stroke-width="6" stroke-dasharray="10 7"></path>` +
        `<circle cx="20" cy="78" r="10" fill="${fg}"></circle><circle cx="20" cy="78" r="4" fill="${bg}"></circle>` +
        `<path d="M80 6 C90 6 96 13 96 21 C96 32 80 46 80 46 C80 46 64 32 64 21 C64 13 70 6 80 6 Z" fill="${fg}"></path>` +
        `<circle cx="80" cy="21" r="5" fill="${bg}"></circle>`
      )
    case 'barcode':
      // A shipping label's barcode.
      return [
        [16, 5], [24, 3], [30, 8], [41, 3], [47, 5], [55, 9], [67, 3], [73, 6], [82, 3],
      ]
        .map(([x, w]) => `<rect x="${x}" y="24" width="${w}" height="52" fill="${fg}"></rect>`)
        .join('')
    case 'exchange':
      // Goods out, payment back: two opposed arrows.
      return (
        `<path d="M14 36 L66 36 L66 24 L88 42 L66 60 L66 48 L14 48 Z" fill="${fg}"></path>` +
        `<path d="M86 64 L34 64 L34 52 L12 70 L34 88 L34 76 L86 76 Z" fill="${fg}"></path>`
      )
    case 'anchor':
      // A ship's anchor.
      return (
        `<circle cx="50" cy="22" r="9" fill="none" stroke="${fg}" stroke-width="6"></circle>` +
        `<rect x="46" y="30" width="8" height="54" fill="${fg}"></rect>` +
        `<rect x="32" y="38" width="36" height="7" fill="${fg}"></rect>` +
        `<path d="M18 58 Q22 86 50 86 Q78 86 82 58" fill="none" stroke="${fg}" stroke-width="8"></path>` +
        `<path d="M10 62 L18 50 L26 62 Z M74 62 L82 50 L90 62 Z" fill="${fg}"></path>`
      )
    case 'plain':
      return ''
  }
}

/** Rows of tiles, 100 units square each, scaled to `width` px. */
export function mosaic(rows: readonly (readonly Tile[])[], width: number): string {
  const cols = Math.max(...rows.map((r) => r.length))
  const vw = cols * 100
  const vh = rows.length * 100
  const height = Math.round((width * vh) / vw)
  const tiles = rows
    .flatMap((row, y) =>
      row.map(
        ([kind, bg, fg], x) =>
          `<g transform="translate(${x * 100},${y * 100})"><rect width="101" height="101" fill="${bg}"></rect>${shape(kind, fg, bg)}</g>`,
      ),
    )
    .join('')
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${vw} ${vh}" style="display: block; flex-shrink: 0;" aria-hidden="true">${tiles}</svg>`
}

const { navy, navyDark, blue, blueLight, orange, amber, tint2, white } = C

/** The cover: four rows of seven. */
export const COVER_TILES: readonly (readonly Tile[])[] = [
  [
    ['globe', navyDark, amber],
    ['container', navyDark, tint2],
    ['plane', blueLight, navy],
    ['parcel', navy, orange],
    ['route', navyDark, blueLight],
    ['anchor', navyDark, orange],
    ['truck', navyDark, blue],
  ],
  [
    ['ship', blue, navy],
    ['barcode', navy, amber],
    ['crane', navyDark, blue],
    ['pallet', orange, navyDark],
    ['exchange', tint2, blue],
    ['warehouse', navy, blueLight],
    ['parcel', navyDark, white],
  ],
  [
    ['truck', navyDark, orange],
    ['globe', blueLight, navy],
    ['container', navy, tint2],
    ['plane', amber, navyDark],
    ['ship', navyDark, blue],
    ['barcode', blue, white],
    ['crane', navyDark, amber],
  ],
  [
    ['exchange', navy, blueLight],
    ['pallet', navyDark, orange],
    ['route', tint2, navy],
    ['container', navyDark, amber],
    ['anchor', blue, navyDark],
    ['warehouse', navy, white],
    ['parcel', orange, navy],
  ],
]

/** The contacts page: two rows of seven, a different arrangement. */
export const CONTACT_TILES: readonly (readonly Tile[])[] = [
  [
    ['ship', navyDark, blue],
    ['parcel', navy, amber],
    ['route', blueLight, navy],
    ['container', navyDark, orange],
    ['globe', navy, tint2],
    ['exchange', orange, navyDark],
    ['plane', navyDark, blueLight],
  ],
  [
    ['pallet', navyDark, blueLight],
    ['truck', blue, navy],
    ['anchor', navyDark, orange],
    ['barcode', blue, white],
    ['crane', navyDark, blue],
    ['warehouse', blueLight, navy],
    ['ship', navy, amber],
  ],
]
