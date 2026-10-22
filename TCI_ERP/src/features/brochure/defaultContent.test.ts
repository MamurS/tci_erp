/** The default draft: complete in every language, in print order, in the
 * glossary's terms, and free of the statements a brochure must not invent. */

import { describe, expect, it } from 'vitest'

import { layoutBody } from './blocks'
import { BROCHURE_CLAIMS, defaultBrochureContent } from './defaultContent'
import { BROCHURE_LANGS, BROCHURE_SECTION_KEYS } from './model'

const content = defaultBrochureContent()
const texts = content.sections.flatMap((s) =>
  BROCHURE_LANGS.flatMap((lang) => [
    { where: `${s.key}.title.${lang}`, lang, text: s.title[lang] },
    { where: `${s.key}.body.${lang}`, lang, text: s.body[lang] },
  ]),
)
const offenders = (pattern: RegExp, lang?: string) =>
  texts.filter((x) => (!lang || x.lang === lang) && pattern.test(x.text)).map((x) => x.where)

describe('default brochure draft', () => {
  it('has every section, in print order', () => {
    expect(content.sections.map((s) => s.key)).toEqual([...BROCHURE_SECTION_KEYS])
  })

  it('fills every title and body in every language', () => {
    for (const x of texts) expect(x.text.trim(), x.where).not.toBe('')
  })

  it('is a fresh object each time (the editor changes it freely)', () => {
    const a = defaultBrochureContent()
    a.sections[0]!.title.ru = 'changed'
    expect(defaultBrochureContent().sections[0]!.title.ru).not.toBe('changed')
  })

  it('invents no statistics, percentages, rankings or guarantees', () => {
    // No digit at all: no figure, share, year or rank can slip in.
    expect(offenders(/\d/)).toEqual([])
    expect(offenders(/%|процент(ов|а)? (клиентов|рынка)/i)).toEqual([])
    expect(offenders(/№\s*1|#\s*1|number one|лидер|leader|yetakchi/i)).toEqual([])
    expect(offenders(/гарант|guarantee|kafolat/i)).toEqual([])
    expect(offenders(/award|наград|mukofotla|рейтинг агентств|best|лучш|eng yaxshi/i)).toEqual([])
    // No contact details made up.
    expect(offenders(/@|https?:|www\.|\+\s?\d|тел\.|phone/i)).toEqual([])
  })

  it('uses the glossary: Байер / Bayer, never «покупатель» / «xaridor»', () => {
    expect(offenders(/покупател/i, 'ru')).toEqual([])
    expect(offenders(/xaridor/i, 'uz')).toEqual([])
    expect(offenders(/байер/i, 'ru').length).toBeGreaterThan(0)
    expect(offenders(/bayer/i, 'uz').length).toBeGreaterThan(0)
  })

  it('uses the decided ru terms', () => {
    expect(
      offenders(
        /некредитуем|некомпенсируем|неквалифицируем|страховой процент|доля покрытия/i,
        'ru',
      ),
    ).toEqual([])
    expect(offenders(/по договору|договор страхования/i, 'ru')).toEqual([])
    expect(offenders(/Требовани\S* о возмещении/i, 'ru')).toEqual([])
    expect(texts.find((x) => x.where === 'covered.body.ru')?.text).toContain(
      'невозмещаемых убытков (NQL)',
    )
    expect(texts.find((x) => x.where === 'what.body.ru')?.text).toContain('процент покрытия')
  })

  it('uses the decided uz terms and apostrophes', () => {
    expect(offenders(/bildirishnom/i, 'uz')).toEqual([])
    expect(offenders(/Sug‘urta qildiruvchi/i, 'uz')).toEqual([])
    expect(offenders(/xabarnoma/i, 'uz').length).toBeGreaterThan(0)
    // «qaltislik» declines to «qaltisligi» before a suffix.
    expect(offenders(/qaltisli[kg]/i, 'uz').length).toBeGreaterThan(0)
    expect(offenders(/Diskretsion limit/i, 'uz').length).toBeGreaterThan(0)
    expect(offenders(/Qoplanmaydigan zarar \(NQL\)/i, 'uz').length).toBeGreaterThan(0)
    // o‘ / g‘ with U+2018, never an ASCII quote or the turned comma.
    expect(offenders(/'|ʻ|`/, 'uz')).toEqual([])
    // «bekor qilish» only ever with its object in front («limitni bekor
    // qilish») — the homonymy rule.
    const bare = texts.filter(
      (x) =>
        x.lang === 'uz' &&
        [...x.text.matchAll(/bekor qilish/gi)].some(
          (m) => !/\S+ni\s+$/i.test(x.text.slice(0, m.index)),
        ),
    )
    expect(bare.map((x) => x.where)).toEqual([])
  })

  it('writes the FAQ as questions with answers', () => {
    for (const lang of BROCHURE_LANGS) {
      const faq = content.sections.find((s) => s.key === 'faq')!
      const items = layoutBody(faq.body[lang]).filter((b) => b.kind === 'faq')
      expect(items.length, lang).toBeGreaterThanOrEqual(5)
      expect(items.length, lang).toBeLessThanOrEqual(7)
      for (const item of items)
        expect(
          item.kind === 'faq' && item.answer.length,
          `${lang}: ${item.kind === 'faq' ? item.question : ''}`,
        ).toBeGreaterThan(0)
    }
  })

  it('names no image (images are chosen from the library by a person)', () => {
    for (const s of content.sections) expect(s.image_asset_id ?? null).toBeNull()
  })
})

describe('BROCHURE_CLAIMS', () => {
  it('lists the statements of every section, in Russian, each typed', () => {
    const sections = new Set(BROCHURE_CLAIMS.map((c) => c.section))
    for (const key of BROCHURE_SECTION_KEYS) expect(sections.has(key), key).toBe(true)
    for (const c of BROCHURE_CLAIMS) {
      expect(c.lang).toBe('ru')
      expect(['factual', 'marketing']).toContain(c.kind)
      expect(c.text.trim()).not.toBe('')
    }
  })
})
