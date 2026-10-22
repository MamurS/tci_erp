/** The offer renderer: the page order, every language × cover, the letter's
 * continuation, escaping, and the numbers and dates in the document's own
 * language. Pure — no DOM. */

import { describe, expect, it } from 'vitest'

import type { DocLang } from './format'
import { countryNames } from './input'
import { defaultOfferParams, OFFER_COVERS, type OfferParams } from './params'
import { offerSrcdoc, renderOffer, type OfferRenderContext } from './render'
import { sampleOfferData, SAMPLE_COUNTRIES } from './sampleData'
import { TCI_PAGE_COUNT, tciBrochurePages } from './templates/tci'

const LANGS: DocLang[] = ['ru', 'en', 'uz']
const NBSP = '\u00a0'

const ctxFor = (lang: DocLang, patch: Partial<OfferRenderContext> = {}): OfferRenderContext => ({
  lang,
  offerNumber: 'KP-2026-0001',
  versionNo: 1,
  date: '2026-10-22T06:00:00Z',
  validUntil: '2026-11-21',
  includeBrochure: true,
  countries: countryNames(SAMPLE_COUNTRIES, lang),
  ...patch,
})
const params = (patch: Partial<OfferParams> = {}): OfferParams => ({ ...defaultOfferParams(), ...patch })

/** All letter pages of a render, as one string. */
const letterOf = (r: { pagesHtml: string[]; letter: { index: number; count: number } }) =>
  r.pagesHtml.slice(r.letter.index, r.letter.index + r.letter.count).join('\n')

const LETTER_TITLE: Record<DocLang, string> = { ru: 'Коммерческое предложение', en: 'Commercial offer', uz: 'Tijorat taklifi' }

describe('renderOffer — every language and cover', () => {
  for (const lang of LANGS)
    for (const cover of OFFER_COVERS) {
      it(`${lang}-${cover}: cover, the letter, then brochure pages 2…${TCI_PAGE_COUNT}, nothing left unfilled`, () => {
        const data = sampleOfferData()
        const r = renderOffer(params({ cover }), data, ctxFor(lang))
        const brochure = tciBrochurePages({ lang, cover, data, date: '2026-10-22T06:00:00Z' })
        expect(brochure).toHaveLength(TCI_PAGE_COUNT)
        // 1 the cover, verbatim
        expect(r.pagesHtml[0]).toBe(brochure[0])
        expect(r.pagesHtml[0]).toContain(`data-kp-cover="${cover}"`)
        // 2 the letter: page 1 with the terms and the premium, then the buyers
        expect(r.letter.index).toBe(1)
        expect(r.letter.count).toBe(2)
        expect(r.pagesHtml[1]).toContain('data-kp-letter="1"')
        expect(r.pagesHtml[1]).toContain(LETTER_TITLE[lang])
        expect(r.pagesHtml[2]).toContain('data-kp-letter="2"')
        expect(letterOf(r).match(/<tr data-kp-buyer>/g)).toHaveLength(6)
        // 3… the brochure's own pages, in order and unchanged
        expect(r.pagesHtml.slice(1 + r.letter.count)).toEqual(brochure.slice(1))
        expect(r.pagesHtml).toHaveLength(TCI_PAGE_COUNT + r.letter.count)
        const all = r.pagesHtml.join('\n')
        expect(all).not.toMatch(/\{\{[^}]*\}\}/)
        expect(all).not.toMatch(/\*\*/)
        expect(all).not.toMatch(/<script/i)
        expect(all).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i)
        expect(all).not.toMatch(/(src|href)\s*=\s*["']?(https?:|\/\/)/i)
        expect(all).not.toContain('undefined')
        expect(all).not.toContain('NaN')
        expect(all).not.toContain('[object')
      })
    }

  it('the cover is the only page that differs between covers', () => {
    const data = sampleOfferData()
    const [white, navy, blue] = OFFER_COVERS.map((cover) => renderOffer(params({ cover }), data, ctxFor('ru')).pagesHtml)
    expect(white![0]).not.toBe(navy![0])
    expect(navy![0]).not.toBe(blue![0])
    expect(white!.slice(1)).toEqual(navy!.slice(1))
    expect(white!.slice(1)).toEqual(blue!.slice(1))
  })

  it('without the brochure: the cover and the letter only, and no «on the following pages»', () => {
    const r = renderOffer(params(), sampleOfferData(), ctxFor('ru', { includeBrochure: false }))
    expect(r.pagesHtml).toHaveLength(1 + r.letter.count)
    expect(letterOf(r)).not.toContain('на следующих страницах')
    const withIt = renderOffer(params(), sampleOfferData(), ctxFor('ru'))
    expect(letterOf(withIt)).toContain('Подробные условия — на следующих страницах')
  })

  it('the letter pages carry no printed page number; the brochure pages carry their own', () => {
    const r = renderOffer(params(), sampleOfferData({ buyers: 40, long: true }), ctxFor('ru'))
    const letters = r.pagesHtml.slice(r.letter.index, r.letter.index + r.letter.count)
    for (const p of letters) expect(p).not.toContain('data-kp-page-no')
    const brochure = r.pagesHtml.slice(r.letter.index + r.letter.count)
    expect(brochure.slice(0, TCI_PAGE_COUNT - 2).map((p) => /data-kp-page-no[^>]*>(\d+)</.exec(p)?.[1])).toEqual(
      ['2', '3', '4', '5', '6', '7', '8'],
    )
  })
})

