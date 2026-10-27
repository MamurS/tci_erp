/**
 * A list row opens its own object; the links in it open theirs (owner,
 * 2026-10-27; LinkRow, linkRow.ts). On «Active limits»: a click on the
 * amount opens the limit, the buyer's name the company, the policy number
 * the policy; Enter on the focused row opens the limit. Demo book, SEALED
 * network (e2e/support/network.ts).
 */

import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'

import { loadFixture, replay } from '../layout/fixtures'
import { sealNetwork } from '../support/network'
import { stubBackend } from '../support/stub'

test.use({
  viewport: { width: 1440, height: 900 },
  launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined },
})

const fixture = loadFixture('credit')
const variant = fixture?.variants.find((v) => v.path.includes('view=inforce'))

async function open(context: BrowserContext): Promise<Page> {
  await sealNetwork(context)
  await stubBackend(context, { lang: 'en', user: fixture!.user, respond: replay(fixture!), sidebar: 'open' })
  const page = await context.newPage()
  await page.goto(variant!.path)
  await expect(page.locator('tr[data-link-row]').first()).toBeVisible()
  return page
}

test.describe('list rows', () => {
  test.skip(!variant, 'no recorded «Active limits» in the demo book')

  test('the row opens the limit, its links open their own objects', async ({ browser }) => {
    const context = await browser.newContext()
    try {
      const page = await open(context)
      const row = page.locator('tr[data-link-row]').first()
      const limit = await row.getAttribute('data-link-row')
      expect(limit).toMatch(/^\/limits\//)

      // Anywhere on the row that is not a link: the limit.
      await row.locator('td.num').first().click()
      await expect(page).toHaveURL(new RegExp(`${limit}$`))

      // The buyer's name: the company.
      await page.goBack()
      await page.locator('tr[data-link-row]').first().locator('a[href^="/entities/"]').first().click()
      await expect(page).toHaveURL(/\/entities\/[0-9a-f-]+$/)

      // The policy number: the policy.
      await page.goBack()
      await page.locator('tr[data-link-row]').first().locator('a[href^="/policies/"]').click()
      await expect(page).toHaveURL(/\/policies\/[0-9a-f-]+$/)

      // The keyboard: the row is focusable and Enter opens it.
      await page.goBack()
      await page.locator('tr[data-link-row]').first().focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(new RegExp(`${limit}$`))
    } finally {
      await context.close()
    }
  })

  test('a text selection does not open the row', async ({ browser }) => {
    const context = await browser.newContext()
    try {
      const page = await open(context)
      const before = page.url()
      const cell = page.locator('tr[data-link-row]').first().locator('td.num').first()
      const box = (await cell.boundingBox())!
      await page.mouse.move(box.x + 4, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width - 4, box.y + box.height / 2, { steps: 5 })
      await page.mouse.up()
      await page.waitForTimeout(200)
      expect(page.url()).toBe(before)
    } finally {
      await context.close()
    }
  })
})
