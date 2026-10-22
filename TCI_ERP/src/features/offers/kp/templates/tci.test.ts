/**
 * The TCI brochure and the offer letter are APPROVED («как в ДМС»): a change
 * to their words or their layout must be deliberate. This test pins the
 * SHA-256 of
 *
 *   1. the template's words — TCI_TEXTS and LETTER_TEXTS (its functions
 *      called on fixed samples), with TCI_BROCHURE_VERSION, and
 *   2. the brochure pages themselves, every language × cover, rendered for a
 *      fixed sample (nothing in them depends on Intl, so the hash is the same
 *      on every machine).
 *
 * If the brochure was changed ON PURPOSE (and the owner approved the words),
 * bump TCI_BROCHURE_VERSION if the words changed, replace the hashes below in
 * the same commit, and say why in the commit message.
 */

import { describe, expect, it } from 'vitest'

import { OFFER_COVERS } from '../params'
import { sampleOfferData } from '../sampleData'
import { OFFER_TEMPLATES } from './index'
import { LETTER_TEXTS } from './letterTexts'
import { TCI_PAGE_COUNT, tciBrochurePages } from './tci'
import { TCI_BROCHURE_VERSION, TCI_TEXTS } from './tciTexts'

const PINNED_TEXTS_SHA256 = '750a0629db15543a3c382115fb40a6ec00c0647261b66850d66a47be20969865'
const PINNED_PAGES_SHA256 = '6b0d0398d7321cf93533d8b9f5fec3ab79db2db6c946363671f43a762de10efe'

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Functions are part of the words: serialise them by what they say. */
function serialise(node: unknown): unknown {
  if (typeof node === 'function') {
    const f = node as (...a: unknown[]) => string
    return [f('2.5', '1 000 USD'), f(1, '1 000 USD'), f(2, '1 000 USD'), f(5, '1 000 USD'), f(12, '1 000 USD')]
  }
  if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, serialise(v)]))
  return node
}

const LANGS = ['ru', 'en', 'uz'] as const
const pagesFor = (lang: (typeof LANGS)[number], cover: (typeof OFFER_COVERS)[number]) =>
  tciBrochurePages({ lang, cover, data: sampleOfferData(), date: '2026-10-22' })

describe('the approved TCI template', () => {
  it('its words match the pinned SHA-256', async () => {
    const words = JSON.stringify({ version: TCI_BROCHURE_VERSION, brochure: TCI_TEXTS, letter: serialise(LETTER_TEXTS) })
    expect(await sha256(words)).toBe(PINNED_TEXTS_SHA256)
  })

  it('its pages match the pinned SHA-256', async () => {
    const all = LANGS.flatMap((lang) => OFFER_COVERS.map((cover) => `${lang}-${cover}\n${pagesFor(lang, cover).join('\n')}`))
    expect(await sha256(all.join('\n\n'))).toBe(PINNED_PAGES_SHA256)
  })

  it('has nine pages in every language and cover, with no script, handler or outside resource', () => {
    for (const lang of LANGS)
      for (const cover of OFFER_COVERS) {
        const pages = pagesFor(lang, cover)
        expect(pages).toHaveLength(TCI_PAGE_COUNT)
        for (const p of pages) {
          expect(p).not.toMatch(/<script/i)
          expect(p).not.toMatch(/<[a-z][^>]*\son[a-z]+\s*=/i)
          expect(p).not.toMatch(/<img|url\((?!#kp-)|https?:|\/\/[a-z]/i)
          expect(p).not.toMatch(/<a\s/i)
          // A4 at 96 dpi, every page
          expect(p.startsWith('<div style="width: 794px; height: 1123px;')).toBe(true)
          expect(p).toContain('width: 794px; height: 1123px;')
        }
      }
  })

  it('never sets text in orange — orange is a fill, a rule or a shape', () => {
    for (const lang of LANGS)
      for (const cover of OFFER_COVERS) for (const p of pagesFor(lang, cover)) expect(p).not.toMatch(/(^|[;"\s])color: #F7941E/i)
  })

  it('the registry, the module and the parameters agree on the version', () => {
    expect(TCI_BROCHURE_VERSION).toBe('TCI 10/26')
    expect(OFFER_TEMPLATES.tci.version).toBe(TCI_BROCHURE_VERSION)
    expect(OFFER_TEMPLATES.tci.languages).toEqual(['ru', 'en', 'uz'])
    expect(OFFER_TEMPLATES.tci.covers).toEqual(['white', 'navy', 'blue'])
    expect(OFFER_TEMPLATES.tci.pageCount).toBe(TCI_PAGE_COUNT)
    expect(OFFER_TEMPLATES.tci.assetBase).toBe('/kp/tci/')
  })

  it('prints the insurer’s particulars from the data, and none when the data has none', () => {
    const data = sampleOfferData()
    const withInsurer = tciBrochurePages({ lang: 'ru', cover: 'white', data, date: '2026-10-22' }).join('')
    expect(withInsurer).toContain('JSC Example Insurance')
    expect(withInsurer).toContain('+998 00 000 00 00')
    expect(withInsurer).toContain('tci@example.invalid')
    expect(withInsurer).toContain('example.invalid')
    const bare = tciBrochurePages({
      lang: 'ru',
      cover: 'white',
      data: { ...data, insurer: null, contact: { name: null, phone: null, email: null } },
      date: '2026-10-22',
    }).join('')
    expect(bare).not.toContain('Example Insurance')
    expect(bare).not.toContain('example.invalid')
    expect(bare).not.toContain('Звоните')
  })
})