describe('the letter continues on further pages when the buyers do not fit', () => {
  for (const lang of LANGS)
    it(`${lang}: forty long buyers → several letter pages, every buyer printed once, «continued» titles`, () => {
      const data = sampleOfferData({ buyers: 40, long: true })
      const r = renderOffer(params({ note: 'x'.repeat(600) }), data, ctxFor(lang))
      expect(r.letter.count).toBeGreaterThanOrEqual(3)
      expect(r.pagesHtml).toHaveLength(1 + r.letter.count + TCI_PAGE_COUNT - 1)
      const letters = r.pagesHtml.slice(1, 1 + r.letter.count)
      const rows = letters.map((p) => (p.match(/<tr data-kp-buyer>/g) ?? []).length)
      expect(rows.reduce((a, b) => a + b, 0)).toBe(40)
      for (let i = 1; i <= 40; i++) {
        const name = `Example Buyer ${i} International`
        expect(letters.filter((p) => p.includes(name)).length, name).toBe(1)
      }
      const continued = { ru: 'продолжение', en: 'continued', uz: 'davomi' }[lang]
      for (const p of letters.slice(1)) expect(p).toContain(continued)
      // the column heads repeat on every page that holds rows
      for (const [i, p] of letters.entries()) if (rows[i]) expect(p).toContain('<thead>')
      // the footnote and the note come once, after the last row
      expect(letters.filter((p) => p.includes('data-kp-note')).length).toBe(1)
      expect(letters[letters.length - 1]).toContain('data-kp-note')
    })

  it('the closing lines never sit alone on a page: the last letter page still holds buyers', () => {
    for (const lang of LANGS) {
      const r = renderOffer(params(), sampleOfferData({ buyers: 14 }), ctxFor(lang))
      const letters = r.pagesHtml.slice(1, 1 + r.letter.count)
      const last = letters[letters.length - 1]!
      expect(last, lang).toMatch(/<tr data-kp-buyer>/)
    }
  })

  it('no buyers: the letter says so', () => {
    const r = renderOffer(params(), sampleOfferData({ buyers: 0 }), ctxFor('ru'))
    expect(letterOf(r)).toContain('Байеры в заявку не включены.')
    expect(letterOf(r)).not.toContain('<table')
  })
})

