/** The brochure templates a commercial offer is built on. One today (TCI);
 * a second product brochure would be a second entry with its own pages. */

import type { DocLang } from '../format'
import { OFFER_COVERS, type OfferCover, type OfferTemplateId } from '../params'
import { TCI_PAGE_COUNT, tciBrochurePages, type BrochureContext } from './tci'
import { TCI_BROCHURE_VERSION } from './tciTexts'

export interface OfferTemplate {
  id: OfferTemplateId
  name: string
  version: string
  /** Approved by the owner: the texts are hash-pinned (tci.test.ts). */
  approved: boolean
  languages: readonly DocLang[]
  covers: readonly OfferCover[]
  /** Brochure pages; the cover is the first, the offer letter goes after it. */
  pageCount: number
  pages: (ctx: BrochureContext) => string[]
  /** Static files (fonts.css, fonts/) relative to the site root. */
  assetBase: string
}

export const OFFER_TEMPLATES: Readonly<Record<OfferTemplateId, OfferTemplate>> = {
  tci: {
    id: 'tci',
    name: 'TCI',
    version: TCI_BROCHURE_VERSION,
    approved: true,
    languages: ['ru', 'en', 'uz'],
    covers: OFFER_COVERS,
    pageCount: TCI_PAGE_COUNT,
    pages: tciBrochurePages,
    assetBase: '/kp/tci/',
  },
}
