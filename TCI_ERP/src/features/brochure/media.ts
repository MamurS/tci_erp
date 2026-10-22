/**
 * The media library's rules as the browser applies them before anything is
 * sent (migration 0058, section 3 and 11). The DATABASE is what refuses — the
 * bucket's size and type limits, the storage name pattern, the alt / source /
 * licence checks on tci.media_assets — and media.test.ts reads those limits
 * from the migration text, so these mirrors cannot drift.
 */

import { BROCHURE_LANGS } from './model'
import type { BrochureLang, Localized, MediaAsset } from './model'

/** The bucket's allowed_mime_types and the media_assets.mime_type check. */
export const MEDIA_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type MediaMime = (typeof MEDIA_MIME_TYPES)[number]

/** The bucket's file_size_limit: 5 MB. */
export const MEDIA_MAX_BYTES = 5242880

/** The storage name: a fresh uuid and the extension (storage policy + check). */
export const MEDIA_PATH_PATTERN = /^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i

const EXTENSION: Record<MediaMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export function isMediaMime(type: string): type is MediaMime {
  return (MEDIA_MIME_TYPES as readonly string[]).includes(type)
}

/** `<uuid>.<ext>` — a new name per upload; an object is never replaced. */
export function mediaStoragePath(id: string, mime: MediaMime): string {
  return `${id.toLowerCase()}.${EXTENSION[mime]}`
}

/** What is wrong with a chosen file, as an i18n key, or null. */
export function fileProblem(file: { type: string; size: number }): string | null {
  if (!isMediaMime(file.type)) return 'media.errors.fileType'
  if (file.size <= 0) return 'media.errors.fileEmpty'
  if (file.size > MEDIA_MAX_BYTES) return 'media.errors.fileTooLarge'
  return null
}

// ---------------------------------------------------------------------------
// Licences
// ---------------------------------------------------------------------------

/**
 * Common licences, offered in a select. The STORED value is the licence's own
 * name (data, like the source), not a translated label; the screen translates
 * a stored value it recognises and shows any other as written.
 */
export const LICENCE_PRESETS = [
  { key: 'own', value: "Owner's own photo" },
  { key: 'unsplash', value: 'Unsplash License' },
  { key: 'pexels', value: 'Pexels License' },
  { key: 'cc0', value: 'CC0 1.0' },
  { key: 'ccBy', value: 'CC BY 4.0' },
] as const
export type LicencePresetKey = (typeof LICENCE_PRESETS)[number]['key']
export type LicenceChoice = LicencePresetKey | 'other'

/** The preset a stored licence is, or 'other'. */
export function licenceChoiceOf(value: string): LicenceChoice {
  return LICENCE_PRESETS.find((p) => p.value === value.trim())?.key ?? 'other'
}

/** CC BY is attribution: the author must be named wherever the image is used. */
export function licenceNeedsAuthor(choice: LicenceChoice): boolean {
  return choice === 'ccBy'
}

// ---------------------------------------------------------------------------
// The metadata form (upload and edit)
// ---------------------------------------------------------------------------

export interface MediaMetaForm {
  alt: Localized
  source: string
  licenceChoice: LicenceChoice | ''
  /** The licence's name when the choice is 'other'. */
  licenceText: string
  author: string
  sourceUrl: string
}

export const EMPTY_META: MediaMetaForm = {
  alt: { ru: '', en: '', uz: '' },
  source: '',
  licenceChoice: '',
  licenceText: '',
  author: '',
  sourceUrl: '',
}

export function metaFromAsset(asset: MediaAsset): MediaMetaForm {
  const choice = licenceChoiceOf(asset.licence)
  return {
    alt: { ru: asset.alt.ru ?? '', en: asset.alt.en ?? '', uz: asset.alt.uz ?? '' },
    source: asset.source,
    licenceChoice: choice,
    licenceText: choice === 'other' ? asset.licence : '',
    author: asset.author ?? '',
    sourceUrl: asset.source_url ?? '',
  }
}

/** The licence text that will be stored. */
export function licenceValue(form: Pick<MediaMetaForm, 'licenceChoice' | 'licenceText'>): string {
  if (form.licenceChoice === '') return ''
  if (form.licenceChoice === 'other') return form.licenceText.trim()
  return LICENCE_PRESETS.find((p) => p.key === form.licenceChoice)?.value ?? ''
}

export type MetaField = `alt.${BrochureLang}` | 'source' | 'licence' | 'author' | 'sourceUrl'

/** Field → i18n key of what is missing or wrong; empty when the form may be sent. */
export function metaProblems(form: MediaMetaForm): Partial<Record<MetaField, string>> {
  const out: Partial<Record<MetaField, string>> = {}
  for (const lang of BROCHURE_LANGS)
    if (!form.alt[lang].trim()) out[`alt.${lang}`] = 'media.errors.altRequired'
  if (!form.source.trim()) out.source = 'media.errors.sourceRequired'
  if (!licenceValue(form)) out.licence = 'media.errors.licenceRequired'
  if (
    form.licenceChoice !== '' &&
    form.licenceChoice !== 'other' &&
    licenceNeedsAuthor(form.licenceChoice) &&
    !form.author.trim()
  )
    out.author = 'media.errors.authorRequired'
  const url = form.sourceUrl.trim()
  if (url && !/^https?:\/\/\S+$/i.test(url)) out.sourceUrl = 'media.errors.sourceUrlInvalid'
  return out
}

/** The arguments of tci.register_media_asset / update_media_asset, trimmed. */
export function metaPayload(form: MediaMetaForm) {
  return {
    p_alt: { en: form.alt.en.trim(), ru: form.alt.ru.trim(), uz: form.alt.uz.trim() },
    p_source: form.source.trim(),
    p_licence: licenceValue(form),
    p_author: form.author.trim() || null,
    p_source_url: form.sourceUrl.trim() || null,
  }
}

/** A file size as a number and its unit (the unit's label is translated:
 * `media.units.<unit>`): 1.2 MB, 340 KB. */
export function byteSize(bytes: number): { value: string; unit: 'mb' | 'kb' } {
  if (bytes >= 1024 * 1024) return { value: (bytes / (1024 * 1024)).toFixed(1), unit: 'mb' }
  return { value: String(Math.max(1, Math.round(bytes / 1024))), unit: 'kb' }
}
