/**
 * The commercial offer prints (Prompt 27): the staff print route shows the
 * whole document — cover, the offer letter, the brochure — in its sandboxed
 * frame, in each of the three document languages, and Chromium's own PDF of
 * that document has exactly one sheet per page of the renderer: no page
 * spills onto a second sheet and none is lost. The PDF is made from the
 * frame's own document (its `@page` rules), as «Save as PDF» in the frame's
 * print dialog does.
 *
 * Network sealed (e2e/support): every Supabase call is answered by the stub.
 * Set OFFER_PDF_DIR to keep the PDFs for a look.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { sealNetwork } from '../support/network'
import { stubBackend } from '../support/stub'
import { OFFER_ID, offerRows } from './fixtures'

for (const lang of ['ru', 'en', 'uz'] as const) {
  test(`the offer prints in ${lang} with the brochure: one PDF sheet per page`, async ({ browser }) => {
    const context = await browser.newContext()
    const seal = await sealNetwork(context)
    const f = offerRows({ lang, status: 'published', requestStatus: 'client_review', sample: { buyers: 14 } })
    await stubBackend(context, { lang, roles: ['sales'], rows: f.rows })
    const page = await context.newPage()

    await page.goto(`/requests/offers/${OFFER_ID}/print?v=1`)
    const frameEl = page.locator('iframe[data-offer-frame]')
    await expect(frameEl).toBeAttached()
    const doc = page.frameLocator('iframe[data-offer-frame]')
    const total = f.expected.pagesHtml.length
    await expect(doc.locator('.page')).toHaveCount(total)
    await expect(doc.getByText('KP-2026-0001').first()).toBeAttached()
    await expect(doc.locator('tr[data-kp-buyer]')).toHaveCount(14)
    const country = { ru: 'Казахстан', en: 'Kazakhstan', uz: 'Qozog‘iston' }[lang]
    await expect(doc.locator('tr[data-kp-buyer]').getByText(country).first()).toBeAttached()

    // Print the frame's own document, as the frame's print dialog would:
    // the same srcdoc, on the same origin (so the fonts load).
    const srcdoc = await frameEl.getAttribute('srcdoc')
    expect(srcdoc).toBeTruthy()
    await page.setContent(srcdoc!, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => [...document.fonts].some((f) => f.family.includes('PT Sans Narrow') && f.status === 'loaded'))).toBe(true)
    await page.emulateMedia({ media: 'print' })
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
    const sheets = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
    test.info().annotations.push({ type: 'pdf', description: `${lang}: ${sheets} pages (${total} rendered)` })
    expect(sheets).toBe(total)
    const dir = process.env.OFFER_PDF_DIR
    if (dir) {
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `offer-${lang}.pdf`), pdf)
    }

    expect(seal.violations()).toEqual([])
    await context.close()
  })
}
