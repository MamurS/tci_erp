/**
 * Stubbed rows for the commercial offer tests (e2e/offers): one offer of an
 * invented prospect, its version (parameters + server-composed data) and the
 * countries reference — the shape of tci.v_commercial_offers,
 * tci.commercial_offer_versions and tci.v_client_offers. Nothing here
 * reaches any database: the network is sealed (e2e/support/network.ts).
 */

import { countryNames } from '../../src/features/offers/kp/input'
import { defaultOfferParams, type OfferParams } from '../../src/features/offers/kp/params'
import { renderOffer } from '../../src/features/offers/kp/render'
import { sampleOfferData, SAMPLE_COUNTRIES, type SampleOptions } from '../../src/features/offers/kp/sampleData'
import type { ClientOffer, OfferLang, OfferRow, OfferStatus, OfferVersion } from '../../src/features/offers/model'

export const OFFER_ID = '00000000-0000-4000-8000-0000000000a1'
export const REQUEST_ID = '00000000-0000-4000-8000-0000000000b1'
export const ENTITY_ID = '00000000-0000-4000-8000-0000000000d1'
const AUTHOR = '00000000-0000-4000-8000-000000000001'

export interface OfferFixture {
  lang: OfferLang
  status?: OfferStatus
  requestStatus?: string
  params?: Partial<OfferParams>
  sample?: SampleOptions
  /** valid_until (ISO); far ahead by default so nothing reads expired. */
  validUntil?: string
  includeBrochure?: boolean
}

export function offerRows(f: OfferFixture) {
  const status = f.status ?? 'draft'
  const data = sampleOfferData(f.sample)
  const validUntil = f.validUntil ?? '2099-12-31'
  const params: OfferParams = { ...defaultOfferParams(), ...f.params }
  const offer: OfferRow = {
    id: OFFER_ID,
    offer_number: 'KP-2026-0001',
    insurance_request_id: REQUEST_ID,
    request_number: 'IR-2026-0007',
    request_status: f.requestStatus ?? 'sales_confirmation',
    entity_id: ENTITY_ID,
    entity_name: data.client.name,
    language: f.lang,
    status,
    effective_status: status,
    valid_until: validUntil,
    published_at: status === 'draft' ? null : '2026-10-22T06:05:00Z',
    first_viewed_at: null,
    published_viewed_at: null,
    answered_at: null,
    client_comment: null,
    withdrawn_at: null,
    withdraw_reason: null,
    current_version_no: 1,
    published_version_no: status === 'draft' ? null : 1,
    versions_count: 1,
    has_portal_users: true,
    is_prospect: true,
    created_by: AUTHOR,
    created_at: '2026-10-22T06:00:00Z',
    updated_at: '2026-10-22T06:05:00Z',
  }
  const version: OfferVersion = {
    id: '00000000-0000-4000-8000-0000000000e1',
    offer_id: OFFER_ID,
    version_no: 1,
    texts: params,
    data,
    valid_until: validUntil,
    include_brochure: f.includeBrochure ?? true,
    brochure_version_id: null,
    note: null,
    author_id: AUTHOR,
    created_at: '2026-10-22T06:00:00Z',
  }
  const client: ClientOffer = {
    id: OFFER_ID,
    offer_number: offer.offer_number,
    insurance_request_id: REQUEST_ID,
    request_number: offer.request_number,
    entity_id: ENTITY_ID,
    entity_name: data.client.name,
    language: f.lang,
    status,
    effective_status: status,
    valid_until: validUntil,
    published_at: offer.published_at,
    answered_at: null,
    client_comment: null,
    version_no: 1,
    texts: params,
    data,
    include_brochure: version.include_brochure,
    brochure_version_no: null,
    brochure_content: null,
  }
  // What the document must hold: the same renderer, on the same rows.
  const expected = renderOffer(params, data, {
    lang: f.lang,
    offerNumber: offer.offer_number,
    versionNo: 1,
    date: data.composed_at,
    validUntil,
    includeBrochure: version.include_brochure,
    countries: countryNames(SAMPLE_COUNTRIES, f.lang),
  })
  return {
    offer,
    version,
    client,
    expected,
    rows: {
      v_commercial_offers: [offer],
      commercial_offer_versions: [version],
      v_client_offers: [client],
      countries: [...SAMPLE_COUNTRIES],
    } as Record<string, unknown>,
  }
}
