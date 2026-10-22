/**
 * The offer's text blocks: plain text <-> the Prompt 25 editor document.
 *
 * A new offer starts from default texts in its own language (locale keys
 * offers.defaults.<block>, paragraphs separated by a blank line, "- " for a
 * bullet); staff then edit each block in the contract editor, which stores a
 * ContractDoc. Pure: no React, no i18n instance.
 */

import type { BlockNode, ContractDoc } from '../contracts/model'
import { OFFER_BLOCKS } from './model'
import type { OfferBlock, OfferTexts } from './model'

const text = (s: string) => ({ type: 'text' as const, text: s })

/** Plain text to an editor document: paragraphs and bullet lists. */
export function textToDoc(plain: string): ContractDoc {
  const content: BlockNode[] = []
  for (const chunk of plain.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean)
    if (lines.length === 0) continue
    const bullets = lines.filter((l) => l.startsWith('- '))
    if (bullets.length === lines.length) {
      content.push({
        type: 'bulletList',
        content: bullets.map((b) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [text(b.slice(2).trim())] }],
        })),
      } as BlockNode)
    } else {
      content.push({ type: 'paragraph', content: [text(lines.join(' '))] } as BlockNode)
    }
  }
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' } as BlockNode] }
}

/** The default texts of a new offer, from a translate function bound to the
 * offer's language (useFixedT). */
export function defaultTexts(t: (key: string) => string): OfferTexts {
  const out: OfferTexts = {}
  for (const block of OFFER_BLOCKS) out[block] = textToDoc(t(`offers.defaults.${block}`))
  return out
}

/** True when a block has no words in it (an empty editor). */
export function isEmptyDoc(doc: ContractDoc | undefined): boolean {
  if (!doc) return true
  const walk = (nodes: unknown[]): boolean =>
    nodes.every((n) => {
      const node = n as { type?: string; text?: string; content?: unknown[] }
      if (node.type === 'text') return !node.text?.trim()
      return walk(node.content ?? [])
    })
  return walk(doc.content)
}

/** The blocks that will print, in order (empty ones are left out). */
export function printableBlocks(texts: OfferTexts): OfferBlock[] {
  return OFFER_BLOCKS.filter((b) => !isEmptyDoc(texts[b]))
}
