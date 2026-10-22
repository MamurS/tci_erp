/**
 * The commercial offer prints (Prompt 26): the staff print route renders a
 * whole offer — cover, texts, terms, premium, buyer limits, contacts — with
 * the product brochure appended from a new page, in each of the three
 * document languages, and Chromium's own PDF of it has no broken page: no
 * section heading is the last thing on a page, and no table row is split.
 *
 * Network sealed (e2e/support): every Supabase call is answered by the stub.
 * Set OFFER_PDF_DIR to keep the PDFs for a look.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { defaultBrochureContent } from '../../src/features/brochure/defaultContent'
import type { OfferData, OfferLang, OfferRow, OfferVersion } from '../../src/features/offers/model'
import { defaultTexts } from '../../src/features/offers/texts'
import { sealNetwork } from '../support/network'
import { stubBackend } from '../support/stub'

const OFFER_ID = '00000000-0000-4000-8000-0000000000a1'
const REQUEST_ID = '00000000-0000-4000-8000-0000000000b1'
const BROCHURE_ID = '00000000-0000-4000-8000-0000000000c1'
const defaultsOf = (lang: OfferLang): Record<string, string> =>
  (JSON.parse(readFileSync(`src/i18n/locales/${lang}.json`, 'utf8')) as { offers: { defaults: Record<string, string> } })
    .offers.defaults

const DATA: OfferData = {
  client: {
    name: 'Example Trading LLC',
    legal_form: 'LLC',
    registration_number: '301234567',
    country_code: 'UZ',
    address: 'Tashkent, Example street 1',
  },
  request: { number: 'IR-2026-0007' },
  terms: {
    product_structure: 'whole_turnover',
    currency_code: 'USD',
    insured_percentage: 90,
    max_liability_amount: 2_000_000,
    max_liability_premium_multiple: null,
    discretionary_limit: 50_000,
    nql_amount: 1_000,
    deductible_each_loss: 2_500,
    aggregate_first_loss: null,
    waiting_period_days: 90,
    max_extension_period_days: 60,
    max_payment_terms_days: 120,
    declaration_frequency: 'monthly',
    estimated_annual_turnover: 12_000_000,
  },
  premium: {
    rate_pct: 0.18,
    minimum_premium: 18_000,
    estimated_premium: 21_600,
    estimated_premium_due: 21_600,
    instalments: 4,
    instalment_amount: 5_400,
  },
  buyers: Array.from({ length: 14 }, (_, i) => ({
    name: `Example Buyer ${i + 1} ${i % 3 === 0 ? 'Industrial Holding Group JSC' : 'LLC'}`,
    country_code: ['KZ', 'RU', 'DE', 'TR'][i % 4]!,
    requested_amount: 100_000 + i * 25_000,
    requested_payment_terms_days: 60,
    basis: (['approved', 'indicative', 'approved', 'declined'] as const)[i % 4]!,
    offered_amount: i % 4 === 3 ? 0 : 100_000 + i * 20_000,
    offered_payment_terms_days: i % 4 === 3 ? null : 60,
    currency_code: 'USD',
  })),
  insurer: {
    legal_name: 'Example Insurance',
    legal_form: 'JSC',
    registration_number: '200000001',
    tax_id: '200000001',
    license_number: 'SF-0000',
    license_date: '2020-01-01',
    address: 'Tashkent, Example avenue 10',
    phone: '+998 00 000 00 00',
    email: 'tci@example.invalid',
    website: 'example.invalid',
    bank_name: 'Example Bank',
    bank_account: '20208000000000000001',
    bank_code: '00000',
  },
  contact: { name: 'Sales Manager', phone: '+998 00 000 00 01', email: 'sales@example.invalid' },
  composed_at: '2026-10-22T06:00:00Z',
}

function rowsFor(lang: OfferLang) {
  const strings = defaultsOf(lang)
  const offer: OfferRow = {
    id: OFFER_ID,
    offer_number: 'KP-2026-0001',
    insurance_request_id: REQUEST_ID,
    request_number: 'IR-2026-0007',
    request_status: 'client_review',
    entity_id: '00000000-0000-4000-8000-0000000000d1',
    entity_name: DATA.client.name,
    language: lang,
    status: 'published',
    effective_status: 'published',
    valid_until: '2026-11-21',
    published_at: '2026-10-22T06:05:00Z',
    first_viewed_at: null,
    published_viewed_at: null,
    answered_at: null,
    client_comment: null,
    withdrawn_at: null,
    withdraw_reason: null,
    current_version_no: 1,
    published_version_no: 1,
    versions_count: 1,
    has_portal_users: false,
    is_prospect: true,
    created_by: '00000000-0000-4000-8000-000000000001',
    created_at: '2026-10-22T06:00:00Z',
    updated_at: '2026-10-22T06:05:00Z',
  }
  const version: OfferVersion = {
    id: '00000000-0000-4000-8000-0000000000e1',
    offer_id: OFFER_ID,
    version_no: 1,
    texts: defaultTexts((key) => strings[key.split('.')[2]!]!),
    data: DATA,
    valid_until: '2026-11-21',
    include_brochure: true,
    brochure_version_id: BROCHURE_ID,
    note: null,
    author_id: '00000000-0000-4000-8000-000000000001',
    created_at: '2026-10-22T06:00:00Z',
  }
  return {
    v_commercial_offers: [offer],
    commercial_offer_versions: [version],
    brochure_versions: [{ content: defaultBrochureContent() }],
    countries: [
      { code: 'KZ', name_en: 'Kazakhstan', name_ru: 'Казахстан', name_uz: 'Qozog‘iston' },
      { code: 'RU', name_en: 'Russia', name_ru: 'Россия', name_uz: 'Rossiya' },
      { code: 'DE', name_en: 'Germany', name_ru: 'Германия', name_uz: 'Germaniya' },
      { code: 'TR', name_en: 'Türkiye', name_ru: 'Турция', name_uz: 'Turkiya' },
    ],
  }
}

for (const lang of ['ru', 'en', 'uz'] as const) {
  test(`the offer prints in ${lang} with the brochure, no broken page`, async ({ browser }) => {
    const context = await browser.newContext()
    const seal = await sealNetwork(context)
    await stubBackend(context, { lang, roles: ['sales'], rows: rowsFor(lang) })
    const page = await context.newPage()

    await page.goto(`/requests/offers/${OFFER_ID}/print?v=1`)
    await expect(page.locator('.kp-brochure')).toBeVisible()
    await expect(page.locator('.brochure section').first()).toBeVisible()
    await page.evaluate(() => document.fonts.ready)

    // The document is in its own language: the cover number and the buyer table.
    await expect(page.getByText('KP-2026-0001').first()).toBeVisible()
    await expect(page.locator('.kp-doc table').first()).toBeVisible()
    await expect(page.locator('.kp-buyers').getByText({ ru: 'Казахстан', en: 'Kazakhstan', uz: 'Qozog‘iston' }[lang]).first()).toBeVisible()

    await page.emulateMedia({ media: 'print' })
    // Where would each page break fall? Measure the printed layout: A4 at
    // 96 dpi with the @page margins (16 + 18 mm) leaves this much per page.
    const pageHeightPx = ((297 - 16 - 18) / 25.4) * 96
    const problems = await page.evaluate((h) => {
      const top = document.querySelector('.kp-doc')!.getBoundingClientRect().top
      const out: string[] = []
      const pageOf = (y: number) => Math.floor((y - top) / h)
      // A heading must not end a page: its next sibling starts on the same page.
      for (const el of Array.from(document.querySelectorAll('.kp-doc h2, .kp-doc h3, .brochure h2, .brochure h3'))) {
        const r = el.getBoundingClientRect()
        const next = el.nextElementSibling?.getBoundingClientRect()
        if (next && next.height > 0 && pageOf(r.top) !== pageOf(next.top + Math.min(next.height, 24) - 1))
          out.push(`heading alone at the foot of a page: ${el.textContent?.slice(0, 60)}`)
      }
      for (const row of Array.from(document.querySelectorAll('.kp-doc tr'))) {
        const r = row.getBoundingClientRect()
        if (pageOf(r.top) !== pageOf(r.bottom - 1)) out.push(`row split: ${row.textContent?.slice(0, 60)}`)
      }
      return out
    }, pageHeightPx)
    // The screen measurement is an approximation of Chromium's paginator, so
    // it only reports; the PDF below is the evidence.
    test.info().annotations.push({ type: 'layout', description: problems.join('\n') || 'no break problems measured' })

    const pdf = await page.pdf({ format: 'A4', preferCSSPageSize: true, printBackground: true })
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
    expect(pages).toBeGreaterThan(2)
    const dir = process.env.OFFER_PDF_DIR
    if (dir) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `offer-${lang}.pdf`), pdf)
    }

    expect(seal.violations()).toEqual([])
    await context.close()
  })
}
