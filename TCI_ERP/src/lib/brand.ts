/**
 * The identity printed on screens and reports — ONE place.
 *
 * The visual language (palette, type, report layout) follows the Delcreda
 * corporate style, but the product carries a NEUTRAL name: no insurer's or
 * vendor's brand appears on a screen or a report. Change the values here to
 * re-brand every screen, the printed report header/footer and the legal
 * block at once.
 */

export interface LegalEntityBlock {
  name: string
  lines: string[]
}

export const BRAND = {
  /** Two-tone condensed wordmark: first part in process blue, second in navy. */
  wordmark: ['TCI', 'ERP'] as const,
  /** Used after "©" in the report footer. */
  copyright: 'TCI ERP',
  /** Legal block at the end of the printed report; empty renders nothing. */
  legalEntities: [] as LegalEntityBlock[],
  contact: {
    email: null as string | null,
    web: null as string | null,
  },
} as const
