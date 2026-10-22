/**
 * Template → editor document (pure). Reads the wording template's .docx parts
 * (the TEMPLATE, with its {{placeholders}} — not a rendered file), evaluates
 * the sections against the printable context of wording/context.ts, and
 * produces the contract document of model.ts in which every placeholder is a
 * merge-field chip that knows its catalogue path and the value it printed.
 *
 * The mapping (stated in the report and in CLAUDE.md):
 *
 *   w:p, style Title / Heading 1            heading 1
 *   w:p, style Heading 2 / 3                heading 2 / 3
 *   w:p all bold, "N. Title"                heading 2, numbered (N is derived)
 *   w:p all bold and centred                heading 1 (the contract title)
 *   w:p all bold, otherwise                 heading 2, not numbered
 *   w:p "N.M. text"                         paragraph, clause (N.M derived)
 *   w:p with w:numPr                        list item (bullet or ordered, by
 *                                           numbering.xml; one level)
 *   other w:p                               paragraph (alignment kept)
 *   w:r b / i / u                           bold / italic / underline marks
 *   w:br page, pageBreakBefore              page break
 *   w:br, w:cr                              hard break
 *   w:tbl                                   table; first all-bold row = header
 *                                           cells; gridSpan / vMerge spans;
 *                                           borders on or off
 *   {{path}}                                merge field chip
 *   {{#x}}…{{/x}}, {{^x}}…{{/x}}            evaluated here: a list repeats (in
 *                                           a paragraph, over paragraphs, or
 *                                           over table rows), a value shows or
 *                                           hides; a paragraph emptied by a
 *                                           hidden section disappears
 *   sectPr page size / margins, default
 *   font and size (styles.xml)              layout, used by print and export
 *
 * Not carried (reported as warnings): images and drawings, text boxes,
 * headers and footers, run fonts / sizes / colours, paragraph spacing,
 * multi-level list nesting, column widths, a section opened in one table
 * cell and closed outside the table.
 */

import type {
  Align,
  BlockNode,
  ContractDoc,
  DocLayout,
  HeadingNode,
  InlineNode,
  ListItemNode,
  Mark,
  MarkType,
  ParagraphNode,
  TableCellNode,
  TableNode,
  TableRowNode,
} from './model'
import { child, elements, parseXml, textOf } from './xml'
import type { XmlEl } from './xml'

export type ConversionWarning =
  | 'images'
  | 'textBoxes'
  | 'headerFooter'
  | 'unclosedSection'
  | 'unsupportedSection'
  | 'multiLevelList'

export interface TemplateParts {
  document: string
  styles?: string | null
  numbering?: string | null
}

