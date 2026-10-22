/** The upload form's rules: required alt in three languages, source and
 * licence, CC BY's author, and what is sent. */

import { describe, expect, it } from 'vitest'

import {
  EMPTY_META,
  byteSize,
  licenceChoiceOf,
  licenceValue,
  metaFromAsset,
  metaPayload,
  metaProblems,
} from './media'
import type { MediaMetaForm } from './media'
import type { MediaAsset } from './model'

const filled: MediaMetaForm = {
  alt: { ru: 'Склад', en: 'Warehouse', uz: 'Ombor' },
  source: 'Own shoot',
  licenceChoice: 'own',
  licenceText: '',
  author: '',
  sourceUrl: '',
}

describe('media metadata', () => {
  it('requires every alt language, the source and the licence', () => {
    expect(Object.keys(metaProblems(EMPTY_META)).sort()).toEqual([
      'alt.en',
      'alt.ru',
      'alt.uz',
      'licence',
      'source',
    ])
    expect(metaProblems(filled)).toEqual({})
    expect(metaProblems({ ...filled, alt: { ...filled.alt, uz: '  ' } })).toEqual({
      'alt.uz': 'media.errors.altRequired',
    })
  })

  it('takes «Другое» as the typed name, and refuses it empty', () => {
    expect(metaProblems({ ...filled, licenceChoice: 'other', licenceText: ' ' })).toEqual({
      licence: 'media.errors.licenceRequired',
    })
    expect(
      licenceValue({ licenceChoice: 'other', licenceText: ' Contract with the studio ' }),
    ).toBe('Contract with the studio')
    expect(licenceValue({ licenceChoice: 'ccBy', licenceText: 'ignored' })).toBe('CC BY 4.0')
  })

  it('asks for the author under CC BY', () => {
    expect(metaProblems({ ...filled, licenceChoice: 'ccBy' })).toEqual({
      author: 'media.errors.authorRequired',
    })
    expect(metaProblems({ ...filled, licenceChoice: 'ccBy', author: 'A. Photographer' })).toEqual(
      {},
    )
  })

  it('accepts only a web link as the source URL', () => {
    expect(metaProblems({ ...filled, sourceUrl: 'javascript:alert(1)' })).toEqual({
      sourceUrl: 'media.errors.sourceUrlInvalid',
    })
    expect(metaProblems({ ...filled, sourceUrl: 'https://example.org/photo/1' })).toEqual({})
  })

  it('sends trimmed values and nulls for the optional ones', () => {
    expect(metaPayload({ ...filled, source: '  Own shoot ', author: ' ', sourceUrl: '' })).toEqual({
      p_alt: { en: 'Warehouse', ru: 'Склад', uz: 'Ombor' },
      p_source: 'Own shoot',
      p_licence: "Owner's own photo",
      p_author: null,
      p_source_url: null,
    })
  })

  it('round-trips a stored asset into the edit form', () => {
    const asset = {
      alt: { ru: 'р', en: 'e', uz: 'u' },
      source: 'Studio',
      licence: 'Contract with the studio',
      author: null,
      source_url: null,
    } as unknown as MediaAsset
    expect(metaFromAsset(asset)).toMatchObject({
      licenceChoice: 'other',
      licenceText: 'Contract with the studio',
    })
    expect(licenceChoiceOf('Pexels License')).toBe('pexels')
  })

  it('names a file size with its unit', () => {
    expect(byteSize(5 * 1024 * 1024)).toEqual({ value: '5.0', unit: 'mb' })
    expect(byteSize(300 * 1024)).toEqual({ value: '300', unit: 'kb' })
    expect(byteSize(10)).toEqual({ value: '1', unit: 'kb' })
  })
})
