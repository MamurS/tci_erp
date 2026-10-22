/** The page-like sheet's look from the template's layout, and the anchors
 * the table of contents jumps to (pure). */

import type { CSSProperties } from 'react'

import type { DocLayout } from './model'
import { A4_PAGE } from './model'

const TWIPS_PER_MM = 56.6929

/** The sheet's CSS variables from the template's layout. */
export function sheetStyle(layout: DocLayout | null | undefined): CSSProperties {
  const page = layout?.page ?? A4_PAGE
  const mm = (tw: number) => `${(tw / TWIPS_PER_MM).toFixed(1)}mm`
  return {
    '--cd-pad-top': mm(page.top),
    '--cd-pad-right': mm(page.right),
    '--cd-pad-bottom': mm(page.bottom),
    '--cd-pad-left': mm(page.left),
    '--cd-font': layout?.font === 'Arial' || !layout?.font ? 'Arimo' : `'${layout.font}'`,
    '--cd-size': `${(layout?.sizeHalfPt ?? 21) / 2}pt`,
  } as CSSProperties
}

/** The anchor of a top-level block, for the table of contents. */
export const blockAnchor = (index: number) => `cd-b-${index}`
