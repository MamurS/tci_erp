/**
 * From a stored offer to the renderer's inputs — the same for every face
 * (staff screen, print route, submission, company card, portal). Everything
 * comes from the offer row and the version: its parameters, its data, its
 * validity and brochure flag; nothing is taken from the screen around it.
 */

import type { ClientOffer, OfferData, OfferLang, OfferRow, OfferVersion } from '../model'
import { parseOfferParams, type OfferParams } from './params'
import type { OfferRenderContext } from './render'

/** A row of tci.countries (entities/api CountryRow), as far as names go. */
export interface CountryRow {
  code: string
  name_en: string
  name_ru: string
  name_uz: string
}

export interface OfferRenderInput {
  params: OfferParams
  data: OfferData
  ctx: OfferRenderContext
}

/** Country names in the document's language, by ISO code. */
export function countryNames(rows: readonly CountryRow[] | undefined, lang: OfferLang): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows ?? []) {
    const name = lang === 'ru' ? r.name_ru : lang === 'uz' ? r.name_uz : r.name_en
    if (name) out[r.code] = name
  }
  return out
}

/** A staff view of one version (the latest, or any earlier one). */
export function staffRenderInput(
  offer: Pick<OfferRow, 'offer_number' | 'language'>,
  version: Pick<OfferVersion, 'version_no' | 'texts' | 'data' | 'valid_until' | 'include_brochure'>,
  countries: readonly CountryRow[] | undefined,
  /** Unsaved parameters on the editing screen; the stored ones otherwise. */
  override?: Partial<Pick<OfferParams, 'cover' | 'note'>> & { validUntil?: string; includeBrochure?: boolean },
): OfferRenderInput {
  const stored = parseOfferParams(version.texts)
  return {
    params: { ...stored, ...(override?.cover ? { cover: override.cover } : {}), ...(override?.note !== undefined ? { note: override.note } : {}) },
    data: version.data,
    ctx: {
      lang: offer.language,
      offerNumber: offer.offer_number,
      versionNo: version.version_no,
      date: version.data?.composed_at ?? '',
      validUntil: override?.validUntil ?? version.valid_until,
      includeBrochure: override?.includeBrochure ?? version.include_brochure,
      countries: countryNames(countries, offer.language),
    },
  }
}

/** The portal: the PUBLISHED version only (tci.v_client_offers). Null when
 * the offer was withdrawn (the view then returns no content). */
export function clientRenderInput(offer: ClientOffer, countries: readonly CountryRow[] | undefined): OfferRenderInput | null {
  if (!offer.data || !offer.version_no) return null
  return {
    params: parseOfferParams(offer.texts),
    data: offer.data,
    ctx: {
      lang: offer.language,
      offerNumber: offer.offer_number,
      versionNo: offer.version_no,
      date: offer.data.composed_at ?? '',
      validUntil: offer.valid_until,
      includeBrochure: offer.include_brochure ?? true,
      countries: countryNames(countries, offer.language),
    },
  }
}