describe('escaping', () => {
  const evil = '<img src=x onerror=alert(1)>'

  it('a client name, a note, a buyer and the insurer’s particulars render as text', () => {
    const data = sampleOfferData({ clientName: evil })
    data.buyers[0]!.name = `"><script>alert(1)</script>`
    data.insurer!.phone = '<b onclick="x()">1</b>'
    data.contact.email = "'\"><svg onload=alert(1)>"
    const r = renderOffer(params({ note: `${evil}\n<script>alert(2)</script>` }), data, ctxFor('ru', { offerNumber: 'KP-<i>1</i>' }))
    const all = r.pagesHtml.join('')
    expect(all).not.toContain('<img src=x')
    expect(all).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(all).not.toMatch(/<script/i)
    expect(all).toContain('&quot;&gt;&lt;script&gt;')
    expect(all).not.toContain('<b onclick')
    expect(all).not.toMatch(/<svg onload/i)
    expect(all).not.toContain('<i>1</i>')
    // no tag carries an event handler (the escaped text may spell one out)
    expect(all).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i)
    const html = offerSrcdoc(r, 'ru')
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain('<title>KP-i1i — img src=x onerror=alert(1)</title>')
  })

  it('numbers come only from numbers: a string in an amount field prints the dash', () => {
    const data = sampleOfferData()
    ;(data.terms as unknown as Record<string, unknown>).nql_amount = '<b>1000</b>'
    ;(data.premium as unknown as Record<string, unknown>).rate_pct = '0.18'
    const letter = letterOf(renderOffer(params(), data, ctxFor('ru')))
    expect(letter).not.toContain('<b>1000</b>')
    expect(letter).not.toContain('&lt;b&gt;1000')
    expect(letter).not.toContain('0,18%')
  })
})

describe('amounts, percentages, days and dates in the document’s language', () => {
  const letter = (lang: DocLang) => letterOf(renderOffer(params(), sampleOfferData(), ctxFor(lang)))

  it('ru: thin groups and a decimal comma, Russian dates and plural days', () => {
    const ru = letter('ru')
    expect(ru).toContain(`2${NBSP}000${NBSP}000${NBSP}USD`)
    expect(ru).toContain(`21${NBSP}600,50${NBSP}USD`)
    expect(ru).toContain('0,18%')
    expect(ru).toContain('90%')
    expect(ru).toContain(`90${NBSP}дней`)
    expect(ru).toContain(`120${NBSP}дней`)
    expect(ru).toContain('22 октября 2026')
    expect(ru).toContain('21 ноября 2026')
    expect(ru).toContain('4 взноса по 4')
    expect(ru).toContain('Казахстан')
  })

  it('en: comma groups and a decimal point, English dates', () => {
    const en = letter('en')
    expect(en).toContain(`2,000,000${NBSP}USD`)
    expect(en).toContain(`21,600.50${NBSP}USD`)
    expect(en).toContain('0.18%')
    expect(en).toContain(`90${NBSP}days`)
    expect(en).toContain('22 October 2026')
    expect(en).toContain('21 November 2026')
    expect(en).toContain('4 instalments of 4,500')
    expect(en).toContain('Kazakhstan')
  })

  it('uz: the national notation, Uzbek dates and the glossary’s words', () => {
    const uz = letter('uz')
    expect(uz).toContain(`2${NBSP}000${NBSP}000${NBSP}USD`)
    expect(uz).toContain('0,18%')
    expect(uz).toContain(`90${NBSP}kun`)
    expect(uz).toContain('2026-yil 22-oktabr')
    expect(uz).toContain('2026-yil 21-noyabr')
    expect(uz).toContain('Qozog‘iston')
    expect(uz).toContain('Qoplanmaydigan zarar (NQL)')
    expect(uz).toContain('Diskretsion limit')
  })

  it('a country the reference table does not name prints as its code', () => {
    const r = renderOffer(params(), sampleOfferData(), ctxFor('ru', { countries: {} }))
    expect(letterOf(r)).toContain('>KZ<')
  })
})

describe('the frame document', () => {
  it('loads the fonts from the template’s own folder, carries the A4 print rules and a safe title', () => {
    const r = renderOffer(params(), sampleOfferData(), ctxFor('uz'))
    const html = offerSrcdoc(r, 'uz')
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<html lang="uz">')
    expect(html).toContain('<base href="/kp/tci/">')
    expect(html).toContain('<link rel="stylesheet" href="/kp/tci/fonts.css">')
    expect(html).toContain('@page { size: 210mm 297mm; margin: 0; }')
    expect(html).toContain('print-color-adjust: exact')
    expect(html).toContain('break-after: page')
    expect(html).toContain('<title>KP-2026-0001 — Example Trading</title>')
    expect(html.match(/<div class="page" data-kp-page="\d+">/g)).toHaveLength(r.pagesHtml.length)
  })
})
