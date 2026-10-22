/**
 * Clause numbering, derived — never stored (pure). The one rule, used by the
 * viewer, the editor (as decorations), the print route, the comparison and
 * the DOCX export:
 *
 *   a numbered section heading   N.        (sections count from 1)
 *   a clause paragraph           N.M.      (M restarts after every section)
 *   a clause before any section  M.
 *
 * Only top-level blocks take part: a paragraph inside a table or a list is
 * never a clause.
 */

import type { BlockNode, ContractDoc } from './model'

export type NumberingKind = 'section' | 'clause' | 'other'

export function blockKind(block: { type: string; attrs?: Record<string, unknown> | null }): NumberingKind {
  if (block.type === 'heading' && block.attrs?.numbered === true) return 'section'
  if (block.type === 'paragraph' && block.attrs?.clause === true) return 'clause'
  return 'other'
}

/** The label of each block, in order; null where a block has none. */
export function numberLabels(kinds: readonly NumberingKind[]): (string | null)[] {
  let section = 0
  let clause = 0
  return kinds.map((kind) => {
    if (kind === 'section') {
      section += 1
      clause = 0
      return `${section}.`
    }
    if (kind === 'clause') {
      clause += 1
      return section > 0 ? `${section}.${clause}.` : `${clause}.`
    }
    return null
  })
}

export function docNumbering(doc: Pick<ContractDoc, 'content'>): (string | null)[] {
  return numberLabels(doc.content.map((b: BlockNode) => blockKind(b as { type: string; attrs?: Record<string, unknown> })))
}
