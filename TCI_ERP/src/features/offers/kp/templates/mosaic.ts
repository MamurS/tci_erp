/**
 * The geometric mosaic of the TCI brochure: square tiles of quarter discs,
 * leaves, half discs, dots, rings and rising bars in the brand palette,
 * drawn as inline SVG — no photograph, no external image, nothing that
 * needs a licence. Deterministic: the same call always draws the same
 * picture, so the template hash covers it.
 */

import { C } from './shared'

type Shape = 'leaf' | 'leafR' | 'qTL' | 'qTR' | 'qBL' | 'qBR' | 'half' | 'halfTop' | 'dot' | 'ring' | 'bars' | 'plain'

/** [shape, background, foreground] */
export type Tile = readonly [Shape, string, string]

function shape(kind: Shape, fg: string): string {
  switch (kind) {
    case 'leaf':
      return `<path d="M0 100 Q0 0 100 0 Q100 100 0 100 Z" fill="${fg}"></path>`
    case 'leafR':
      return `<path d="M0 0 Q100 0 100 100 Q0 100 0 0 Z" fill="${fg}"></path>`
    case 'qTL':
      return `<path d="M0 0 L100 0 A100 100 0 0 1 0 100 Z" fill="${fg}"></path>`
    case 'qTR':
      return `<path d="M100 0 L100 100 A100 100 0 0 1 0 0 Z" fill="${fg}"></path>`
    case 'qBL':
      return `<path d="M0 100 L0 0 A100 100 0 0 1 100 100 Z" fill="${fg}"></path>`
    case 'qBR':
      return `<path d="M100 100 L0 100 A100 100 0 0 1 100 0 Z" fill="${fg}"></path>`
    case 'half':
      return `<path d="M0 100 A50 50 0 0 1 100 100 Z" fill="${fg}"></path>`
    case 'halfTop':
      return `<path d="M0 0 A50 50 0 0 0 100 0 Z" fill="${fg}"></path>`
    case 'dot':
      return `<circle cx="50" cy="50" r="17" fill="${fg}"></circle>`
    case 'ring':
      return `<circle cx="50" cy="50" r="24" fill="none" stroke="${fg}" stroke-width="11"></circle>`
    case 'bars':
      return `<rect x="20" y="58" width="15" height="24" fill="${fg}"></rect><rect x="42.5" y="40" width="15" height="42" fill="${fg}"></rect><rect x="65" y="22" width="15" height="60" fill="${fg}"></rect>`
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
          `<g transform="translate(${x * 100},${y * 100})"><rect width="101" height="101" fill="${bg}"></rect>${shape(kind, fg)}</g>`,
      ),
    )
    .join('')
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${vw} ${vh}" style="display: block; flex-shrink: 0;" aria-hidden="true">${tiles}</svg>`
}

const { navy, navyDark, blue, blueLight, orange, amber, tint2, white } = C

/** The cover: four rows of seven. */
export const COVER_TILES: readonly (readonly Tile[])[] = [
  [
    ['dot', navyDark, amber],
    ['leaf', navyDark, tint2],
    ['qBL', blueLight, blue],
    ['leafR', navy, orange],
    ['half', navyDark, blueLight],
    ['ring', navyDark, orange],
    ['qTR', navyDark, blue],
  ],
  [
    ['qTL', blue, navy],
    ['bars', navy, amber],
    ['leaf', navyDark, blue],
    ['qBR', orange, amber],
    ['leafR', tint2, blue],
    ['qBL', navy, blueLight],
    ['dot', navyDark, white],
  ],
  [
    ['halfTop', navyDark, orange],
    ['qTR', blueLight, navy],
    ['ring', navy, tint2],
    ['leaf', amber, orange],
    ['qTL', navyDark, blue],
    ['bars', blue, white],
    ['leafR', navyDark, amber],
  ],
  [
    ['leaf', navy, blueLight],
    ['dot', navyDark, orange],
    ['qBL', tint2, navy],
    ['half', navyDark, amber],
    ['qBR', blue, navyDark],
    ['ring', navy, white],
    ['qTL', orange, navy],
  ],
]

/** The contacts page: two rows of seven, a different arrangement. */
export const CONTACT_TILES: readonly (readonly Tile[])[] = [
  [
    ['leafR', navyDark, blue],
    ['dot', navy, amber],
    ['qBR', blueLight, navy],
    ['half', navyDark, orange],
    ['leaf', navy, tint2],
    ['qTL', orange, amber],
    ['ring', navyDark, blueLight],
  ],
  [
    ['bars', navyDark, blueLight],
    ['qTR', blue, navy],
    ['leafR', navyDark, orange],
    ['dot', blue, white],
    ['qBL', navyDark, blue],
    ['leaf', blueLight, navy],
    ['halfTop', navy, amber],
  ],
]
