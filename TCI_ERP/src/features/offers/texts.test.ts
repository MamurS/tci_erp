import { describe, expect, it } from 'vitest'

import en from '../../i18n/locales/en.json'
import ru from '../../i18n/locales/ru.json'
import uz from '../../i18n/locales/uz.json'
import { defaultTexts, isEmptyDoc, printableBlocks, textToDoc } from './texts'

describe('textToDoc', () => {
  it('makes paragraphs and bullet lists', () => {
    const doc = textToDoc('First line\ncontinues.\n\n- one\n- two\n\nLast.')
    expect(doc.type).toBe('doc')
    expect(doc.content.map((n) => n.type)).toEqual(['paragraph', 'bulletList', 'paragraph'])
    expect(JSON.stringify(doc.content[0])).toContain('First line continues.')
    expect(JSON.stringify(doc.content[1])).toContain('"two"')
  })

  it('an empty text is an empty document', () => {
    const doc = textToDoc('   ')
    expect(isEmptyDoc(doc)).toBe(true)
  })
})

describe('default texts', () => {
  it('fill every block from the locale and print all of them', () => {
    const texts = defaultTexts((key) => {
      const [, , block] = key.split('.')
      return (ru.offers.defaults as Record<string, string>)[block!]!
    })
    expect(printableBlocks(texts)).toEqual(['intro', 'why_tci', 'conditions', 'next_steps'])
  })

  it('make no claim the owner has not approved: no figures, rankings or guarantees', () => {
    for (const locale of [ru, en, uz]) {
      const text = Object.values(locale.offers.defaults).join(' ')
      expect(text).not.toMatch(/\d+\s?%|№\s?1|лидер|гарантир|крупнейш|\bbest\b|leading|guarantee|kafolat/i)
    }
  })
})
