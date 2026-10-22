/**
 * The brochure's words are the APPROVED ones: every statement of the fixed
 * template is a verbatim quote of src/features/brochure/defaultContent.ts in
 * the same language (docs/BROCHURE-CLAIMS.md); the two ⚠ statements the owner
 * has not confirmed are not printed; nothing invents a figure, a contact or a
 * name; and the words follow the CLAUDE.md glossary in ru and uz — for the
 * letter's labels too.
 */

import { describe, expect, it } from 'vitest'

import { BROCHURE_CLAIMS, defaultBrochureContent } from '../../../brochure/defaultContent'
import type { DocLang } from '../format'
import { LETTER_TEXTS } from './letterTexts'
import { TCI_TEXTS } from './tciTexts'

const LANGS: DocLang[] = ['ru', 'en', 'uz']
const content = defaultBrochureContent()
const source = (lang: DocLang) =>
  content.sections.map((s) => `${s.title[lang]}\n${s.body[lang]}`).join('\n').toLowerCase()

/** A statement as it is checked: no bold marks, no closing punctuation. */
const norm = (s: string) =>
  s
    .replace(/\*\*/g, '')
    .trim()
    .replace(/[.;:]+$/, '')
    .toLowerCase()

/** Every STATEMENT the template prints, per language. Labels (headings,
 * captions, the header's call to action, the diagram, the legal line) are
 * not statements; they are listed in LABELS below. */
function statements(lang: DocLang): string[] {
  const t = TCI_TEXTS[lang]
  const benefitItems = t.benefits.items.map((i, n) => (n === 4 ? i.text : `${i.title}. ${i.text}`))
  return [
    `${t.cover.titleA} ${t.cover.titleB}`,
    ...t.what.paragraphs,
    ...t.what.benefits,
    t.what.terms,
    t.what.quote,
    t.how.lead,
    ...t.how.steps,
    t.covered.lead,
    ...t.covered.events,
    ...t.covered.indemnity,
    ...t.covered.notCovered,
    t.covered.closing,
    ...benefitItems,
    ...t.limits.definition,
    ...t.limits.steps,
    t.limits.dl,
    t.process.lead,
    ...t.process.steps.map((s) => `${s.title}. ${s.text}`),
    ...t.faq.items.flatMap((i) => [i.q, i.a]),
    ...t.contacts.paragraphs,
  ]
}

/** Every string of a texts object; functions are called with samples. */
function strings(node: unknown): string[] {
  if (typeof node === 'string') return [node]
  if (typeof node === 'function') {
    const f = node as (...a: unknown[]) => string
    return [f('1', 'A'), f(1, 'A'), f(3, 'A'), f(5, 'A'), f(21, 'A')]
  }
  if (node && typeof node === 'object') return Object.values(node).flatMap(strings)
  return []
}

describe('the brochure quotes only approved statements', () => {
  for (const lang of LANGS)
    it(`${lang}: every statement is a verbatim quote of defaultContent.ts`, () => {
      const src = source(lang)
      const missing = statements(lang).filter((s) => !src.includes(norm(s)))
      expect(missing).toEqual([])
    })

  it('the page headings are the approved section titles', () => {
    for (const lang of LANGS) {
      const t = TCI_TEXTS[lang]
      const titles = Object.fromEntries(content.sections.map((s) => [s.key, s.title[lang]]))
      expect(t.what.title).toBe(titles.what)
      expect(t.how.title).toBe(titles.how)
      expect(t.covered.title).toBe(titles.covered)
      expect(t.benefits.title).toBe(titles.benefits)
      expect(t.limits.title).toBe(titles.limits)
      expect(t.process.title).toBe(titles.process)
      expect(t.faq.title).toBe(titles.faq)
      expect(t.contacts.title).toBe(titles.contacts)
    }
  })

  it('prints every FAQ answer of the approved text', () => {
    for (const lang of LANGS) expect(TCI_TEXTS[lang].faq.items).toHaveLength(6)
  })
})

