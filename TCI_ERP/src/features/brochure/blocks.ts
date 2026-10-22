/**
 * Section bodies as the renderer lays them out: parseBody's blocks, with each
 * FAQ question gathered together with the paragraphs and bullets that answer
 * it, so a question and its answer are styled — and kept on one printed page —
 * as one item.
 */

import { parseBody } from './model'
import type { BodyBlock } from './model'

export type AnswerBlock = Exclude<BodyBlock, { kind: 'question' }>

export type LaidOutBlock = AnswerBlock | { kind: 'faq'; question: string; answer: AnswerBlock[] }

export function layoutBody(body: string): LaidOutBlock[] {
  const out: LaidOutBlock[] = []
  let open: Extract<LaidOutBlock, { kind: 'faq' }> | null = null
  for (const block of parseBody(body)) {
    if (block.kind === 'question') {
      open = { kind: 'faq', question: block.text, answer: [] }
      out.push(open)
    } else if (open) open.answer.push(block)
    else out.push(block)
  }
  return out
}
