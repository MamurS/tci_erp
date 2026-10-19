/**
 * The identity printed on screens and reports — ONE place.
 *
 * The visual language (palette, type, report layout) follows the Delcreda
 * corporate style, but the NAME on our documents is ours: a risk report
 * issued by Mosaic carries Mosaic's wordmark and legal entity, never another
 * company's. Change the values here to re-brand every screen, the printed
 * report header/footer and the legal block at once.
 */

export interface LegalEntityBlock {
  name: string
  lines: string[]
}

export const BRAND = {
  /** Two-tone condensed wordmark: first part in process blue, second in navy. */
  wordmark: ['MOSAIC', 'TCI'] as const,
  /** Used after "©" in the report footer. */
  copyright: 'MOSAIC INSURANCE GROUP',
  /** Legal block at the end of the printed report. */
  legalEntities: [
    {
      name: 'MOSAIC INSURANCE GROUP JSC',
      lines: ['Tashkent, Republic of Uzbekistan'],
    },
  ] satisfies LegalEntityBlock[],
  contact: {
    email: null as string | null,
    web: null as string | null,
  },
} as const