describe('the two ⚠ statements are left out', () => {
  it('BROCHURE_CLAIMS marks exactly #14 (disputed amounts) and #18 (collection support) pending', () => {
    const pending = BROCHURE_CLAIMS.map((c, i) => (c.pending ? i + 1 : null)).filter((n) => n !== null)
    expect(pending).toEqual([14, 18])
  })

  const PENDING_PHRASES: Record<DocLang, RegExp[]> = {
    ru: [/оспарива/i, /содействи\S* во взыскании/i, /до разрешения спора/i],
    en: [/disput/i, /collection support/i, /support in collecting/i],
    uz: [/nizo/i, /undirishda ko‘mak/i],
  }
  for (const lang of LANGS)
    it(`${lang}: no disputed-amounts exclusion, no collection support`, () => {
      const all = [...strings(TCI_TEXTS[lang]), ...strings(LETTER_TEXTS[lang])].join('\n')
      for (const re of PENDING_PHRASES[lang]) expect(all, String(re)).not.toMatch(re)
    })
})

describe('nothing invented', () => {
  for (const lang of LANGS)
    it(`${lang}: no figure, percentage, ranking, guarantee, contact or link in the template's words`, () => {
      const all = [...strings(TCI_TEXTS[lang]), ...strings(LETTER_TEXTS[lang]).filter((s) => !/\b(1|3|5|21)\b/.test(s))]
      const offenders = (re: RegExp) => all.filter((s) => re.test(s))
      expect(offenders(/\d/)).toEqual([])
      expect(offenders(/№\s*1|#\s*1|number one|лидер|leader|yetakchi/i)).toEqual([])
      expect(offenders(/гарант|guarantee|kafolat/i)).toEqual([])
      expect(offenders(/award|наград|best|лучш|eng yaxshi/i)).toEqual([])
      expect(offenders(/@|https?:|www\./i)).toEqual([])
    })
})

describe('the glossary', () => {
  const ru = [...strings(TCI_TEXTS.ru), ...strings(LETTER_TEXTS.ru)]
  const uz = [...strings(TCI_TEXTS.uz), ...strings(LETTER_TEXTS.uz)]
  const hits = (list: string[], re: RegExp) => list.filter((s) => re.test(s))

  it('ru: Байер, never «покупатель»; the owner-decided terms, no retired variant', () => {
    expect(hits(ru, /покупател/i)).toEqual([])
    expect(hits(ru, /байер/i).length).toBeGreaterThan(0)
    expect(hits(ru, /некредитуем|некомпенсируем|неквалифицируем|совокупн\S* франшиз|страховой процент|доля покрытия/i)).toEqual([])
    expect(hits(ru, /требовани\S* о возмещении|по договору|договор страхования/i)).toEqual([])
    expect(hits(ru, /Невозмещаемые убытки \(NQL\)/).length).toBeGreaterThan(0)
    expect(hits(ru, /Процент покрытия/).length).toBeGreaterThan(0)
    expect(hits(ru, /Агрегатная франшиза/).length).toBeGreaterThan(0)
    expect(hits(ru, /Страхователь|страховател/).length).toBeGreaterThan(0)
  })

  it('uz: Bayer, Sug‘urtalanuvchi, xabarnoma, da’vo; U+2018 apostrophes; no bare «Bekor qilish»', () => {
    expect(hits(uz, /xaridor/i)).toEqual([])
    expect(hits(uz, /bildirishnom/i)).toEqual([])
    expect(hits(uz, /Sug‘urta qildiruvchi/i)).toEqual([])
    expect(hits(uz, /bayer/i).length).toBeGreaterThan(0)
    expect(hits(uz, /sug‘urtalanuvchi/i).length).toBeGreaterThan(0)
    expect(hits(uz, /xabarnoma/i).length).toBeGreaterThan(0)
    expect(hits(uz, /da’vo/i).length).toBeGreaterThan(0)
    expect(hits(uz, /Qoplanmaydigan zarar \(NQL\)/).length).toBeGreaterThan(0)
    expect(hits(uz, /Diskretsion limit/).length).toBeGreaterThan(0)
    // o‘ / g‘ with U+2018, the glottal stop with U+2019 — never an ASCII
    // quote, the turned comma or a backtick
    expect(hits(uz, /'|ʻ|`/)).toEqual([])
    const bare = uz.filter((s) =>
      [...s.matchAll(/bekor qilish/gi)].some((m) => !/\S+ni\s+$/i.test(s.slice(0, m.index))),
    )
    expect(bare).toEqual([])
  })
})
