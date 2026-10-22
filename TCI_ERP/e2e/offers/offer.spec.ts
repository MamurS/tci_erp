/**
 * The commercial offer screen and its document («как в ДМС», Prompt 27):
 *
 *  - the staff screen shows the live preview of every page, with the right
 *    page count and «Страница N из M»;
 *  - changing the cover re-renders the document; an offer in another language
 *    than the interface prints in its own;
 *  - «Скачать PDF» calls the frame's print() (stubbed here);
 *  - the portal shows the same pages;
 *  - a client name that is an XSS probe opens without any dialog;
 *  - no page of the document overflows its A4 box, in ru / en / uz, on
 *    extreme data (forty long buyers, a full note).
 *
 * Network sealed (e2e/support): every Supabase call is answered by the stub.
 */

import { expect, test, type Page } from '@playwright/test'

import { sealNetwork } from '../support/network'
import { stubBackend } from '../support/stub'
import { OFFER_ID, offerRows } from './fixtures'

const frame = (page: Page) => page.frameLocator('iframe[data-offer-frame]').first()

// The dev server compiles a route's chunk on its first visit: give the first
// look at a screen more time than an assertion usually needs.
test.setTimeout(60_000)

/** Inside the document: every page's content area fits its A4 box. */
async function overflowingPages(page: Page): Promise<string[]> {
  const handle = await page.locator('iframe[data-offer-frame]').first().elementHandle()
  const doc = await handle!.contentFrame()
  await doc!.evaluate(() => document.fonts.ready)
  return doc!.evaluate(() =>
    [...document.querySelectorAll('.page')].flatMap((p, i) =>
      [...p.querySelectorAll<HTMLElement>('[data-kp-body]')]
        .filter((b) => b.scrollHeight > b.clientHeight + 1)
        .map((b) => `page ${i + 1}: ${b.scrollHeight - b.clientHeight}px over`),
    ),
  )
}

