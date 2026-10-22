/**
 * The APPROVED source of the TCI brochure's texts (defaultContent.ts): a list
 * of sections, each with a title and a body in every language the offer can
 * be printed in. Since the offer became a fixed template («как в ДМС») the
 * brochure is no longer edited in the app — src/features/offers/kp lays these
 * texts out (tciTexts.ts quotes them, proven by a test) — and
 * tci.brochure_versions / tci.media_assets (0058) stay in the database unused
 * by the screens. Bodies are plain text with three conventions:
 *
 *   a blank line          starts a new paragraph
 *   a line "- …"          is a bullet
 *   a line "? …"          is a FAQ question; the paragraph after it answers it
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
