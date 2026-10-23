/** The offer's parameters as stored in the version's texts: parsed safely
 * from anything, the retired editor's blocks included. */

import { describe, expect, it } from 'vitest'

import { defaultOfferParams, NOTE_MAX, NOTE_MAX_BREAKS, normaliseNote, paramsForSave, parseOfferParams } from './params'
import { TCI_BROCHURE_VERSION } from './templates/tciTexts'

describe('parseOfferParams', () => {
  it('reads a stored kp object', () => {
    expect(
      parseOfferParams({ kind: 'kp', template: 'tci', template_version: 'TCI 09/26', cover: 'navy', note: 'Hello' }),
    ).toEqual({ kind: 'kp', template: 'tci', template_version: 'TCI 09/26', cover: 'navy', note: 'Hello' })
  })

  it('renders a version of the retired text editor with the default parameters', () => {
    const legacy = {
      intro: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Уважаемые коллеги' }] }] },
      why_tci: { type: 'doc', content: [] },
    }
    expect(parseOfferParams(legacy)).toEqual(defaultOfferParams())
  })

  it('never throws, whatever the row holds', () => {
    for (const v of [null, undefined, 0, 'kp', [], [{ kind: 'kp' }], { kind: 'other' }, { kind: 'kp', cover: 7 }]) {
      const p = parseOfferParams(v)
      expect(p.kind).toBe('kp')
      expect(p.template).toBe('tci')
      expect(['white', 'navy', 'blue']).toContain(p.cover)
    }
  })

  it('falls back field by field: an unknown cover or template, a note that is not text', () => {
    const p = parseOfferParams({ kind: 'kp', template: 'gold', cover: 'black', note: { a: 1 }, template_version: '' })
    expect(p).toEqual(defaultOfferParams())
  })

  it('defaults to the white cover, no note, the current template', () => {
    expect(defaultOfferParams()).toEqual({
      kind: 'kp',
      template: 'tci',
      template_version: TCI_BROCHURE_VERSION,
      cover: 'white',
      note: '',
    })
    expect(TCI_BROCHURE_VERSION).toBe('TCI 10/26')
  })
})

describe('the client note', () => {
  it('is cut at NOTE_MAX characters and trimmed', () => {
    expect(NOTE_MAX).toBe(600)
    expect(normaliseNote(`  ${'a'.repeat(700)}  `)).toHaveLength(600)
    expect(normaliseNote('   x  ')).toBe('x')
  })

  it('keeps at most NOTE_MAX_BREAKS line breaks and no blank lines', () => {
    expect(normaliseNote('a\r\n\r\n\r\nb')).toBe('a\nb')
    const many = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n')
    expect(normaliseNote(many).split('\n')).toHaveLength(NOTE_MAX_BREAKS + 1)
  })

  it('is stored normalised, with the current template version', () => {
    const p = paramsForSave({ cover: 'blue', note: ' a\n\n\nb ' })
    expect(p).toEqual({ kind: 'kp', template: 'tci', template_version: TCI_BROCHURE_VERSION, cover: 'blue', note: 'a\nb' })
  })
})