test('the offer screen: live preview of every page, the counter, the cover re-renders, PDF prints the frame', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const seal = await sealNetwork(context)
  const f = offerRows({ lang: 'ru' })
  await stubBackend(context, { lang: 'ru', roles: ['sales'], rows: f.rows })
  const page = await context.newPage()
  await page.goto(`/requests/offers/${OFFER_ID}/edit`)

  const total = f.expected.pagesHtml.length
  await expect(page.getByTestId('offer-page-counter')).toHaveText(`Страница 1 из ${total}`)
  await expect(frame(page).locator('.page')).toHaveCount(total)
  await expect(frame(page).locator('[data-kp-cover="white"]')).toBeVisible()
  await expect(frame(page).getByText('Коммерческое предложение', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(`${total} страниц`)).toBeVisible()
  expect(await overflowingPages(page)).toEqual([])

  // The two columns are one row: the preview is exactly as tall as the form
  // beside it (and the form is not stretched to the document's length).
  const form = await page.locator('main .grid > div').first().boundingBox()
  const preview = await page.locator('section[aria-label="Предпросмотр предложения"]').boundingBox()
  expect(Math.abs(form!.height - preview!.height)).toBeLessThanOrEqual(1)
  expect(Math.abs(form!.y - preview!.y)).toBeLessThanOrEqual(1)
  expect(form!.height).toBeLessThan(1500)

  // The cover is a parameter: choosing another re-renders the document.
  await page.getByRole('radio', { name: 'Синяя', exact: true }).click()
  await expect(frame(page).locator('[data-kp-cover="blue"]')).toBeAttached()
  await expect(frame(page).locator('[data-kp-cover="white"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toBeEnabled()

  // The note prints in the letter, as plain text.
  await page.getByLabel('Комментарий для клиента').fill('Срок можно продлить.\n<b>не жирный</b>')
  await expect(frame(page).locator('[data-kp-note]')).toContainText('<b>не жирный</b>')

  // Scrolling the preview moves the counter.
  await page.locator('section[aria-label="Предпросмотр предложения"] > div.overflow-y-auto').evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect(page.getByTestId('offer-page-counter')).toHaveText(`Страница ${total} из ${total}`)

  // «Скачать PDF» prints the preview's own frame.
  await page.locator('iframe[data-offer-frame]').evaluate((el: HTMLIFrameElement) => {
    const w = el.contentWindow as Window & { __printed?: number }
    w.print = () => {
      w.__printed = (w.__printed ?? 0) + 1
    }
  })
  await page.getByRole('button', { name: 'Скачать PDF' }).click()
  await expect
    .poll(() => page.locator('iframe[data-offer-frame]').evaluate((el: HTMLIFrameElement) => (el.contentWindow as Window & { __printed?: number }).__printed ?? 0))
    .toBe(1)
  await expect(page.getByText('В окне печати выберите «Сохранить как PDF»')).toBeVisible()

  expect(seal.violations()).toEqual([])
  await context.close()
})

test('an offer in Uzbek opens in Uzbek under a Russian interface; the language is fixed', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const seal = await sealNetwork(context)
  const f = offerRows({ lang: 'uz', params: { cover: 'navy' } })
  await stubBackend(context, { lang: 'ru', roles: ['sales'], rows: f.rows })
  const page = await context.newPage()
  await page.goto(`/requests/offers/${OFFER_ID}/edit`)
  await expect(frame(page).locator('[data-kp-cover="navy"]')).toBeAttached()
  await expect(frame(page).getByText('Tijorat taklifi', { exact: true }).first()).toBeAttached()
  await expect(frame(page).getByText('Qoplanmaydigan zarar (NQL)').first()).toBeAttached()
  await expect(page.getByRole('button', { name: 'Русский' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Oʻzbekcha' })).toHaveAttribute('aria-pressed', 'true')
  expect(seal.violations()).toEqual([])
  await context.close()
})

test('a published offer opens read-only until «Новая версия»', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const seal = await sealNetwork(context)
  const f = offerRows({ lang: 'ru', status: 'published', requestStatus: 'client_review' })
  await stubBackend(context, { lang: 'ru', roles: ['sales'], rows: f.rows })
  const page = await context.newPage()
  await page.goto(`/requests/offers/${OFFER_ID}/edit`)
  await expect(frame(page).locator('.page')).toHaveCount(f.expected.pagesHtml.length)
  await expect(page.getByRole('radio', { name: 'Синяя', exact: true })).toBeDisabled()
  await expect(page.getByLabel('Комментарий для клиента')).toBeDisabled()
  await page.getByRole('button', { name: 'Новая версия' }).click()
  await expect(page.getByRole('radio', { name: 'Синяя', exact: true })).toBeEnabled()
  expect(seal.violations()).toEqual([])
  await context.close()
})

test('the portal shows the same pages, with Accept and Request changes', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const seal = await sealNetwork(context)
  const f = offerRows({ lang: 'ru', status: 'published', requestStatus: 'client_review' })
  await stubBackend(context, { lang: 'ru', roles: ['client'], rows: f.rows })
  const page = await context.newPage()
  await page.goto(`/portal/offers/${OFFER_ID}`)
  const total = f.expected.pagesHtml.length
  await expect(frame(page).locator('.page')).toHaveCount(total, { timeout: 15_000 })
  await expect(page.getByTestId('offer-page-counter')).toHaveText(`Страница 1 из ${total}`)
  await expect(frame(page).locator('[data-kp-letter="1"]')).toContainText('Example Trading')
  await expect(page.getByRole('button', { name: 'Принять предложение' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Запросить изменения' })).toBeEnabled()
  expect(seal.violations()).toEqual([])
  await context.close()
})

test('an XSS probe as the client name and the note opens without any dialog and prints as text', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const seal = await sealNetwork(context)
  const probe = '<img src=x onerror=alert(1)>'
  const f = offerRows({ lang: 'en', sample: { clientName: probe }, params: { note: `<script>alert(2)</script>${probe}` } })
  await stubBackend(context, { lang: 'en', roles: ['sales'], rows: f.rows })
  const page = await context.newPage()
  const dialogs: string[] = []
  page.on('dialog', (d) => {
    dialogs.push(d.message())
    void d.dismiss()
  })
  await page.goto(`/requests/offers/${OFFER_ID}/edit`)
  await expect(frame(page).locator('[data-kp-letter="1"] [data-kp-client]')).toHaveText(`LLC ${probe}`)
  await expect(frame(page).locator('[data-kp-note]')).toContainText('<script>alert(2)</script>')
  await expect(frame(page).locator('img')).toHaveCount(0)
  await expect(frame(page).locator('script')).toHaveCount(0)
  await page.waitForTimeout(300)
  expect(dialogs).toEqual([])
  expect(seal.violations()).toEqual([])
  await context.close()
})

for (const lang of ['ru', 'en', 'uz'] as const) {
  test(`${lang}: no page of the document overflows its A4 box on extreme data`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
    const seal = await sealNetwork(context)
    const f = offerRows({ lang, sample: { buyers: 40, long: true, shout: lang !== 'en' }, params: { note: 'Ш'.repeat(590) } })
    await stubBackend(context, { lang, roles: ['sales'], rows: f.rows })
    const page = await context.newPage()
    await page.goto(`/requests/offers/${OFFER_ID}/edit`)
    await expect(frame(page).locator('.page')).toHaveCount(f.expected.pagesHtml.length)
    expect(f.expected.letter.count).toBeGreaterThanOrEqual(3)
    expect(await overflowingPages(page)).toEqual([])
    expect(seal.violations()).toEqual([])
    await context.close()
  })
}
