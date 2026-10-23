/**
 * The PARAMETERS of a commercial offer — the only thing staff choose about the
 * document («как в ДМС»: the brochure and the offer letter are a fixed,
 * approved layout; the words are the template's, the facts the database's).
 *
 * They are stored in the version's `texts` jsonb, which migration 0058 only
 * checks to be an object of at most 256 KB (tci.offer_texts_ok):
 *
 *   { kind: 'kp', template: 'tci', template_version, cover, note }
 *
 * The language, the validity date and whether the brochure is appended stay
 * where 0058 keeps them (the offer's `language`, the version's `valid_until`
 * and `include_brochure`). A version written by the retired text editor —
 * texts without `kind: 'kp'` — renders with the default parameters.
 */

import { TCI_BROCHURE_VERSION } from './templates/version'

export const OFFER_COVERS = ['white', 'navy', 'blue'] as const
export type OfferCover = (typeof OFFER_COVERS)[number]

export const OFFER_TEMPLATE_IDS = ['tci'] as const
export type OfferTemplateId = (typeof OFFER_TEMPLATE_IDS)[number]

/** The client note: the one free text of an offer, plain and short. */
export const NOTE_MAX = 600
/** Line breaks a note keeps; more would only push the letter onto a page of
 * blank lines. */
export const NOTE_MAX_BREAKS = 6

export interface OfferParams {
  kind: 'kp'
  template: OfferTemplateId
  /** The template version the parameters were saved with (informative: an
   * offer always renders with the current template). */
  template_version: string
  cover: OfferCover
  note: string
}

export const DEFAULT_COVER: OfferCover = 'white'

export function defaultOfferParams(): OfferParams {
  return { kind: 'kp', template: 'tci', template_version: TCI_BROCHURE_VERSION, cover: DEFAULT_COVER, note: '' }
}

/** A note as it is stored and printed: CRLF folded, at most NOTE_MAX_BREAKS
 * line breaks (the rest become spaces), no blank runs, at most NOTE_MAX
 * characters, trimmed. */
export function normaliseNote(value: unknown): string {
  if (typeof value !== 'string') return ''
  let breaks = 0
  const folded = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v]/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/\n/g, () => (++breaks <= NOTE_MAX_BREAKS ? '\n' : ' '))
    .replace(/ {2,}/g, ' ')
  return folded.trim().slice(0, NOTE_MAX).trim()
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The parameters of a stored version. Anything that is not a valid `kp`
 * object — the old editor's blocks, null, a damaged row — falls back to the
 * defaults field by field; it never throws. */
export function parseOfferParams(texts: unknown): OfferParams {
  const base = defaultOfferParams()
  if (!isObject(texts) || texts.kind !== 'kp') return base
  const template = (OFFER_TEMPLATE_IDS as readonly unknown[]).includes(texts.template)
    ? (texts.template as OfferTemplateId)
    : base.template
  const cover = (OFFER_COVERS as readonly unknown[]).includes(texts.cover) ? (texts.cover as OfferCover) : base.cover
  const version = typeof texts.template_version === 'string' && texts.template_version.trim() ? texts.template_version : base.template_version
  return { kind: 'kp', template, template_version: version, cover, note: normaliseNote(texts.note) }
}

/** What a save sends as `p_texts`: the parameters, stamped with the current
 * template version. */
export function paramsForSave(params: Pick<OfferParams, 'cover' | 'note'>): OfferParams {
  return { ...defaultOfferParams(), cover: params.cover, note: normaliseNote(params.note) }
}
