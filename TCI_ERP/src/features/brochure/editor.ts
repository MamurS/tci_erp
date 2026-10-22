/**
 * The brochure editor's pure rules: a stored version made whole (every
 * section, in print order, every language), what counts as an edit, and what
 * is still missing before a version is fit to publish.
 */

import { BROCHURE_LANGS, BROCHURE_SECTION_KEYS } from './model'
import type {
  BrochureContent,
  BrochureLang,
  BrochureSection,
  BrochureSectionKey,
  BrochureStatus,
  Localized,
} from './model'

/** tci.brochure_status, in its declared order (contract-tested). */
export const BROCHURE_STATUSES: readonly BrochureStatus[] = ['draft', 'published', 'retired']

export const STATUS_TONE: Record<BrochureStatus, 'warn' | 'pos' | 'neutral'> = {
  draft: 'warn',
  published: 'pos',
  retired: 'neutral',
}

/** The interface language as a brochure language (Russian by default). */
export function brochureLangOf(language: string | null | undefined): BrochureLang {
  return (BROCHURE_LANGS as readonly string[]).includes(language ?? '')
    ? (language as BrochureLang)
    : 'ru'
}

const EMPTY: Localized = { ru: '', en: '', uz: '' }

function localized(value: unknown): Localized {
  const v = (value && typeof value === 'object' ? value : {}) as Partial<Record<string, unknown>>
  const out = { ...EMPTY }
  for (const lang of BROCHURE_LANGS)
    out[lang] = typeof v[lang] === 'string' ? (v[lang] as string) : ''
  return out
}

function isSectionKey(key: unknown): key is BrochureSectionKey {
  return typeof key === 'string' && (BROCHURE_SECTION_KEYS as readonly string[]).includes(key)
}

/**
 * Every section of the brochure, in print order, with all three languages —
 * whatever the stored JSON holds. A section the version lacks comes back
 * empty; a key the app does not know is dropped (it could not be rendered).
 * The server-stamped image path and alt are kept for the preview.
 */
export function normalizeContent(content: unknown): BrochureContent {
  const raw =
    (content && typeof content === 'object'
      ? (content as { sections?: unknown }).sections
      : null) ?? []
  const byKey = new Map<BrochureSectionKey, Record<string, unknown>>()
  if (Array.isArray(raw))
    for (const s of raw) {
      const section = s as Record<string, unknown>
      if (section && isSectionKey(section.key) && !byKey.has(section.key))
        byKey.set(section.key, section)
    }
  return {
    sections: BROCHURE_SECTION_KEYS.map((key): BrochureSection => {
      const s = byKey.get(key)
      const assetId =
        typeof s?.image_asset_id === 'string' && s.image_asset_id ? s.image_asset_id : null
      return {
        key,
        title: localized(s?.title),
        body: localized(s?.body),
        image_asset_id: assetId,
        image_path: assetId && typeof s?.image_path === 'string' ? s.image_path : null,
        image_alt:
          assetId && s?.image_alt && typeof s.image_alt === 'object'
            ? localized(s.image_alt)
            : null,
      }
    }),
  }
}

/** What the editor sends: titles, bodies and the image chosen — never the
 * path or alt, which the server stamps from the library on save. */
export function editablePayload(content: BrochureContent): BrochureContent {
  return {
    sections: normalizeContent(content).sections.map((s) => ({
      key: s.key,
      title: s.title,
      body: s.body,
      ...(s.image_asset_id ? { image_asset_id: s.image_asset_id } : {}),
    })),
  }
}

/** Whether the editor holds something the base version does not say. */
export function isDirty(current: BrochureContent, base: BrochureContent | null): boolean {
  if (!base) return true
  return JSON.stringify(editablePayload(current)) !== JSON.stringify(editablePayload(base))
}

export interface MissingText {
  key: BrochureSectionKey
  lang: BrochureLang
  field: 'title' | 'body'
}

/** Every title and body still empty, per section and language. */
export function missingTexts(content: BrochureContent): MissingText[] {
  const out: MissingText[] = []
  for (const s of normalizeContent(content).sections)
    for (const lang of BROCHURE_LANGS)
      for (const field of ['title', 'body'] as const)
        if (!s[field][lang].trim()) out.push({ key: s.key, lang, field })
  return out
}

/** The languages a section is still missing text in (for the tab markers). */
export function sectionMissingLangs(section: BrochureSection): BrochureLang[] {
  return BROCHURE_LANGS.filter((lang) => !section.title[lang].trim() || !section.body[lang].trim())
}

/** Change one section; everything else stays the same object. */
export function updateSection(
  content: BrochureContent,
  key: BrochureSectionKey,
  change: (section: BrochureSection) => BrochureSection,
): BrochureContent {
  return { sections: content.sections.map((s) => (s.key === key ? change(s) : s)) }
}

/**
 * The preview of an unsaved edit: a newly chosen image is not stamped by the
 * server yet, so take its path and alt from the library row in hand.
 */
export function withLibraryImages(
  content: BrochureContent,
  library: readonly { id: string; storage_path: string; alt: Localized }[],
): BrochureContent {
  const byId = new Map(library.map((a) => [a.id, a]))
  return {
    sections: content.sections.map((s) => {
      if (!s.image_asset_id) return { ...s, image_path: null, image_alt: null }
      const asset = byId.get(s.image_asset_id)
      return asset ? { ...s, image_path: asset.storage_path, image_alt: asset.alt } : s
    }),
  }
}
