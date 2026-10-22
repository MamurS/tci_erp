/**
 * Layout guard (DESIGN.md «No layout shift on interaction»): on every
 * table/list screen, in en, ru and uz, at 1440×900 and 1280×800, nothing in
 * a table, a list row, a tab strip or a chip bar moves or resizes by more
 * than 1 px when the first row is hovered, or any control in it is hovered,
 * clicked and dismissed with Escape — and no column other than the fill
 * column cuts its content (a reservation too small for one language).
 *
 * Screens come from the router (screens.ts covers every route in App.tsx);
 * their data is the demo book recorded once (tools/layout-fixtures/record.mjs)
 * and replayed by the stub. The network is SEALED (e2e/support/network.ts):
 * every *.supabase.co call is answered by the stub, anything else off
 * localhost is aborted, and a test fails if any request tried to leave the
 * machine. Writes answer an empty success.
 *
 *   npm run test:e2e -- e2e/layout                 # everything
 *   LAYOUT_VIEWPORTS=1280 npm run test:e2e -- e2e/layout   # one viewport
 *   LAYOUT_STATIC=1 …       # cuts and sideways scroll only, no interaction
 */

import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'

import { sealNetwork } from '../support/network'
import type { NetworkSeal } from '../support/network'
import { LANGS, stubBackend } from '../support/stub'
import type { Lang } from '../support/stub'
import { loadFixture, replay } from './fixtures'
import type { RoleFixture, Variant } from './fixtures'
import { clipped, markActions, moved, snapshot } from './measure'
import { DEMO_ROLES, PENDING_VARIANTS, ROUTES, appRoutes } from './screens'

const ALL_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
] as const
const VIEWPORTS = process.env.LAYOUT_VIEWPORTS
  ? ALL_VIEWPORTS.filter((v) => process.env.LAYOUT_VIEWPORTS!.split(',').includes(String(v.width)))
  : ALL_VIEWPORTS

// Scrollbars shown, as on Windows: a scrollbar that appears is a shift too.
test.use({
  launchOptions: {
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
})

const FIXTURES = Object.fromEntries(DEMO_ROLES.map((role) => [role, loadFixture(role)])) as Record<
  string,
  RoleFixture | null
>

test('every route is guarded, or excused with a reason', () => {
  const routes = appRoutes()
  expect(routes.filter((r) => !(r in ROUTES)), 'routes in App.tsx missing from e2e/layout/screens.ts').toEqual([])
  expect(Object.keys(ROUTES).filter((r) => !routes.includes(r)), 'screens.ts names routes App.tsx no longer has').toEqual([])
  const unrecorded = Object.entries(ROUTES)
    .filter(([, e]) => e.role)
    .filter(([pattern, e]) => !FIXTURES[e.role!]?.variants.some((v) => v.pattern === pattern))
    .map(([pattern, e]) => `${pattern} (${e.role}) — run tools/layout-fixtures/record.mjs`)
  expect(unrecorded, 'routes with no recorded screen').toEqual([])
})

test('the network is sealed: canonical and every other real host are unreachable', async ({ browser }) => {
  const fixture = FIXTURES.commercial
  test.skip(!fixture, 'no fixtures recorded')
  const { context, seal } = await newContext(browser, fixture!, 'ru', 1280, 800)
  const page = await context.newPage()
  await page.goto('/entities')
  const outcomes = await page.evaluate(async () => {
    const tryFetch = (url: string) =>
      fetch(url, { mode: 'no-cors' }).then(
        () => 'reached',
        () => 'blocked',
      )
    return Promise.all([
      tryFetch('https://reunqrpeumokqgarknge.supabase.co/rest/v1/'),
      tryFetch('https://example.com/'),
      tryFetch('https://stub.supabase.co/functions/v1/anything'),
    ])
  })
  expect(outcomes).toEqual(['blocked', 'blocked', 'blocked'])
  expect(seal.violations()).toHaveLength(3)
  await context.close()
})

function variantName(v: Variant): string {
  const path = v.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')
  return v.tab ? `${path} › tab «${v.tab.label}»` : path
}

const pending = (v: Variant) => Object.keys(PENDING_VARIANTS).find((k) => v.path.includes(k))

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForTimeout(250)
}

async function open(page: Page, variant: Variant) {
  await page.goto(variant.path)
  await settle(page)
  if (variant.tab) {
    await page.locator('main [role="tablist"]').nth(variant.tab.list).locator('[role="tab"]').nth(variant.tab.index).click()
    await settle(page)
  }
  // The pointer starts off the content, in the page's bottom-right corner.
  await page.mouse.move(page.viewportSize()!.width - 2, page.viewportSize()!.height - 2)
  await page.waitForTimeout(100)
}

async function newContext(
  browser: import('@playwright/test').Browser,
  fixture: RoleFixture,
  lang: Lang,
  width: number,
  height: number,
): Promise<{ context: BrowserContext; seal: NetworkSeal }> {
  const context = await browser.newContext({ viewport: { width, height } })
  // Sealed first, so the stub's routes take precedence and anything they do
  // not answer is aborted: the guard never reaches a real host.
  const seal = await sealNetwork(context)
  await stubBackend(context, { lang, user: fixture.user, respond: replay(fixture), sidebar: 'open' })
  // Downloads and new windows go nowhere.
  await context.addInitScript(() => {
    window.open = () => null
  })
  return { context, seal }
}

