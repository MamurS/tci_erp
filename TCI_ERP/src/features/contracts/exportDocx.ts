/**
 * The current version → .docx, in the browser (the open-source `docx`
 * package, its own lazy chunk). The look follows the template as far as the
 * editor document carries it:
 *
 *   kept      page size and margins, default font and size, headings (bold,
 *             sized as the standard templates), alignment, bold / italic /
 *             underline, clause numbers (written as text, the same numbers
 *             as on screen), bullet and numbered lists, tables with header
 *             rows, spans and borders on or off, page breaks, merge-field
 *             values (as plain text), a centred "page / pages" footer
 *   not kept  the template's own run fonts, sizes and colours, paragraph
 *             spacing and indents, column widths, headers and footers,
 *             images, text boxes and Word-native multi-level numbering
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx'

import type { Align, BlockNode, ContractDoc, InlineNode } from './model'
import { A4_PAGE } from './model'
import { docNumbering } from './numbering'

const ALIGN: Record<Align, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
}

const HEADING_SIZE: Record<1 | 2 | 3, number> = { 1: 28, 2: 22, 3: 21 }

function runs(nodes: readonly InlineNode[] | undefined, base: { bold?: boolean; size?: number } = {}): TextRun[] {
  return (nodes ?? []).map((n) => {
    if (n.type === 'hardBreak') return new TextRun({ text: '', break: 1 })
    const marks = new Set((n.marks ?? []).map((m) => m.type))
    return new TextRun({
      text: n.type === 'text' ? n.text : n.attrs.value,
      bold: base.bold || marks.has('bold') || undefined,
      italics: marks.has('italic') || undefined,
      underline: marks.has('underline') ? {} : undefined,
      size: base.size,
    })
  })
}

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
const LINE = { style: BorderStyle.SINGLE, size: 4, color: '999999' }

interface Counters {
  orderedLists: number
}

function blocks(content: readonly BlockNode[], labels: readonly (string | null)[] | null, counters: Counters): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  content.forEach((block, i) => {
    const label = labels?.[i] ?? null
    const prefix = label ? [new TextRun({ text: `${label} `, bold: block.type === 'heading' || undefined })] : []
    switch (block.type) {
      case 'heading':
        out.push(
          new Paragraph({
            alignment: block.attrs.textAlign ? ALIGN[block.attrs.textAlign] : undefined,
            spacing: { before: block.attrs.level === 1 ? 0 : 160, after: block.attrs.level === 1 ? 120 : 80 },
            keepNext: true,
            children: [...prefix, ...runs(block.content, { bold: true, size: HEADING_SIZE[block.attrs.level] })],
          }),
        )
        break
      case 'paragraph':
        out.push(
          new Paragraph({
            alignment: block.attrs?.textAlign ? ALIGN[block.attrs.textAlign] : undefined,
            spacing: { after: labels ? 120 : 40 },
            children: [...prefix, ...runs(block.content)],
          }),
        )
        break
      case 'bulletList':
      case 'orderedList': {
        const instance = block.type === 'orderedList' ? ++counters.orderedLists : 0
        for (const item of block.content) {
          item.content.forEach((b, k) => {
            const text = b.type === 'paragraph' || b.type === 'heading' ? b.content : undefined
            out.push(
              new Paragraph({
                numbering:
                  k === 0
                    ? { reference: block.type === 'bulletList' ? 'cd-bullet' : 'cd-decimal', level: 0, instance }
                    : undefined,
                spacing: { after: 60 },
                children: runs(text),
              }),
            )
          })
        }
        break
      }
      case 'table':
        out.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: block.attrs?.bordered
              ? { top: LINE, bottom: LINE, left: LINE, right: LINE, insideHorizontal: LINE, insideVertical: LINE }
              : { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
            rows: block.content.map(
              (row, r) =>
                new TableRow({
                  tableHeader: r === 0 && row.content.every((c) => c.type === 'tableHeader'),
                  children: row.content.map(
                    (cell) =>
                      new TableCell({
                        columnSpan: cell.attrs?.colspan && cell.attrs.colspan > 1 ? cell.attrs.colspan : undefined,
                        rowSpan: cell.attrs?.rowspan && cell.attrs.rowspan > 1 ? cell.attrs.rowspan : undefined,
                        children: cellBlocks(cell.content, cell.type === 'tableHeader', counters),
                      }),
                  ),
                }),
            ),
          }),
        )
        break
      case 'pageBreak':
        out.push(new Paragraph({ children: [new PageBreak()] }))
        break
    }
  })
  return out
}

function cellBlocks(content: readonly BlockNode[], header: boolean, counters: Counters): (Paragraph | Table)[] {
  const out = blocks(
    content.map((b) =>
      header && b.type === 'paragraph'
        ? { ...b, content: (b.content ?? []).map((n) => (n.type === 'hardBreak' ? n : { ...n, marks: [...(n.marks ?? []), { type: 'bold' as const }] })) }
        : b,
    ),
    null,
    counters,
  )
  return out.length ? out : [new Paragraph({ children: [] })]
}

export async function exportDocx(doc: ContractDoc, meta: { title: string; language: string }): Promise<Blob> {
  const layout = doc.attrs?.layout
  const page = layout?.page ?? A4_PAGE
  const document = new Document({
    title: meta.title,
    creator: 'TCI ERP',
    styles: {
      default: {
        document: {
          run: { font: layout?.font ?? 'Arial', size: layout?.sizeHalfPt ?? 21, language: { value: meta.language } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'cd-bullet',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
        {
          reference: 'cd-decimal',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: page.w, height: page.h },
            margin: { top: page.top, right: page.right, bottom: page.bottom, left: page.left },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 16 })],
              }),
            ],
          }),
        },
        children: blocks(doc.content, docNumbering(doc), { orderedLists: 0 }),
      },
    ],
  })
  return Packer.toBlob(document)
}
