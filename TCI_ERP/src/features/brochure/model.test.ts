/** The plain-text conventions of a section body, and how the renderer lays
 * them out (FAQ questions gathered with their answers). */

import { describe, expect, it } from 'vitest'

import { layoutBody } from './blocks'
import { wrapLabel } from './diagram'
import { parseBody } from './model'

describe('parseBody', () => {
  it('splits paragraphs on blank lines and joins wrapped lines', () => {
    expect(parseBody('One line\ncontinues here.\n\nSecond paragraph.')).toEqual([
      { kind: 'paragraph', text: 'One line continues here.' },
      { kind: 'paragraph', text: 'Second paragraph.' },
    ])
  })

  it('reads "- " lines as one bullet list, after the paragraph that introduces it', () => {
    expect(parseBody('Not covered:\n- over the limit;\n- outside the period.')).toEqual([
      { kind: 'paragraph', text: 'Not covered:' },
      { kind: 'bullets', items: ['over the limit;', 'outside the period.'] },
    ])
  })

  it('reads "? " lines as questions', () => {
    expect(parseBody('? Why?\nBecause.')).toEqual([
      { kind: 'question', text: 'Why?' },
      { kind: 'paragraph', text: 'Because.' },
    ])
  })

  it('tolerates Windows line ends, blank lines with spaces and empty input', () => {
    expect(parseBody('A\r\n  \r\nB')).toEqual([
      { kind: 'paragraph', text: 'A' },
      { kind: 'paragraph', text: 'B' },
    ])
    expect(parseBody('')).toEqual([])
    expect(parseBody('\n\n\n')).toEqual([])
  })

  it('does not take a dash inside a sentence for a bullet', () => {
    expect(parseBody('Cover — as the policy sets.')).toEqual([
      { kind: 'paragraph', text: 'Cover — as the policy sets.' },
    ])
  })
})

describe('layoutBody', () => {
  it('gathers each question with the blocks that answer it', () => {
    expect(layoutBody('Intro.\n\n? Q1\nA1.\n\n- point\n\n? Q2\nA2.')).toEqual([
      { kind: 'paragraph', text: 'Intro.' },
      {
        kind: 'faq',
        question: 'Q1',
        answer: [
          { kind: 'paragraph', text: 'A1.' },
          { kind: 'bullets', items: ['point'] },
        ],
      },
      { kind: 'faq', question: 'Q2', answer: [{ kind: 'paragraph', text: 'A2.' }] },
    ])
  })

  it('keeps a question without an answer', () => {
    expect(layoutBody('? Lonely')).toEqual([{ kind: 'faq', question: 'Lonely', answer: [] }])
  })
})

describe('wrapLabel', () => {
  it('breaks on spaces within the budget', () => {
    expect(wrapLabel('Cover and credit limits', 12)).toEqual(['Cover and', 'credit', 'limits'])
    expect(wrapLabel('Premium', 12)).toEqual(['Premium'])
  })

  it('keeps an overlong word whole and folds overflow into the last line', () => {
    expect(wrapLabel('Sug‘urtalanuvchi', 8)).toEqual(['Sug‘urtalanuvchi'])
    expect(wrapLabel('a b c d e f', 1, 3)).toEqual(['a', 'b', 'c d e f'])
  })
})