for (const role of DEMO_ROLES) {
  const fixture = FIXTURES[role]
  if (!fixture) continue
  for (const variant of fixture.variants) {
    for (const lang of LANGS) {
      test(`${role} ${variantName(variant)} · ${lang}`, async ({ browser }) => {
        test.skip(Boolean(pending(variant)), PENDING_VARIANTS[pending(variant) ?? ''] ?? '')
        test.setTimeout(150_000)
        const failures: string[] = []
        for (const { width, height } of VIEWPORTS) {
          const at = `${width}px`
          const { context, seal } = await newContext(browser, fixture, lang, width, height)
          const page = await context.newPage()
          try {
            await open(page, variant)
            const url = page.url()

            for (const cut of await clipped(page)) failures.push(`${at} ${cut}`)
            // LAYOUT_STATIC=1: cuts and sideways scroll only (calibrating widths).
            if (process.env.LAYOUT_STATIC) continue

            const base = await snapshot(page)
            /** Compares with the baseline; false when the page navigated away
             * (a control that is a link in disguise: nothing to compare). */
            const check = async (what: string, below?: number): Promise<boolean> => {
              const take = () => (page.url() === url ? snapshot(page).catch(() => null) : Promise.resolve(null))
              let after = await take()
              if (!after) return false
              // Boxes of zero size everywhere: React is showing a Suspense
              // fallback while the dev server serves a chunk — not a layout,
              // a moment. Look again once it has passed.
              if (Object.entries(after).some(([k, b]) => b[2] === 0 && b[3] === 0 && (base[k]?.[2] ?? 0) > 0)) {
                await settle(page)
                after = await take()
                if (!after) return false
              }
              for (const m of moved(base, after, 1, below)) failures.push(`${at} ${what} → ${m}`)
              return true
            }
            const reopen = async () => {
              await open(page, variant)
              await markActions(page)
            }

            // Hovering each first row (marked data-lg-row by markActions).
            const actions = await markActions(page)
            const firstRows = page.locator('[data-lg-row]')
            const rows = await firstRows.count()
            for (let i = 0; i < rows; i++) {
              const row = page.locator(`[data-lg-row="${i}"]`)
              if (!(await row.isVisible())) continue
              await row.hover({ position: { x: 6, y: 6 }, timeout: 2000 }).catch(() => undefined)
              await page.waitForTimeout(160)
              if (!(await check(`hover row (${i + 1})`))) await reopen()
            }

            // Each control in a first row: hover, click, Escape.
            test.info().annotations.push({
              type: `covered ${at}`,
              description: `${Object.keys(base).filter((k) => /^table \d+$/.test(k)).length} tables, ${rows} first rows, ${actions.length} row controls: ${actions.map((a) => a.label).join(' | ')}`,
            })
            for (const action of actions) {
              const control = page.locator(`[data-lg-act="${action.id}"]`)
              if (!(await control.count()) || !(await control.isVisible())) continue
              // Through its row, as a person reaches it: a control revealed on
              // row hover only takes the pointer once the row is hovered.
              const row = page.locator('[data-lg-row]').filter({ has: control })
              if (await row.count()) await row.first().hover({ position: { x: 6, y: 6 }, timeout: 2000 }).catch(() => undefined)
              await control.hover({ timeout: 2000 }).catch(() => undefined)
              await page.waitForTimeout(120)
              if (!(await check(`hover «${action.label}»`))) {
                await reopen()
                continue
              }
              await control.click({ timeout: 2000 }).catch(() => undefined)
              await page.waitForTimeout(220)
              const opened =
                page.url() === url &&
                action.disclosure &&
                (await control.getAttribute('aria-expanded', { timeout: 1000 }).catch(() => null)) === 'true'
              if (!(await check(`click «${action.label}»`, opened ? action.rowBottom : undefined))) {
                await reopen()
                continue
              }
              // A disclosure closes the way it opened; anything else with Escape.
              if (opened) await control.click({ timeout: 2000 }).catch(() => undefined)
              else await page.keyboard.press('Escape')
              await page.waitForTimeout(160)
              // A dialog Escape did not close would hide the rest: close it.
              if (await page.locator('[role="dialog"]').count()) {
                await page.keyboard.press('Escape')
                await page.waitForTimeout(120)
              }
              await page.mouse.move(width - 2, height - 2)
              await page.waitForTimeout(120)
              if (!(await check(`after «${action.label}» + Escape`))) await reopen()
              else if ((await page.locator(`[data-lg-act]`).count()) === 0) await markActions(page)
            }
          } finally {
            for (const v of seal.violations()) failures.push(`${at} network: ${v}`)
            await context.close()
          }
        }
        expect([...new Set(failures)], `${role} ${variantName(variant)} · ${lang}`).toEqual([])
      })
    }
  }
}
