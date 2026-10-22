/**
 * Comparing two versions of a contract (pure). The documents are read as
 * LINES — a heading or paragraph with its derived number, a list item, a
 * table row (cells joined by « | »), a page break — aligned by a longest
 * common subsequence; a deleted line followed by an inserted one is a
 * CHANGED line, compared word by word. The screen draws the result inline
 * (insertions and deletions in one column) or side by side.
 */

import type { BlockNode, ContractDoc } from './model'
import { blockText, inlineText } from './model'
import { docNumbering } from './numbering'

export type LineKind = 'title' | 'heading' | 'paragraph' | 'clause' | 'item' | 'row' | 'pageBreak'

export interface Line {
  kind: LineKind
  /** The derived clause or section number, when it has one. */
  label: string | null
  text: string
}

export type SegmentOp = 'equal' | 'insert' | 'delete'
export interface Segment {
  op: SegmentOp
  text: string
}

export interface DiffLine {
  op: 'equal' | 'insert' | 'delete' | 'change'
  kind: LineKind
  /** Left (older) and right (newer) labels and texts; null on the side the
   * line does not exist. */
  before: Line | null
  after: Line | null
  /** Word-level segments for a changed line; one segment otherwise. */
  segments: Segment[]
}

export const PAGE_BREAK_TEXT = '⸻'

export function docLines(doc: ContractDoc): Line[] {
  const labels = docNumbering(doc)
  const out: Line[] = []
  doc.content.forEach((block: BlockNode, i) => {
    switch (block.type) {
      case 'heading':
        out.push({
          kind: block.attrs.level === 1 ? 'title' : 'heading',
          label: labels[i] ?? null,
          text: inlineText(block.content),
        })
        break
      case 'paragraph':
        out.push({ kind: block.attrs?.clause ? 'clause' : 'paragraph', label: labels[i] ?? null, text: inlineText(block.content) })
        break
      case 'bulletList':
      case 'orderedList':
        block.content.forEach((item, k) =>
          out.push({
            kind: 'item',
            label: block.type === 'orderedList' ? `${(block.attrs?.start ?? 1) + k}.` : '•',
            text: item.content.map(blockText).join(' '),
          }),
        )
        break
      case 'table':
        block.content.forEach((row) =>
          out.push({
            kind: 'row',
            label: null,
            text: row.content.map((cell) => cell.content.map(blockText).join(' ').trim()).join(' | '),
          }),
        )
        break
      case 'pageBreak':
        out.push({ kind: 'pageBreak', label: null, text: PAGE_BREAK_TEXT })
        break
    }
  })
  return out
}

// The derived number is not part of a line's identity: inserting a clause
// renumbers everything after it, and that alone is not a change of text.
const lineKey = (l: Line) => `${l.kind}\u0001${l.text}`

/** Longest common subsequence as a list of operations over two sequences. */
export function lcsOps<T>(a: readonly T[], b: readonly T[], eq: (x: T, y: T) => boolean): ('equal' | 'insert' | 'delete')[] {
  // Trim the common head and tail first: most versions differ in a few places.
  let head = 0
  while (head < a.length && head < b.length && eq(a[head]!, b[head]!)) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && eq(a[a.length - 1 - tail]!, b[b.length - 1 - tail]!)) tail++
  const A = a.slice(head, a.length - tail)
  const B = b.slice(head, b.length - tail)
  const n = A.length
  const m = B.length
  const middle: ('equal' | 'insert' | 'delete')[] = []
  if (n * m > 4_000_000) {
    // too large to align cell by cell: the middle is replaced wholesale
    middle.push(...A.map(() => 'delete' as const), ...B.map(() => 'insert' as const))
  } else {
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i]![j] = eq(A[i]!, B[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
      }
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (eq(A[i]!, B[j]!)) {
        middle.push('equal')
        i++
        j++
      } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
        middle.push('delete')
        i++
      } else {
        middle.push('insert')
        j++
      }
    }
    while (i++ < n) middle.push('delete')
    while (j++ < m) middle.push('insert')
  }
  return [...Array<'equal'>(head).fill('equal'), ...middle, ...Array<'equal'>(tail).fill('equal')]
}

/** Words, runs of spaces and punctuation, so a diff never splits a word. */
export function tokenizeWords(text: string): string[] {
  return text.match(/[\p{L}\p{N}_’‘'-]+|\s+|[^\p{L}\p{N}\s]/gu) ?? []
}

export function diffWords(before: string, after: string): Segment[] {
  const a = tokenizeWords(before)
  const b = tokenizeWords(after)
  const ops = lcsOps(a, b, (x, y) => x === y)
  const out: Segment[] = []
  let i = 0
  let j = 0
  for (const op of ops) {
    const text = op === 'insert' ? b[j++]! : op === 'delete' ? a[i++]! : (i++, b[j++]!)
    const last = out[out.length - 1]
    if (last && last.op === op) last.text += text
    else out.push({ op, text })
  }
  return out
}

export function diffDocs(older: ContractDoc, newer: ContractDoc): DiffLine[] {
  const a = docLines(older)
  const b = docLines(newer)
  const ops = lcsOps(a, b, (x, y) => lineKey(x) === lineKey(y))
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  let k = 0
  while (k < ops.length) {
    if (ops[k] === 'equal') {
      const line = b[j]!
      out.push({ op: 'equal', kind: line.kind, before: a[i]!, after: line, segments: [{ op: 'equal', text: line.text }] })
      i++
      j++
      k++
      continue
    }
    // a run of deletions and insertions: pair them up as changed lines
    const dels: Line[] = []
    const ins: Line[] = []
    while (k < ops.length && ops[k] !== 'equal') {
      if (ops[k] === 'delete') dels.push(a[i++]!)
      else ins.push(b[j++]!)
      k++
    }
    const pairs = Math.min(dels.length, ins.length)
    for (let p = 0; p < pairs; p++) {
      const before = dels[p]!
      const after = ins[p]!
      out.push({ op: 'change', kind: after.kind, before, after, segments: diffWords(before.text, after.text) })
    }
    for (const before of dels.slice(pairs)) {
      out.push({ op: 'delete', kind: before.kind, before, after: null, segments: [{ op: 'delete', text: before.text }] })
    }
    for (const after of ins.slice(pairs)) {
      out.push({ op: 'insert', kind: after.kind, before: null, after, segments: [{ op: 'insert', text: after.text }] })
    }
  }
  return out
}

export interface DiffSummary {
  inserted: number
  deleted: number
  changed: number
}

export function diffSummary(lines: readonly DiffLine[]): DiffSummary {
  return {
    inserted: lines.filter((l) => l.op === 'insert').length,
    deleted: lines.filter((l) => l.op === 'delete').length,
    changed: lines.filter((l) => l.op === 'change').length,
  }
}
