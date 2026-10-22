/** The table of contents of a contract: headings and clauses with their
 * derived numbers (pure). */

import type { ContractDoc } from './model'
import { inlineText } from './model'
import { blockKind, docNumbering } from './numbering'

export interface TocEntry {
  index: number
  label: string | null
  text: string
  level: 1 | 2 | 3
}

/** Headings and clauses, with their derived numbers. */
export function tocEntries(doc: ContractDoc): TocEntry[] {
  const labels = docNumbering(doc)
  const out: TocEntry[] = []
  doc.content.forEach((b, i) => {
    if (b.type === 'heading') {
      out.push({ index: i, label: labels[i] ?? null, text: inlineText(b.content).trim(), level: b.attrs.level === 1 ? 1 : 2 })
    } else if (blockKind(b as { type: string; attrs?: Record<string, unknown> }) === 'clause') {
      const words = inlineText(b.type === 'paragraph' ? b.content : undefined).trim().split(/\s+/).slice(0, 7).join(' ')
      out.push({ index: i, label: labels[i] ?? null, text: words, level: 3 })
    }
  })
  return out
}
