/**
 * Commercial offers (КП, migration 0058) as the screens read them.
 *
 * An offer belongs to a submission. Each version carries two halves:
 *   texts — the PARAMETERS staff chose ({ kind: 'kp', template, cover, note },
 *           kp/params.ts), the only part that comes from the browser; the
 *           document's words are the fixed, approved template («как в ДМС»);
 *   data  — what the DATABASE composed from the submission when the version
 *           was saved (tci.offer_merge_data): client, proposed terms, premium,
 *           buyer limits marked approved / indicative / declined, insurer
 *           particulars and the contact. Never a grade, an engine limit, an
 *           authority or an internal comment.
 */

export const OFFER_LANGS = ['ru', 'en', 'uz'] as const
export type OfferLang = (typeof OFFER_LANGS)[number]

export const OFFER_STATUSES = [
  'draft',
  'published',
  'viewed',
  'accepted',
  'changes_requested',
  'declined',
  'withdrawn',
] as const
export type OfferStatus = (typeof OFFER_STATUSES)[number]

/** What the screens show: the stored status, or 'expired' (derived). */
export type EffectiveOfferStatus = OfferStatus | 'expired'
export const EFFECTIVE_OFFER_STATUSES = [...OFFER_STATUSES, 'expired'] as const

/** What a version's `texts` holds: the parameters (kp/params.ts parses it;
 * a version of the retired editor holds its text blocks and renders with the
 * default parameters). */
export type OfferTexts = unknown

export type BuyerBasis = 'approved' | 'indicative' | 'declined'

export interface OfferBuyer {
  name: string
  country_code: string | null
  requested_amount: number
  requested_payment_terms_days: number | null
  basis: BuyerBasis
  offered_amount: number
  offered_payment_terms_days: number | null
  currency_code: string | null
}

export interface OfferData {
  client: {
    name: string
    legal_form: string | null
    registration_number: string | null
    country_code: string | null
    address: string | null
  }
  request: { number: string }
  terms: {
    product_structure: 'whole_turnover' | 'key_buyers' | 'single_buyer' | null
    currency_code: string | null
    insured_percentage: number | null
    max_liability_amount: number | null
    max_liability_premium_multiple: number | null
    discretionary_limit: number | null
    nql_amount: number | null
    deductible_each_loss: number | null
    aggregate_first_loss: number | null
    waiting_period_days: number | null
    max_extension_period_days: number | null
    max_payment_terms_days: number | null
    declaration_frequency: 'monthly' | 'quarterly' | null
    estimated_annual_turnover: number | null
  }
  premium: {
    rate_pct: number | null
    minimum_premium: number | null
    estimated_premium: number | null
    estimated_premium_due: number | null
    instalments: number | null
    instalment_amount: number | null
  }
  buyers: OfferBuyer[]
  insurer: {
    legal_name: string | null
    legal_form: string | null
    registration_number: string | null
    tax_id: string | null
    license_number: string | null
    license_date: string | null
    address: string | null
    phone: string | null
    email: string | null
    website: string | null
    bank_name: string | null
    bank_account: string | null
    bank_code: string | null
  } | null
  contact: { name: string | null; phone: string | null; email: string | null }
  composed_at: string
}

/** A row of tci.v_commercial_offers (staff). */
export interface OfferRow {
  id: string
  offer_number: string
  insurance_request_id: string
  request_number: string
  request_status: string
  entity_id: string
  entity_name: string
  language: OfferLang
  status: OfferStatus
  effective_status: EffectiveOfferStatus
  valid_until: string
  published_at: string | null
  first_viewed_at: string | null
  published_viewed_at: string | null
  answered_at: string | null
  client_comment: string | null
  withdrawn_at: string | null
  withdraw_reason: string | null
  current_version_no: number | null
  published_version_no: number | null
  versions_count: number
  has_portal_users: boolean
  is_prospect: boolean
  created_by: string
  created_at: string
  updated_at: string
}

/** A row of tci.commercial_offer_versions. */
export interface OfferVersion {
  id: string
  offer_id: string
  version_no: number
  texts: OfferTexts
  data: OfferData
  valid_until: string
  include_brochure: boolean
  brochure_version_id: string | null
  note: string | null
  author_id: string
  created_at: string
}

/** A row of tci.v_client_offers (portal): the PUBLISHED version only. */
export interface ClientOffer {
  id: string
  offer_number: string
  insurance_request_id: string
  request_number: string
  entity_id: string
  entity_name: string
  language: OfferLang
  status: OfferStatus
  effective_status: EffectiveOfferStatus
  valid_until: string
  published_at: string | null
  answered_at: string | null
  client_comment: string | null
  version_no: number | null
  texts: OfferTexts | null
  data: OfferData | null
  include_brochure: boolean | null
  /** The brochure version 0058 embedded at generation. The document no longer
   * prints it — the brochure is the fixed template — but the view still
   * returns the columns. */
  brochure_version_no: number | null
  brochure_content: unknown
}
