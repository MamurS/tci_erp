/** The editor's pure rules: a stored version made whole, what is an edit,
 * what is still missing, and the preview's library images. */

import { describe, expect, it } from 'vitest'

import { defaultBrochureContent } from './defaultContent'
import {
  brochureLangOf,
  editablePayload,
  isDirty,
  missingTexts,
  normalizeContent,
  sectionMissingLangs,
  updateSection,
  withLibraryImages,
} from './editor'
import { BROCHURE_SECTION_KEYS } from './model'

describe('normalizeContent', () => {
  it('returns every section in print order, whatever the stored order and gaps', () => {
    const stored = {
      sections: [
        { key: 'faq', title: { ru: 'Вопросы' }, body: { ru: '? A\nB' } },
        {
          key: 'what',
          title: { ru: 'Что', en: 'What', uz: 'Nima' },
          body: { ru: 'x', en: 'y', uz: 'z' },
        },
        { key: 'unknown', title: { ru: 'x' }, body: { ru: 'x' } },
      ],
    }
    const out = normalizeContent(stored)
    expect(out.sections.map((s) => s.key)).toEqual([...BROCHURE_SECTION_KEYS])
    expect(out.sections[0]?.title).toEqual({ ru: 'Что', en: 'What', uz: 'Nima' })
    const faq = out.sections.find((s) => s.key === 'faq')
    expect(faq?.title).toEqual({ ru: 'Вопросы', en: '', uz: '' })
    expect(out.sections.find((s) => s.key === 'how')?.body).toEqual({ ru: '', en: '', uz: '' })
  })

  it('survives garbage', () => {
    expect(normalizeContent(null).sections).toHaveLength(BROCHURE_SECTION_KEYS.length)
    expect(normalizeContent({ sections: 'no' }).sections).toHaveLength(BROCHURE_SECTION_KEYS.length)
  })

  it('keeps the server-stamped image only while the section names one', () => {
    const out = normalizeContent({
      sections: [
        {
          key: 'what',
          image_asset_id: 'a1',
          image_path: 'p.png',
          image_alt: { ru: 'r', en: 'e', uz: 'u' },
        },
        { key: 'how', image_path: 'stale.png' },
      ],
    })
    expect(out.sections[0]).toMatchObject({
      image_asset_id: 'a1',
      image_path: 'p.png',
      image_alt: { ru: 'r', en: 'e', uz: 'u' },
    })
    expect(out.sections[1]).toMatchObject({
      image_asset_id: null,
      image_path: null,
      image_alt: null,
    })
  })
})

describe('editablePayload', () => {
  it('never sends the image path or alt — the server stamps them', () => {
    const content = updateSection(defaultBrochureContent(), 'what', (s) => ({
      ...s,
      image_asset_id: 'a1',
      image_path: 'forged.png',
      image_alt: { ru: 'x', en: 'x', uz: 'x' },
    }))
    const what = editablePayload(content).sections[0]
    expect(what).toHaveProperty('image_asset_id', 'a1')
    expect(what).not.toHaveProperty('image_path')
    expect(what).not.toHaveProperty('image_alt')
    expect(editablePayload(defaultBrochureContent()).sections[1]).not.toHaveProperty(
      'image_asset_id',
    )
  })
})

describe('isDirty', () => {
  it('compares the words and the image chosen, not the stamps', () => {
    const base = defaultBrochureContent()
    expect(isDirty(base, null)).toBe(true)
    expect(isDirty(normalizeContent(base), base)).toBe(false)
    const stamped = updateSection(base, 'how', (s) => ({ ...s, image_path: 'x.png' }))
    expect(isDirty(stamped, base)).toBe(false)
    const edited = updateSection(base, 'how', (s) => ({
      ...s,
      title: { ...s.title, uz: 'Boshqa' },
    }))
    expect(isDirty(edited, base)).toBe(true)
  })
})

describe('missing texts', () => {
  it('lists every empty title and body per language', () => {
    expect(missingTexts(defaultBrochureContent())).toEqual([])
    const gap = updateSection(defaultBrochureContent(), 'faq', (s) => ({
      ...s,
      body: { ...s.body, en: '  ' },
    }))
    expect(missingTexts(gap)).toEqual([{ key: 'faq', lang: 'en', field: 'body' }])
    expect(sectionMissingLangs(gap.sections.find((s) => s.key === 'faq')!)).toEqual(['en'])
  })
})

describe('withLibraryImages', () => {
  it('previews a newly chosen image from the library row', () => {
    const content = updateSection(defaultBrochureContent(), 'what', (s) => ({
      ...s,
      image_asset_id: 'a1',
    }))
    const out = withLibraryImages(content, [
      { id: 'a1', storage_path: 'a1.png', alt: { ru: 'р', en: 'e', uz: 'u' } },
    ])
    expect(out.sections[0]).toMatchObject({
      image_path: 'a1.png',
      image_alt: { ru: 'р', en: 'e', uz: 'u' },
    })
    expect(out.sections[1]).toMatchObject({ image_path: null })
  })
})

describe('brochureLangOf', () => {
  it('maps the interface language, Russian by default', () => {
    expect(brochureLangOf('uz')).toBe('uz')
    expect(brochureLangOf('de')).toBe('ru')
    expect(brochureLangOf(undefined)).toBe('ru')
  })
})