export interface Conversion {
  doc: ContractDoc
  warnings: ConversionWarning[]
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type Tok =
  | { t: 'text'; text: string; marks: MarkType[] }
  | { t: 'field'; tag: string; marks: MarkType[] }
  | { t: 'resolved'; path: string; index: number | null; value: string; marks: MarkType[] }
  | { t: 'open'; name: string; inverted: boolean }
  | { t: 'close'; name: string }
  | { t: 'br' }
  | { t: 'page' }

interface PProps {
  style: string | null
  align: Align | null
  num: { numId: string; ilvl: number } | null
  pageBreakBefore: boolean
}

type RawBlock = { kind: 'p'; props: PProps; toks: Tok[]; hadSection?: boolean } | RawTable

interface RawTable {
  kind: 'table'
  bordered: boolean
  rows: RawRow[]
}
interface RawRow {
  cells: RawCell[]
}
interface RawCell {
  blocks: RawBlock[]
  colspan: number
  vmerge: 'restart' | 'continue' | null
}

const W = (name: string) => `w:${name}`

function onOff(el: XmlEl | undefined): boolean {
  if (!el) return false
  const v = el.attrs['w:val']
  return v === undefined || !['0', 'false', 'off', 'none'].includes(v)
}

function runMarks(rPr: XmlEl | undefined): MarkType[] {
  const marks: MarkType[] = []
  if (onOff(child(rPr, W('b')))) marks.push('bold')
  if (onOff(child(rPr, W('i')))) marks.push('italic')
  if (onOff(child(rPr, W('u')))) marks.push('underline')
  return marks
}

const ALIGN: Record<string, Align> = {
  center: 'center',
  both: 'justify',
  distribute: 'justify',
  right: 'right',
  end: 'right',
  left: 'left',
  start: 'left',
}

interface Ctx {
  warnings: Set<ConversionWarning>
}

/** The text pieces of a paragraph with their marks (before tags are read). */
type Piece = { text: string; marks: MarkType[] } | { br: 'line' | 'page' }

function collectPieces(el: XmlEl, ctx: Ctx, out: Piece[], inherited: MarkType[] = []) {
  for (const c of elements(el)) {
    switch (c.name) {
      case 'w:pPr':
      case 'w:del':
      case 'w:moveFrom':
      case 'w:proofErr':
      case 'w:bookmarkStart':
      case 'w:bookmarkEnd':
        break
      case 'w:r': {
        const marks = [...new Set([...inherited, ...runMarks(child(c, W('rPr')))])]
        for (const r of elements(c)) {
          if (r.name === 'w:t') out.push({ text: textOf(r), marks })
          else if (r.name === 'w:tab' || r.name === 'w:ptab') out.push({ text: '\t', marks })
          else if (r.name === 'w:br') out.push({ br: r.attrs['w:type'] === 'page' ? 'page' : 'line' })
          else if (r.name === 'w:cr') out.push({ br: 'line' })
          else if (r.name === 'w:noBreakHyphen') out.push({ text: '-', marks })
          else if (r.name === 'w:drawing' || r.name === 'w:pict' || r.name === 'w:object') ctx.warnings.add('images')
          else if (r.name === 'mc:AlternateContent') ctx.warnings.add('textBoxes')
        }
        break
      }
      default:
        // hyperlinks, smart tags, insertions, content controls, simple fields
        collectPieces(c, ctx, out, inherited)
    }
  }
}

const TAG = /\{\{([^{}]*?)\}\}/g

/** Reads {{…}} across run boundaries: a tag takes the marks of the run it
 * starts in. */
function tokenize(pieces: Piece[]): Tok[] {
  // Flatten to one string; breaks become control characters a tag never holds.
  let text = ''
  const marksAt: MarkType[][] = []
  for (const p of pieces) {
    if ('br' in p) {
      text += p.br === 'page' ? '\u000c' : '\u000b'
      marksAt.push([])
    } else {
      text += p.text
      for (let k = 0; k < p.text.length; k++) marksAt.push(p.marks)
    }
  }
  const toks: Tok[] = []
  const pushText = (from: number, to: number) => {
    let start = from
    for (let k = from; k <= to; k++) {
      const ch = text[k]
      const boundary =
        k === to || ch === '\u000b' || ch === '\u000c' || (k > start && !sameMarks(marksAt[k]!, marksAt[start]!))
      if (boundary) {
        if (k > start) toks.push({ t: 'text', text: text.slice(start, k), marks: marksAt[start]! })
        if (k < to && (ch === '\u000b' || ch === '\u000c')) {
          toks.push(ch === '\u000c' ? { t: 'page' } : { t: 'br' })
          start = k + 1
        } else {
          start = k
        }
      }
    }
  }
  let last = 0
  for (const m of text.matchAll(TAG)) {
    const at = m.index ?? 0
    pushText(last, at)
    const body = m[1]!.trim()
    if (body.startsWith('#') || body.startsWith('^')) toks.push({ t: 'open', name: body.slice(1).trim(), inverted: body[0] === '^' })
    else if (body.startsWith('/')) toks.push({ t: 'close', name: body.slice(1).trim() })
    else if (body) toks.push({ t: 'field', tag: body, marks: marksAt[at] ?? [] })
    last = at + m[0].length
  }
  pushText(last, text.length)
  return toks
}

function sameMarks(a: readonly MarkType[], b: readonly MarkType[]): boolean {
  return a.length === b.length && a.every((m) => b.includes(m))
}

function readParagraph(p: XmlEl, ctx: Ctx): RawBlock {
  const pPr = child(p, W('pPr'))
  const numPr = child(pPr, W('numPr'))
  const numId = child(numPr, W('numId'))?.attrs['w:val']
  const props: PProps = {
    style: child(pPr, W('pStyle'))?.attrs['w:val'] ?? null,
    align: ALIGN[child(pPr, W('jc'))?.attrs['w:val'] ?? ''] ?? null,
    num: numId && numId !== '0' ? { numId, ilvl: Number(child(numPr, W('ilvl'))?.attrs['w:val'] ?? 0) } : null,
    pageBreakBefore: onOff(child(pPr, W('pageBreakBefore'))),
  }
  if (props.num && props.num.ilvl > 0) ctx.warnings.add('multiLevelList')
  const pieces: Piece[] = []
  collectPieces(p, ctx, pieces)
  return { kind: 'p', props, toks: tokenize(pieces) }
}

function readTable(tbl: XmlEl, ctx: Ctx): RawTable {
  const tblPr = child(tbl, W('tblPr'))
  const borders = child(tblPr, W('tblBorders'))
  const style = child(tblPr, W('tblStyle'))?.attrs['w:val'] ?? ''
  const bordered =
    /grid/i.test(style) ||
    (borders ? elements(borders).some((b) => !['none', 'nil'].includes(b.attrs['w:val'] ?? 'none')) : false)
  const rows: RawRow[] = elements(tbl)
    .filter((r) => r.name === 'w:tr')
    .map((tr) => ({
      cells: elements(tr)
        .filter((c) => c.name === 'w:tc')
        .map((tc) => {
          const tcPr = child(tc, W('tcPr'))
          const vMerge = child(tcPr, W('vMerge'))
          return {
            blocks: readBlocks(tc, ctx),
            colspan: Math.max(1, Number(child(tcPr, W('gridSpan'))?.attrs['w:val'] ?? 1)),
            vmerge: vMerge ? (vMerge.attrs['w:val'] === 'restart' ? 'restart' : 'continue') : null,
          } satisfies RawCell
        }),
    }))
  return { kind: 'table', bordered, rows }
}

function readBlocks(container: XmlEl, ctx: Ctx): RawBlock[] {
  const out: RawBlock[] = []
  for (const el of elements(container)) {
    if (el.name === 'w:p') out.push(readParagraph(el, ctx))
    else if (el.name === 'w:tbl') out.push(readTable(el, ctx))
    else if (el.name === 'w:sdt') out.push(...readBlocks(child(el, W('sdtContent')) ?? el, ctx))
    else if (el.name === 'w:customXml') out.push(...readBlocks(el, ctx))
  }
  return out
}

// ---------------------------------------------------------------------------
// Sections and fields
// ---------------------------------------------------------------------------

interface Frame {
  data: unknown
  loop: { name: string; index: number } | null
}

function getPath(data: unknown, path: string): unknown {
  if (path === '.') return data
  let v: unknown = data
  for (const key of path.split('.')) {
    if (v === null || typeof v !== 'object') return undefined
    v = (v as Record<string, unknown>)[key]
  }
  return v
}

function lookup(scope: readonly Frame[], tag: string): { value: unknown; frame: Frame | null } {
  for (let k = scope.length - 1; k >= 0; k--) {
    const value = getPath(scope[k]!.data, tag)
    if (value !== undefined) return { value, frame: scope[k]! }
  }
  return { value: undefined, frame: null }
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false
  return true
}

/** The scopes a section renders its body in: one per list item, one for a
 * truthy value, none otherwise (inverted: the opposite, once). */
function sectionScopes(scope: readonly Frame[], name: string, inverted: boolean): Frame[][] {
  const { value } = lookup(scope, name)
  if (inverted) return truthy(value) ? [] : [[...scope]]
  if (Array.isArray(value)) {
    return value.map((item, index) => [...scope, { data: item, loop: { name, index } }])
  }
  return truthy(value) ? [[...scope, { data: value, loop: null }]] : []
}

function resolveField(scope: readonly Frame[], tag: string, marks: MarkType[]): Tok {
  const { value, frame } = lookup(scope, tag)
  const path = frame?.loop ? `${frame.loop.name}.${tag}` : tag
  const printed = value === null || value === undefined ? '' : typeof value === 'object' ? '' : String(value)
  return { t: 'resolved', path, index: frame?.loop ? frame.loop.index : null, value: printed, marks }
}

/** The index of the close matching the open at `at`, in the same list. */
function matchingClose(toks: readonly Tok[], at: number): number {
  const open = toks[at] as { t: 'open'; name: string }
  let depth = 0
  for (let k = at + 1; k < toks.length; k++) {
    const x = toks[k]!
    if (x.t === 'open' && x.name === open.name) depth++
    else if (x.t === 'close' && x.name === open.name) {
      if (depth === 0) return k
      depth--
    }
  }
  return -1
}

/** Inline evaluation of one paragraph's balanced sections and fields. */
function expandToks(toks: readonly Tok[], scope: readonly Frame[], ctx: Ctx): { toks: Tok[]; hadSection: boolean } {
  const out: Tok[] = []
  let hadSection = false
  for (let k = 0; k < toks.length; k++) {
    const x = toks[k]!
    if (x.t === 'open') {
      const end = matchingClose(toks, k)
      if (end === -1) {
        ctx.warnings.add('unclosedSection')
        continue
      }
      hadSection = true
      for (const inner of sectionScopes(scope, x.name, x.inverted)) {
        out.push(...expandToks(toks.slice(k + 1, end), inner, ctx).toks)
      }
      k = end
    } else if (x.t === 'close') {
      ctx.warnings.add('unclosedSection')
    } else if (x.t === 'field') {
      out.push(resolveField(scope, x.tag, x.marks))
    } else {
      out.push(x)
    }
  }
  return { toks: out, hadSection }
}

/** The first open tag of a paragraph whose close is NOT in that paragraph. */
function firstUnclosedOpen(toks: readonly Tok[]): number {
  for (let k = 0; k < toks.length; k++) {
    const x = toks[k]!
    if (x.t === 'open') {
      const end = matchingClose(toks, k)
      if (end === -1) return k
      k = end
    }
  }
  return -1
}

function isBlank(toks: readonly Tok[]): boolean {
  return toks.every((x) => x.t === 'text' && x.text.trim() === '')
}

/** Paragraph-range and table-row sections, then inline evaluation. */
function expandBlocks(blocks: readonly RawBlock[], scope: readonly Frame[], ctx: Ctx): RawBlock[] {
  const out: RawBlock[] = []
  const queue = [...blocks]
  let i = 0
  while (i < queue.length) {
    const b = queue[i]!
    if (b.kind === 'table') {
      out.push(expandTable(b, scope, ctx))
      i++
      continue
    }
    const at = firstUnclosedOpen(b.toks)
    if (at === -1) {
      const { toks, hadSection } = expandToks(b.toks, scope, ctx)
      out.push({ ...b, toks, hadSection })
      i++
      continue
    }
    const open = b.toks[at] as { t: 'open'; name: string; inverted: boolean }
    // find the close in a later paragraph of the same container
    let j = -1
    let cpos = -1
    let depth = 0
    for (let k = i + 1; k < queue.length && j === -1; k++) {
      const q = queue[k]!
      if (q.kind !== 'p') continue
      for (let m = 0; m < q.toks.length; m++) {
        const x = q.toks[m]!
        if (x.t === 'open' && x.name === open.name) depth++
        else if (x.t === 'close' && x.name === open.name) {
          if (depth === 0) {
            j = k
            cpos = m
            break
          }
          depth--
        }
      }
    }
    if (j === -1) {
      ctx.warnings.add('unclosedSection')
      queue[i] = { ...b, toks: b.toks.filter((_, k) => k !== at) }
      continue
    }
    const closing = queue[j] as Extract<RawBlock, { kind: 'p' }>
    const before = { ...b, toks: b.toks.slice(0, at) }
    const first = { ...b, toks: b.toks.slice(at + 1) }
    const last = { ...closing, toks: closing.toks.slice(0, cpos) }
    const after = { ...closing, toks: closing.toks.slice(cpos + 1) }
    const body: RawBlock[] = [
      ...(isBlank(first.toks) ? [] : [first]),
      ...queue.slice(i + 1, j),
      ...(isBlank(last.toks) ? [] : [last]),
    ]
    if (!isBlank(before.toks)) out.push(...expandBlocks([before], scope, ctx))
    for (const inner of sectionScopes(scope, open.name, open.inverted)) out.push(...expandBlocks(body, inner, ctx))
    if (isBlank(after.toks)) {
      i = j + 1
    } else {
      queue[j] = after
      i = j
    }
  }
  return out
}

function rowToks(row: RawRow): { cell: number; block: number; tok: number; x: Tok }[] {
  const out: { cell: number; block: number; tok: number; x: Tok }[] = []
  row.cells.forEach((c, ci) =>
    c.blocks.forEach((b, bi) => {
      if (b.kind === 'p') b.toks.forEach((x, ti) => out.push({ cell: ci, block: bi, tok: ti, x }))
    }),
  )
  return out
}

function stripTok(row: RawRow, at: { cell: number; block: number; tok: number }): RawRow {
  return {
    cells: row.cells.map((c, ci) =>
      ci !== at.cell
        ? c
        : {
            ...c,
            blocks: c.blocks.map((b, bi) =>
              bi !== at.block || b.kind !== 'p' ? b : { ...b, toks: b.toks.filter((_, ti) => ti !== at.tok) },
            ),
          },
    ),
  }
}

function expandTable(table: RawTable, scope: readonly Frame[], ctx: Ctx): RawTable {
  const rows: RawRow[] = []
  const queue = [...table.rows]
  let r = 0
  while (r < queue.length) {
    const row = queue[r]!
    const flat = rowToks(row)
    // an open whose close is not in the same paragraph: a row-level section
    const openAt = flat.findIndex((f, k) => {
      if (f.x.t !== 'open') return false
      const sameP = flat.filter((g) => g.cell === f.cell && g.block === f.block).map((g) => g.x)
      const local = sameP.indexOf(f.x)
      return matchingClose(sameP, local) === -1 && k >= 0
    })
    if (openAt === -1) {
      rows.push(expandRow(row, scope, ctx))
      r++
      continue
    }
    const open = flat[openAt]!
    const name = (open.x as { name: string }).name
    const inverted = (open.x as { inverted: boolean }).inverted
    // find the close: later in this row, or in a later row
    let endRow = -1
    let endAt: { cell: number; block: number; tok: number } | null = null
    for (let k = r; k < queue.length && endRow === -1; k++) {
      const f = rowToks(queue[k]!)
      const startIdx = k === r ? openAt + 1 : 0
      let depth = 0
      for (let m = startIdx; m < f.length; m++) {
        const x = f[m]!.x
        if (x.t === 'open' && x.name === name) depth++
        else if (x.t === 'close' && x.name === name) {
          if (depth === 0) {
            endRow = k
            endAt = f[m]!
            break
          }
          depth--
        }
      }
    }
    if (endRow === -1 || !endAt) {
      ctx.warnings.add('unsupportedSection')
      queue[r] = stripTok(row, open)
      continue
    }
    // remove the two tags (the close first if it is in the same row, so the
    // open's position is unchanged)
    const span = queue.slice(r, endRow + 1)
    span[span.length - 1] = stripTok(span[span.length - 1]!, endAt)
    span[0] = stripTok(span[0]!, open)
    for (const inner of sectionScopes(scope, name, inverted)) {
      for (const sr of span) rows.push(...expandTable({ ...table, rows: [sr] }, inner, ctx).rows)
    }
    r = endRow + 1
  }
  return { ...table, rows }
}

function expandRow(row: RawRow, scope: readonly Frame[], ctx: Ctx): RawRow {
  return { cells: row.cells.map((c) => ({ ...c, blocks: expandBlocks(c.blocks, scope, ctx) })) }
}

// ---------------------------------------------------------------------------
// Into the editor's schema
// ---------------------------------------------------------------------------

function marksOf(types: readonly MarkType[]): Mark[] | undefined {
  return types.length ? types.map((type) => ({ type })) : undefined
}

function toInline(toks: readonly Tok[]): InlineNode[] {
  const out: InlineNode[] = []
  for (const x of toks) {
    if (x.t === 'text') {
      if (!x.text) continue
      const prev = out[out.length - 1]
      const marks = marksOf(x.marks)
      if (prev?.type === 'text' && sameMarks((prev.marks ?? []).map((m) => m.type), x.marks)) prev.text += x.text
      else out.push(marks ? { type: 'text', text: x.text, marks } : { type: 'text', text: x.text })
    } else if (x.t === 'resolved') {
      const marks = marksOf(x.marks)
      out.push({ type: 'mergeField', attrs: { path: x.path, index: x.index, value: x.value }, ...(marks ? { marks } : {}) })
    } else if (x.t === 'br') {
      out.push({ type: 'hardBreak' })
    }
  }
  // ProseMirror refuses empty text nodes; tabs read as spaces.
  return out
    .map((n) => (n.type === 'text' ? { ...n, text: n.text.replace(/\t/g, ' ') } : n))
    .filter((n) => n.type !== 'text' || n.text.length > 0)
}

/** Leading text of a paragraph (until its first field or break). */
function leadingText(toks: readonly Tok[]): string {
  let s = ''
  for (const x of toks) {
    if (x.t !== 'text') break
    s += x.text
  }
  return s
}

function dropPrefix(toks: readonly Tok[], length: number): Tok[] {
  const out: Tok[] = []
  let left = length
  for (const x of toks) {
    if (left > 0 && x.t === 'text') {
      if (x.text.length <= left) {
        left -= x.text.length
        continue
      }
      out.push({ ...x, text: x.text.slice(left) })
      left = 0
      continue
    }
    out.push(x)
  }
  return out
}

function allBold(toks: readonly Tok[]): boolean {
  const visible = toks.filter(
    (x) => (x.t === 'text' && x.text.trim() !== '') || (x.t === 'resolved' && x.value.trim() !== ''),
  )
  return visible.length > 0 && visible.every((x) => (x as { marks: MarkType[] }).marks.includes('bold'))
}

function plain(toks: readonly Tok[]): string {
  return toks.map((x) => (x.t === 'text' ? x.text : x.t === 'resolved' ? x.value : ' ')).join('')
}

const SECTION_PREFIX = /^\s*(\d+)\.(?!\d)\s*/
const CLAUSE_PREFIX = /^\s*\d+\.\d+\.?(?!\d)\s*/

/** A heading's marks are its look; bold on every run of it is dropped. */
function withoutBold(toks: readonly Tok[]): Tok[] {
  return toks.map((x) =>
    x.t === 'text' || x.t === 'resolved' ? { ...x, marks: x.marks.filter((m) => m !== 'bold') } : x,
  )
}

type Para = Extract<RawBlock, { kind: 'p' }>

/** Splits a paragraph at its page breaks. */
function splitPages(p: Para): (Para | 'page')[] {
  const out: (Para | 'page')[] = []
  if (p.props.pageBreakBefore) out.push('page')
  let cur: Tok[] = []
  for (const x of p.toks) {
    if (x.t === 'page') {
      if (!isBlank(cur)) out.push({ ...p, toks: cur })
      out.push('page')
      cur = []
    } else cur.push(x)
  }
  if (cur.length || out.length === 0) out.push({ ...p, toks: cur })
  return out
}

/** ProseMirror JSON leaves `content` out of an empty textblock. */
function compact<T extends ParagraphNode | HeadingNode>(node: T): T {
  if (node.content && node.content.length === 0) {
    const { content: _empty, ...rest } = node
    void _empty
    return rest as T
  }
  return node
}

function classify(p: Para, topLevel: boolean): ParagraphNode | HeadingNode {
  return compact(classifyRaw(p, topLevel))
}

function classifyRaw(p: Para, topLevel: boolean): ParagraphNode | HeadingNode {
  const align = p.props.align && p.props.align !== 'left' ? p.props.align : null
  const style = (p.props.style ?? '').toLowerCase().replace(/\s+/g, '')
  const text = plain(p.toks)
  const heading = (level: 1 | 2 | 3, toks: Tok[], numbered: boolean): HeadingNode => ({
    type: 'heading',
    attrs: { level, textAlign: align, numbered },
    content: toInline(withoutBold(toks)),
  })
  if (topLevel) {
    const lead = leadingText(p.toks)
    const sec = SECTION_PREFIX.exec(lead)
    if (style === 'title' || style === 'heading1') return heading(1, p.toks, false)
    if (style === 'heading2' || style === 'heading3') {
      const level = style === 'heading2' ? 2 : 3
      return sec && level === 2 ? heading(2, dropPrefix(p.toks, sec[0].length), true) : heading(level, p.toks, false)
    }
    if (allBold(p.toks) && text.trim().length <= 160) {
      if (sec) return heading(2, dropPrefix(p.toks, sec[0].length), true)
      if (align === 'center') return heading(1, p.toks, false)
      return heading(2, p.toks, false)
    }
    const clause = CLAUSE_PREFIX.exec(lead)
    if (clause) {
      return { type: 'paragraph', attrs: { textAlign: align, clause: true }, content: toInline(dropPrefix(p.toks, clause[0].length)) }
    }
  }
  return { type: 'paragraph', attrs: { textAlign: align, clause: false }, content: toInline(p.toks) }
}

function listKind(numbering: XmlEl | null, numId: string): 'bulletList' | 'orderedList' {
  if (!numbering) return 'orderedList'
  const num = elements(numbering).find((n) => n.name === 'w:num' && n.attrs['w:numId'] === numId)
  const abstractId = child(num, W('abstractNumId'))?.attrs['w:val']
  const abstract = elements(numbering).find((a) => a.name === 'w:abstractNum' && a.attrs['w:abstractNumId'] === abstractId)
  const lvl0 = abstract ? elements(abstract).find((l) => l.name === 'w:lvl' && l.attrs['w:ilvl'] === '0') : undefined
  return child(lvl0, W('numFmt'))?.attrs['w:val'] === 'bullet' ? 'bulletList' : 'orderedList'
}

function toBlocks(raw: readonly RawBlock[], topLevel: boolean, numbering: XmlEl | null): BlockNode[] {
  const out: BlockNode[] = []
  let list: { numId: string; node: Extract<BlockNode, { type: 'bulletList' | 'orderedList' }> } | null = null
  for (const b of raw) {
    if (b.kind === 'table') {
      list = null
      out.push(toTable(b, numbering))
      continue
    }
    // a paragraph emptied by a hidden section disappears; one that was empty
    // in the template (spacing, a signature line) stays
    if (b.hadSection && isBlank(b.toks.filter((x) => x.t !== 'br'))) continue
    for (const part of splitPages(b)) {
      if (part === 'page') {
        list = null
        if (topLevel) out.push({ type: 'pageBreak' })
        continue
      }
      if (part.props.num && topLevel) {
        const kind = listKind(numbering, part.props.num.numId)
        const item: ListItemNode = {
          type: 'listItem',
          content: [compact<ParagraphNode>({ type: 'paragraph', attrs: { textAlign: null, clause: false }, content: toInline(part.toks) })],
        }
        if (list && list.numId === part.props.num.numId && list.node.type === kind) list.node.content.push(item)
        else {
          list = { numId: part.props.num.numId, node: { type: kind, content: [item] } }
          out.push(list.node)
        }
        continue
      }
      list = null
      out.push(classify(part, topLevel))
    }
  }
  return out
}

function toTable(t: RawTable, numbering: XmlEl | null): TableNode {
  // grid positions, to turn vMerge continuations into row spans
  const grid = t.rows.map((row) => {
    let col = 0
    return row.cells.map((cell) => {
      const at = col
      col += cell.colspan
      return at
    })
  })
  const headerRow =
    t.rows.length > 1 &&
    t.rows[0]!.cells.every((c) => c.blocks.some((b) => b.kind === 'p' && allBold(b.toks)) &&
      c.blocks.every((b) => b.kind !== 'p' || isBlank(b.toks) || allBold(b.toks)))
  const rows: TableRowNode[] = t.rows.map((row, ri) => ({
    type: 'tableRow',
    content: row.cells
      .map((cell, ci): TableCellNode | null => {
        if (cell.vmerge === 'continue') return null
        let rowspan = 1
        if (cell.vmerge === 'restart') {
          for (let k = ri + 1; k < t.rows.length; k++) {
            const below = t.rows[k]!.cells.findIndex((_, cj) => grid[k]![cj] === grid[ri]![ci])
            if (below === -1 || t.rows[k]!.cells[below]!.vmerge !== 'continue') break
            rowspan++
          }
        }
        const content = toBlocks(cell.blocks, false, numbering)
        return {
          type: ri === 0 && headerRow ? 'tableHeader' : 'tableCell',
          attrs: { colspan: cell.colspan, rowspan, colwidth: null },
          content: content.length ? content : [{ type: 'paragraph', attrs: { textAlign: null, clause: false } }],
        }
      })
      .filter((c): c is TableCellNode => c !== null),
  }))
  return { type: 'table', attrs: { bordered: t.bordered }, content: rows.filter((r) => r.content.length > 0) }
}

function readLayout(document: XmlEl, styles: XmlEl | null): DocLayout {
  const body = document ? (elements(document).find((e) => e.name === 'w:body') ?? document) : null
  const sectPr = body ? elements(body).find((e) => e.name === 'w:sectPr') : undefined
  const pgSz = child(sectPr, W('pgSz'))
  const pgMar = child(sectPr, W('pgMar'))
  const num = (el: XmlEl | undefined, a: string, d: number) => {
    const v = Number(el?.attrs[`w:${a}`])
    return Number.isFinite(v) && v > 0 ? v : d
  }
  const rPrDefault = styles ? child(child(child(styles, W('docDefaults')), W('rPrDefault')), W('rPr')) : undefined
  const fonts = child(rPrDefault, W('rFonts'))
  const size = Number(child(rPrDefault, W('sz'))?.attrs['w:val'])
  return {
    font: fonts?.attrs['w:ascii'] ?? fonts?.attrs['w:hAnsi'] ?? null,
    sizeHalfPt: Number.isFinite(size) && size > 0 ? size : null,
    page: sectPr
      ? {
          w: num(pgSz, 'w', 11906),
          h: num(pgSz, 'h', 16838),
          top: num(pgMar, 'top', 1134),
          right: num(pgMar, 'right', 850),
          bottom: num(pgMar, 'bottom', 1134),
          left: num(pgMar, 'left', 1418),
        }
      : null,
  }
}

/** The whole conversion. `context` is buildWordingContext()'s output. */
export function templateToDoc(parts: TemplateParts, context: Record<string, unknown>): Conversion {
  const ctx: Ctx = { warnings: new Set() }
  const docRoot = parseXml(parts.document)
  const document = elements(docRoot).find((e) => e.name === 'w:document') ?? docRoot
  const body = elements(document).find((e) => e.name === 'w:body') ?? document
  if (body && elements(body).some((e) => e.name === 'w:sectPr' && elements(e).some((x) => /^w:(header|footer)Reference$/.test(x.name)))) {
    ctx.warnings.add('headerFooter')
  }
  const styles = parts.styles ? (elements(parseXml(parts.styles)).find((e) => e.name === 'w:styles') ?? null) : null
  const numbering = parts.numbering ? (elements(parseXml(parts.numbering)).find((e) => e.name === 'w:numbering') ?? null) : null

  const raw = readBlocks(body, ctx)
  const expanded = expandBlocks(raw, [{ data: context, loop: null }], ctx)
  const content = toBlocks(expanded, true, numbering)
  return {
    doc: {
      type: 'doc',
      attrs: { layout: readLayout(document, styles) },
      content: content.length ? content : [{ type: 'paragraph', attrs: { textAlign: null, clause: false } }],
    },
    warnings: [...ctx.warnings],
  }
}
