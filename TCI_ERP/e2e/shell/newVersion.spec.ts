/**
 * A tab left open across a deploy learns it runs old code
 * (src/lib/appVersion.ts). `/version.json` is answered here: with a build id
 * other than the tab's for "a newer build is deployed", and not at all (the
 * dev server answers with its index page) for "cannot tell". Network sealed.
 */

import { expect, test } from '@playwright/test'
import type { BrowserContext } from '@playwright/test'

import { loadFixture, replay } from '../layout/fixtures'
import { sealNetwork } from '../support/network'
import { stubBackend } from '../support/stub'

test.use({ viewport: { width: 1440, height: 900 } })

async function serveNewerBuild(context: BrowserContext, delayMs = 0) {
  await context.route('**/version.json*', async (route) => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ build: 'a-newer-build' }) })
  })
}

test('a staff tab running an old build offers a reload, in a corner that moves nothing', async ({ browser }) => {
  const fixture = loadFixture('credit')
  test.skip(!fixture, 'no fixtures recorded')
  const context = await browser.newContext()
  const seal = await sealNetwork(context)
  await stubBackend(context, { lang: 'ru', user: fixture!.user, respond: replay(fixture!), sidebar: 'open' })
  await serveNewerBuild(context)
  const page = await context.newPage()
  try {
    await page.goto('/agenda')
    const notice = page.getByTestId('new-version-notice')
    await expect(notice).toBeVisible({ timeout: 15_000 })
    await expect(notice).toContainText('Доступна новая версия TCI ERP')
    await expect(notice.getByRole('button', { name: 'Обновить страницу' })).toBeVisible()
    expect(await notice.evaluate((el) => getComputedStyle(el).position)).toBe('fixed')

    await notice.getByRole('button', { name: 'Позже' }).click()
    await expect(notice).toBeHidden()
    expect(seal.violations()).toEqual([])
  } finally {
    await context.close()
  }
})

test('when the server cannot say which build it serves, nothing is shown', async ({ browser }) => {
  const fixture = loadFixture('credit')
  test.skip(!fixture, 'no fixtures recorded')
  const context = await browser.newContext()
  const seal = await sealNetwork(context)
  await stubBackend(context, { lang: 'ru', user: fixture!.user, respond: replay(fixture!), sidebar: 'open' })
  const page = await context.newPage()
  try {
    const asked = page.waitForResponse((r) => r.url().includes('/version.json'))
    await page.goto('/agenda')
    await asked
    await page.waitForTimeout(500)
    await expect(page.getByTestId('new-version-notice')).toHaveCount(0)
    expect(seal.violations()).toEqual([])
  } finally {
    await context.close()
  }
})

test('a half-typed sign-in form is not reloaded: the page asks instead', async ({ page, context }) => {
  const seal = await sealNetwork(context)
  await stubBackend(context, { lang: 'en', signedIn: false })
  // The answer "a newer build is deployed" arrives while the person is
  // already typing.
  await serveNewerBuild(context, 2500)
  let loads = 0
  page.on('load', () => {
    loads += 1
  })
  await page.goto('/login')
  await page.getByLabel('Email').fill('someone@demo.invalid')
  await expect(page.getByTestId('new-version-notice')).toBeVisible({ timeout: 15_000 })
  expect(loads).toBe(1)
  await expect(page.getByLabel('Email')).toHaveValue('someone@demo.invalid')
  expect(seal.violations()).toEqual([])
})

test('the sign-in page reloads itself once into the new build while nothing is typed', async ({ page, context }) => {
  const seal = await sealNetwork(context)
  await stubBackend(context, { lang: 'en', signedIn: false })
  await serveNewerBuild(context)
  let loads = 0
  page.on('load', () => {
    loads += 1
  })

  await page.goto('/login')
  // In this test the "new build" never arrives, so after its one reload the
  // page stops and offers the reload instead of looping.
  await expect.poll(() => loads, { timeout: 15_000 }).toBe(2)
  await expect(page.getByTestId('new-version-notice')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1500)
  expect(loads).toBe(2)
  expect(seal.violations()).toEqual([])
})
