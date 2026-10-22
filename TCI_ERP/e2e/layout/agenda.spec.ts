/**
 * The Agenda («Моя повестка»), beyond what layout.spec.ts checks on every
 * list screen:
 *
 * - ALIGNMENT. Every row — in every group, and the sub-rows of a collapsed
 *   row once expanded — sits on one grid (src/features/agenda/rowGrid.ts), so
 *   the left edge of every task title and of every context line is the SAME
 *   x, to the device pixel, in en, ru and uz alike; and no type tag the demo
 *   book holds is cut by its column.
 * - THE HEADER. The List | Triage switch and «Group by» keep identical boxes
 *   in both views and whichever grouping is chosen.
 *
 * Fixtures: the credit demo user's board (11 tasks, no collapsed row) and the
 * commercial one's (premium instalments collapse into one row with a
 * sub-list). The network is sealed, as in the rest of the guard.
 */

import { expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'

import { sealNetwork } from '../support/network'
import { LANGS, stubBackend } from '../support/stub'
import type { Lang } from '../support/stub'
import { loadFixture, replay } from './fixtures'

test.use({
  launchOptions: {
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
})

const BOARDS = ['credit', 'commercial'] as const
const WIDTHS = [1440, 1280] as const

async function openAgenda(browser: Browser, role: (typeof BOARDS)[number], lang: Lang, width: number) {
  const fixture = loadFixture(role)
  test.skip(!fixture, 'no fixtures recorded')
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  const seal = await sealNetwork(context)
  await stubBackend(context, { lang, user: fixture!.user, respond: replay(fixture!), sidebar: 'open' })
  const page = await context.newPage()
  await page.goto('/agenda')
  // The page is a lazy chunk: wait for the board itself, not just the network.
  await page.locator('main [data-agenda-title]').first().waitFor({ timeout: 30_000 })
  await settle(page)
  return { context, page, seal }
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForTimeout(250)
}

/** Opens every closed group and expands every collapsed row. */
async function expandAll(page: Page): Promise<number> {
  for (const show of await page.locator('main section > h2 button[aria-expanded="false"]').all()) await show.click()
  const chevrons = page.locator('main [data-layout-row] button[aria-expanded="false"]:not([aria-haspopup])')
  const n = await chevrons.count()
  for (let i = 0; i < n; i++) await chevrons.first().click()
  await page.mouse.move(2, 898)
  await page.waitForTimeout(150)
  return n
}

/** Left edges in device pixels, keyed by what they are. */
async function lefts(page: Page) {
  return page.evaluate(() => {
    const dpr = window.devicePixelRatio || 1
    const x = (el: Element) => Math.round(el.getBoundingClientRect().left * dpr) / dpr
    const text = (el: Element) => ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
    const titles = [...document.querySelectorAll('main [data-agenda-title]')].map((el) => ({
      x: x(el),
      sub: Boolean(el.closest('[data-agenda-subrow]')),
      what: text(el),
    }))
    const contexts = [...document.querySelectorAll('main [data-agenda-context]')].map((el) => ({ x: x(el), what: text(el) }))
    const cutTags = [...document.querySelectorAll('main [data-agenda-tag]')]
      .filter((tag) => [...tag.querySelectorAll('span')].some((s) => s.scrollWidth > s.clientWidth + 0.5))
      .map(text)
    return { titles, contexts, cutTags }
  })
}

for (const role of BOARDS) {
  test(`agenda ${role}: every title and context line starts at one x, in en, ru and uz`, async ({ browser }) => {
    test.setTimeout(120_000)
    for (const width of WIDTHS) {
      const perLang: Record<string, number> = {}
      for (const lang of LANGS) {
        const { context, page, seal } = await openAgenda(browser, role, lang, width)
        try {
          const expanded = await expandAll(page)
          const { titles, contexts, cutTags } = await lefts(page)
          const at = `${role} ${lang} @ ${width}`
          expect(titles.length, `${at}: titles found`).toBeGreaterThan(1)
          if (expanded > 0) expect(titles.some((t) => t.sub), `${at}: an expanded sub-row is measured`).toBe(true)
          const x0 = titles[0]!.x
          expect(
            titles.filter((t) => t.x !== x0).map((t) => `${t.sub ? 'sub-row ' : ''}«${t.what}» at ${t.x}, not ${x0}`),
            `${at}: title left edges`,
          ).toEqual([])
          expect(
            contexts.filter((c) => c.x !== x0).map((c) => `«${c.what}» at ${c.x}, not ${x0}`),
            `${at}: context line left edges`,
          ).toEqual([])
          expect(cutTags, `${at}: tags cut by their column`).toEqual([])
          expect(seal.violations()).toEqual([])
          perLang[lang] = x0
        } finally {
          await context.close()
        }
      }
      // The tracks are fixed: the title column starts at the same x whatever the language.
      expect(new Set(Object.values(perLang)).size, `${role} @ ${width}: title x per language ${JSON.stringify(perLang)}`).toBe(1)
    }
  })
}

for (const lang of LANGS) {
  test(`agenda header · ${lang}: the view switch and «Group by» keep their boxes in List and Triage`, async ({ browser }) => {
    test.setTimeout(90_000)
    for (const width of WIDTHS) {
      const { context, page, seal } = await openAgenda(browser, 'credit', lang, width)
      try {
        const boxes = () =>
          page.evaluate(() =>
            ['[data-agenda-views]', '[data-agenda-groupby]'].map((sel) => {
              const b = document.querySelector(`main ${sel}`)?.getBoundingClientRect()
              return b ? [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 100) / 100) : null
            }),
          )
        const views = page.locator('main [data-agenda-views] button')
        const groupBy = page.locator('main [data-agenda-groupby] button[aria-haspopup]')
        const list = await boxes()
        expect(list[0], 'the view switch is there').not.toBeNull()
        expect(list[1], '«Group by» is there in List').not.toBeNull()

        await views.nth(1).click()
        await settle(page)
        expect(await page.locator('main [data-agenda-views] button[aria-pressed="true"]').innerText()).toBe(
          await views.nth(1).innerText(),
        )
        expect(await boxes(), `${lang} @ ${width}: Triage vs List`).toEqual(list)

        // «Group by» works in Triage, and choosing another grouping moves nothing.
        for (const index of [1, 2, 0]) {
          await groupBy.click()
          await page.locator('[role="menu"] [role="menuitem"]').nth(index).click()
          await settle(page)
          expect(await boxes(), `${lang} @ ${width}: Triage, grouping ${index}`).toEqual(list)
        }

        await views.nth(0).click()
        await settle(page)
        expect(await boxes(), `${lang} @ ${width}: back to List`).toEqual(list)
        expect(seal.violations()).toEqual([])
      } finally {
        await context.close()
      }
    }
  })
}

test('agenda triage: «Group by» regroups the queue', async ({ browser }) => {
  const { context, page } = await openAgenda(browser, 'credit', 'en', 1440)
  try {
    await page.locator('main [data-agenda-views] button').nth(1).click()
    await settle(page)
    const headers = () => page.locator('main .lg\\:sticky [class*="uppercase"]').allInnerTexts()
    const byDue = await headers()
    await page.locator('main [data-agenda-groupby] button[aria-haspopup]').click()
    await page.locator('[role="menu"] [role="menuitem"]').nth(2).click() // type
    await settle(page)
    const byType = await headers()
    expect(byType).not.toEqual(byDue)
    expect(byType.join(' ')).toMatch(/limits/i)
  } finally {
    await context.close()
  }
})
