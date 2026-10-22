/**
 * The contract document as stored in tci.contract_versions.content (0057):
 * ProseMirror JSON in the editor's schema (TipTap node names). The viewer,
 * the print route, the portal, the comparison and the DOCX export all read
 * this one shape; the editor is the only thing that writes it.
 *
 * Clause numbers are NOT text: a numbered section heading carries
 * `numbered: true` and a clause paragraph `clause: true`; numbering.ts derives
 * the numbers wherever the document is shown or exported, so inserting or
 * removing a clause renumbers everything after it.
 */

export type MarkType = 'bold' | 'italic' | 'underline'
export interface Mark {
  type: MarkType
}

export type Align = 'left' | 'center' | 'right' | 'justify'

export interface TextNode {
  type: 'text'
  text: string
  marks?: Mark[]
}

/** A template placeholder in the document: the catalogue path it came from
 * ('policy.number', 'limits.amount' with the row index) and the value it
 * printed when the version was made. Refreshing rewrites `value` only. */
export interface MergeFieldNode {
  type: 'mergeField'
  attrs: { path: string; index: number | null; value: string }
  marks?: Mark[]
}

export interface HardBreakNode {
  type: 'hardBreak'
  marks?: Mark[]
}

export type InlineNode = TextNode | MergeFieldNode | HardBreakNode

export interface ParagraphNode {
  type: 'paragraph'
  attrs?: { textAlign?: Align | null; clause?: boolean }
  content?: InlineNode[]
}

export interface HeadingNode {
  type: 'heading'
  attrs: { level: 1 | 2 | 3; textAlign?: Align | null; numbered?: boolean }
  content?: InlineNode[]
}

export interface ListItemNode {
  type: 'listItem'
  content: BlockNode[]
}

export interface ListNode {
  type: 'bulletList' | 'orderedList'
  attrs?: { start?: number }
  content: ListItemNode[]
}

export interface TableCellNode {
  type: 'tableCell' | 'tableHeader'
  attrs?: { colspan?: number; rowspan?: number; colwidth?: number[] | null }
  content: BlockNode[]
}

export interface TableRowNode {
  type: 'tableRow'
  content: TableCellNode[]
}

export interface TableNode {
  type: 'table'
  attrs?: { bordered?: boolean }
  content: TableRowNode[]
}

export interface PageBreakNode {
  type: 'pageBreak'
}

export type BlockNode = ParagraphNode | HeadingNode | ListNode | TableNode | PageBreakNode

/** What the template said about the page, kept so the export and the print
 * look like it. Lengths in twips (1/1440 inch), as in WordprocessingML. */
export interface DocLayout {
  font?: string | null
  /** Default font size in half-points (21 = 10.5 pt). */
  sizeHalfPt?: number | null
  page?: { w: number; h: number; top: number; right: number; bottom: number; left: number } | null
}

export interface ContractDoc {
  type: 'doc'
  attrs?: { layout?: DocLayout | null }
  content: BlockNode[]
}

export const A4_PAGE = { w: 11906, h: 16838, top: 1134, right: 850, bottom: 1134, left: 1418 } as const

export function isContractDoc(value: unknown): value is ContractDoc {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'doc' &&
    Array.isArray((value as { content?: unknown }).content)
  )
}

/** The plain text of inline content; a field contributes its value. */
export function inlineText(content: readonly InlineNode[] | undefined): string {
  return (content ?? [])
    .map((n) => (n.type === 'text' ? n.text : n.type === 'mergeField' ? n.attrs.value : '\n'))
    .join('')
}

/** The plain text of any block (cells joined by a tab, items by a newline). */
export function blockText(block: BlockNode): string {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return inlineText(block.content)
    case 'bulletList':
    case 'orderedList':
      return block.content.map((item) => item.content.map(blockText).join('\n')).join('\n')
    case 'table':
      return block.content.map((row) => row.content.map((cell) => cell.content.map(blockText).join(' ')).join('\t')).join('\n')
    case 'pageBreak':
      return ''
  }
}
