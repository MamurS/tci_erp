/**
 * The views of «Брошюра TCI» (?view=): the brochure itself — its versions,
 * the editor and the preview — and the media library its images come from.
 * The whole section belongs to admin and sales (navigation.ts).
 */

export const BROCHURE_VIEWS = ['brochure', 'media'] as const
export type BrochureView = (typeof BROCHURE_VIEWS)[number]

/** An unknown view falls back to the brochure. */
export function parseBrochureView(value: string | null | undefined): BrochureView {
  return (BROCHURE_VIEWS as readonly string[]).includes(value ?? '')
    ? (value as BrochureView)
    : 'brochure'
}
