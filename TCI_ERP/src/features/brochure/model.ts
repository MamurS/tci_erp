/**
 * The TCI product brochure as stored in tci.brochure_versions.content (0058).
 *
 * A brochure is a list of sections, each with a title and a body in every
 * language the offer can be printed in. Bodies are plain text with three
 * conventions, so they can be written in a textarea and rendered the same way
 * on screen, in the portal and in print:
 *
 *   a blank line          starts a new paragraph
 *   a line "- …"          is a bullet
 *   a line "? …"          is a FAQ question; the paragraph after it answers it
 *
 * An image is chosen from the media library by id; the DATABASE stamps its
 * storage path and alt text onto the section when the version is saved
 * (save_brochure_version), so a published brochure keeps what it printed and
 * a portal client — who cannot read the library — can still show it.
 */

export const BROCHURE_LANGS = ['ru', 'en', 'uz'] as const
export type BrochureLang = (typeof BROCHURE_LANGS)[number]

export type Localized = Record<BrochureLang, string>

/** The sections the product brochure is made of, in print order. */
export const BROCHURE_SECTION_KEYS = [
  'what',
  'how',
  'covered',
  'benefits',
  'limits',
  'process',
  'faq',
  'contacts',
] as const
export type BrochureSectionKey = (typeof BROCHURE_SECTION_KEYS)[number]

export interface BrochureSection {
  key: BrochureSectionKey
  title: Localized
  body: Localized
  image_asset_id?: string | null
  /** Set by the server on save: never trust a browser-supplied value. */
  image_path?: string | null
  image_alt?: Partial<Localized> | null
}

export interface BrochureContent {
  sections: BrochureSection[]
}

export type BrochureStatus = 'draft' | 'published' | 'retired'

/** A row of tci.brochure_versions. */
export interface BrochureVersion {
  id: string
  version_no: number
  status: BrochureStatus
  content: BrochureContent
  note: string | null
  author_id: string
  created_at: string
  published_at: string | null
  published_by: string | null
}

/** A row of tci.media_assets. */
export interface MediaAsset {
  id: string
  storage_path: string
  mime_type: 'image/png' | 'image/jpeg' | 'image/webp'
  byte_size: number | null
  width: number | null
  height: number | null
  alt: Localized
  source: string
  licence: string
  author: string | null
  source_url: string | null
  uploaded_by: string
  created_at: string
  updated_at: string
  retired_at: string | null
}

export const MEDIA_BUCKET = 'media-assets'

/** One block of a section body after parsing the plain-text conventions. */
export type BodyBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'question'; text: string }

/** Parse a section body (see the conventions at the top of the file). */
export function parseBody(body: string): BodyBlock[] {
  const blocks: BodyBlock[] = []
  for (const chunk of body.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines = chunk
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length === 0) continue
    let para: string[] = []
    const flush = () => {
      if (para.length) blocks.push({ kind: 'paragraph', text: para.join(' ') })
      para = []
    }
    for (const line of lines) {
      if (line.startsWith('- ')) {
        flush()
        const last = blocks[blocks.length - 1]
        if (last?.kind === 'bullets') last.items.push(line.slice(2).trim())
        else blocks.push({ kind: 'bullets', items: [line.slice(2).trim()] })
      } else if (line.startsWith('? ')) {
        flush()
        blocks.push({ kind: 'question', text: line.slice(2).trim() })
      } else {
        para.push(line)
      }
    }
    flush()
  }
  return blocks
}
