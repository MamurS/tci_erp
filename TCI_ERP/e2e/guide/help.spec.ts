/**
 * The Help centre in the browser (stubbed backend, network sealed): the «?» in
 * the top bar and F1 open the topic for the page, written for the acting role
 * first; the guide's search finds Uzbek words whatever the apostrophe; the
 * portal's Help centre shows the policyholder's topics only.
 */
import { expect, test } from '@playwright/test'

import { sealNetwork } from '../support/network'
import { stubBackend } from '../support/stub'

test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined } })

test('«?» and F1 open the topic for the page, for the acting role', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const seal = await sealNetwork(context)
  await stubBackend(context, { lang: 'en', roles: ['credit_underwriter'] })
  const page = await context.newPage()
  await page.goto('/limits/00000000-0000-4000-8000-0000000000aa')
  const button = page.getByTestId('help-button')
  await expect(button).toHaveAttribute('data-tour', 'help')
  await expect(button).toHaveAttribute('href', /^\/help\/credit-decide\?from=/)
  await page.keyboard.press('F1')
  await expect(page).toHaveURL(/\/help\/credit-decide\?from=/)
  await expect(page.locator('h1')).toContainText('Deciding a limit request')
  expect(seal.violations()).toEqual([])
  await context.close()
})

test('the guide search reads Uzbek apostrophes alike', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await sealNetwork(context)
  await stubBackend(context, { lang: 'uz', roles: ['sales'] })
  const page = await context.newPage()
  await page.goto("/help?q=so'rov")
  await expect(page.getByTestId('help-results').locator('li').first()).toBeVisible()
  await page.goto('/help?q=sorov')
  await expect(page.getByTestId('help-results').locator('li').first()).toBeVisible()
  await context.close()
})

test('the portal Help centre shows the policyholder’s topics only', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const seal = await sealNetwork(context)
  await stubBackend(context, { lang: 'ru', roles: ['client'] })
  const page = await context.newPage()
  await page.goto('/portal/help')
  await expect(page.locator('[data-help] aside nav')).toContainText('Портал страхователя')
  await expect(page.locator('[data-help] aside nav')).not.toContainText('Кредитный андеррайтинг')
  // a staff topic is not there for a client
  await page.goto('/portal/help/credit-decide')
  await expect(page.locator('[data-help]')).toContainText('Такой статьи в справке нет')
  expect(seal.violations()).toEqual([])
  await context.close()
})
