/**
 * The sidebar toggle never moves, and the panel appears and disappears
 * instantly (Prompt 24): pinned, collapsed and peeking, in en/ru/uz, at 1280
 * and 1920 wide.
 */

import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { LANGS, stubBackend } from '../support/stub'

const WIDTHS = [1280, 1920] as const
const PAGE = '/entities'

const toggle = (page: Page) => page.locator('button[aria-controls="app-sidebar"]')
const panel = (page: Page) => page.locator('aside#app-sidebar')

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  expect(b, 'element is on screen').not.toBeNull()
  return b!
}

/** Nothing on the panel or its container is transitioned or animated. */
async function expectNoMotion(page: Page) {
  const styles = await panel(page).evaluate((aside) =>
    [aside, aside.parentElement!].map((el) => {
      const s = getComputedStyle(el)
      return { transition: s.transitionDuration, animation: s.animationName }
    }),
  )
  for (const s of styles) {
    expect(s.transition.split(',').every((d) => parseFloat(d) === 0)).toBe(true)
    expect(s.animation).toBe('none')
  }
}

/** Come from the page onto the toggle and rest there past the hover intent
 * (100 ms): the peek opens on ENTERING the toggle, so a pointer already on
 * it has to leave first. */
async function peek(page: Page) {
  await page.mouse.move(1000, 600)
  await toggle(page).hover()
  await expect(panel(page)).toBeVisible()
}

for (const lang of LANGS) {
  for (const width of WIDTHS) {
    test.describe(`${lang} @ ${width}`, () => {
      test.use({ viewport: { width, height: 900 } })

      test('the toggle keeps one position and size in every state', async ({ page, context }) => {
        await stubBackend(context, { lang, sidebar: 'open' })
        await page.goto(PAGE)
        await expect(panel(page)).toBeVisible()

        // Pinned: [toggle] [TCI ERP] on the navy row.
        const pinned = await box(toggle(page))
        const logo = await box(panel(page).getByLabel('TCI ERP'))
        expect(logo.x).toBeGreaterThanOrEqual(pinned.x + pinned.width)
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true')
        await expectNoMotion(page)

        // Collapsed: only the toggle is left, at the same spot.
        await toggle(page).click()
        await page.mouse.move(width - 10, 890)
        await expect(panel(page)).toHaveCount(0)
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
        const collapsed = await box(toggle(page))
        expect(collapsed).toEqual(pinned)

        // Peek: the full panel over the content, the toggle unmoved, the
        // content unmoved.
        const mainBefore = await box(page.locator('main'))
        await peek(page)
        await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true')
        expect(await box(toggle(page))).toEqual(pinned)
        const peekLogo = await box(panel(page).getByLabel('TCI ERP'))
        expect(peekLogo).toEqual(logo)
        expect(await box(page.locator('main'))).toEqual(mainBefore)
        const peekPanel = await box(panel(page))
        await expectNoMotion(page)

        // Clicking while peeking pins the panel where it is.
        await toggle(page).click()
        await expect(panel(page)).toBeVisible()
        expect(await box(toggle(page))).toEqual(pinned)
        expect(await box(panel(page))).toEqual(peekPanel)
        await page.mouse.move(width - 10, 890)
        await page.waitForTimeout(500)
        await expect(panel(page)).toBeVisible()
        expect(await page.evaluate(() => localStorage.getItem('tci-erp-sidebar'))).toBe('open')
      })
    })
  }
}

test.describe('peek', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test.beforeEach(async ({ page, context }) => {
    await stubBackend(context, { lang: 'ru', sidebar: 'closed' })
    await page.goto(PAGE)
    await expect(toggle(page)).toBeVisible()
    await expect(panel(page)).toHaveCount(0)
  })

  test('opens from the 8px left edge and closes after the pointer leaves', async ({ page }) => {
    await page.mouse.move(700, 450)
    await page.mouse.move(3, 450)
    await expect(panel(page)).toBeVisible()
    await page.mouse.move(150, 450) // over the panel (256px wide): stays
    await page.waitForTimeout(500)
    await expect(panel(page)).toBeVisible()
    // Off it: not at once (the 300 ms grace), but soon after.
    await page.mouse.move(1000, 450)
    expect(await panel(page).count()).toBe(1)
    await expect(panel(page)).toHaveCount(0, { timeout: 1500 })
  })

  test('a pass over the toggle shorter than the hover intent does not open it', async ({ page }) => {
    await toggle(page).hover()
    await page.mouse.move(1000, 450)
    await page.waitForTimeout(400)
    await expect(panel(page)).toHaveCount(0)
  })

  test('closes on Esc and on a click outside', async ({ page }) => {
    await peek(page)
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)

    await peek(page)
    await page.mouse.click(1000, 600)
    await expect(panel(page)).toHaveCount(0)
  })

  test('keyboard: Enter on the focused toggle pins; Tab moves into the menu', async ({ page }) => {
    await toggle(page).focus()
    await page.keyboard.press('Enter')
    await expect(panel(page)).toBeVisible()
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('#app-sidebar')))).toBe(true)
  })

  test('Tab moves from the toggle into a peeking menu', async ({ page }) => {
    await peek(page)
    await toggle(page).focus()
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('#app-sidebar')))).toBe(true)
  })

  test('Ctrl+B pins and unpins', async ({ page }) => {
    await page.keyboard.press('Control+b')
    await expect(panel(page)).toBeVisible()
    await page.keyboard.press('Control+b')
    await expect(panel(page)).toHaveCount(0)
  })
})
