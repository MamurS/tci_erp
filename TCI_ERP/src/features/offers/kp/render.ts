/**
 * THE renderer of a commercial offer. Pure — no DOM, no i18n instance, no
 * network: `renderOffer(params, data, ctx)` returns the document's title and
 * its pages as HTML strings, and `offerSrcdoc` wraps them into the complete
 * document the sandboxed frame shows and prints. The staff screen, the print
 * route, the submission's «Download PDF», the company card and the portal all
 * call it; a future server-side PDF would repeat it value for value.
 *
 * THE PAGE ORDER, in one place: 1 the brochure cover, 2 the offer letter (and
 * its continuation pages when the buyer list is long), then the brochure's
 * pages 2…n in their order. Without the brochure: the cover and the letter.
 * The brochure numbers its own pages; the letter pages carry no number.
 */

import { offerDocumentTitle } from '../machine'
import type { OfferData } from '../model'
import { escapeHtml, text, type DocLang } from './format'
import type { OfferParams } from './params'
import { OFFER_TEMPLATES } from './templates'
import { offerLetterPages } from './templates/offerLetter'

export interface OfferRenderContext {
  lang: DocLang
  offerNumber: string
  versionNo: number
  /** The day the offer is dated (ISO); the version's composed_at. */
  date: string
  validUntil: string
  includeBrochure: boolean
  /** Country names in the document's language, by ISO code (from
   * tci.countries); a code without a name prints as the code. */
  countries: Readonly<Record<string, string>>
}

export interface OfferRenderResult {
  title: string
  pagesHtml: string[]
  /** Index of the first letter page in pagesHtml, and how many there are. */
  letter: { index: number; count: number }
}

/** A4 at 96 dpi, and the gap between pages on screen. */
export const OFFER_PAGE_WIDTH = 794
export const OFFER_PAGE_HEIGHT = 1123
export const OFFER_PAGE_GAP = 24

export { offerDocumentTitle }

export function renderOffer(params: OfferParams, data: OfferData, ctx: OfferRenderContext): OfferRenderResult {
  const template = OFFER_TEMPLATES[params.template] ?? OFFER_TEMPLATES.tci
  const brochure = template.pages({ lang: ctx.lang, cover: params.cover, data, date: ctx.date })
  const letter = offerLetterPages({
    lang: ctx.lang,
    offerNumber: ctx.offerNumber,
    versionNo: ctx.versionNo,
    date: ctx.date,
    validUntil: ctx.validUntil,
    data,
    note: params.note,
    includeBrochure: ctx.includeBrochure,
    countries: ctx.countries,
  })
  const [cover, ...rest] = brochure
  if (cover === undefined) throw new Error('The brochure template has no pages')
  return {
    title: offerDocumentTitle(ctx.offerNumber, text(data.client?.name) ?? ''),
    pagesHtml: [cover, ...letter, ...(ctx.includeBrochure ? rest : [])],
    letter: { index: 1, count: letter.length },
  }
}

/** The document styles: the page box on screen, and the print rules — A4
 * without margins, exact colours, one page per sheet. */
const DOCUMENT_CSS = `
html, body { margin: 0; padding: 0; background: #E4EAF0; }
body { display: flex; flex-direction: column; align-items: center; gap: ${OFFER_PAGE_GAP}px; }
.page { width: ${OFFER_PAGE_WIDTH}px; height: ${OFFER_PAGE_HEIGHT}px; flex-shrink: 0; overflow: hidden; background: #FFFFFF; line-height: normal; }
.page h1, .page h2, .page h3, .page p { margin: 0; }
.page table { border-spacing: 0; }
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
@media print {
  @page { size: 210mm 297mm; margin: 0; }
  html, body { background: #FFFFFF; height: auto; }
  body { display: block; }
  .page { width: 210mm; height: 297mm; margin: 0; page-break-after: always; break-after: page; overflow: hidden; }
  .page:last-child { page-break-after: auto; break-after: auto; }
}`

/** The complete document for the sandboxed frame. No scripts: the frame is
 * sandboxed without allow-scripts, and nothing here needs one. */
export function offerSrcdoc(result: Pick<OfferRenderResult, 'title' | 'pagesHtml'>, lang: DocLang, assetBase = OFFER_TEMPLATES.tci.assetBase): string {
  const base = escapeHtml(assetBase)
  const pages = result.pagesHtml.map((p, i) => `<div class="page" data-kp-page="${i + 1}">${p}</div>`).join('\n')
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<base href="${base}">
<title>${escapeHtml(result.title)}</title>
<link rel="stylesheet" href="${base}fonts.css">
<style>${DOCUMENT_CSS}</style>
</head>
<body>
${pages}
</body>
</html>`
}
