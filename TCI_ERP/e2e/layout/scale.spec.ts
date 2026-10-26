/**
 * The interface text size (uiScale.ts, migration 0076): on every screen the
 * layout guard visits, at the larger sizes on a laptop (1280×800 at 150 %
 * and 200 %), in en, ru and uz, nothing is cut (`clipped`, the same rule
 * as layout.spec.ts) and the page itself never scrolls sideways. A wide list
 * or tab strip MAY scroll sideways inside its own card at these sizes — its
 * columns are rem and simply need twice the room at 200 %, exactly as under
 * the browser's zoom — so that one finding of `clipped` is not a failure
 * here; a cut header, cell or badge is.
 *
 * The other layout specs run at 100 %, the geometry they were written for:
 * at 150 % a 1280 px screen gets the layout of an 853 px one (the
 * breakpoints are container queries in rem), exactly as the browser's own
 * zoom would, so their side-by-side expectations do not apply there.
 *
 * Same screens, demo book and SEALED network as layout.spec.ts.
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { sealNetwork } from '../support/network'
import { LANGS, stubBackend } from '../support/stub'
import { loadFixture, replay } from './fixtures'
import type { Variant } from './fixtures'
import { clipped } from './measure'
import { DEMO_ROLES, PENDING_VARIANTS } from './screens'

const SCALES = [150, 200] as const

test.use({
  viewport: { width: 1280, height: 800 },
  launchOptions: {
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
})

const pending = (v: Variant) => Object.keys(PENDING_VARIANTS).find((k) => v.path.includes(k))

function variantName(v: Variant): string {
  const path = v.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')
  return v.tab ? `${path} › tab «${v.tab.label}»` : path
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForTimeout(250)
}

for (const role of DEMO_ROLES) {
  const fixture = loadFixture(role)
  if (!fixture) continue
  for (const variant of fixture.variants) {
    test(`scale: ${role} ${variantName(variant)}`, async ({ browser }) => {
      test.skip(Boolean(pending(variant)), PENDING_VARIANTS[pending(variant) ?? ''] ?? '')
      test.setTimeout(240_000)
      const failures: string[] = []
      for (const scale of SCALES) {
        for (const lang of LANGS) {
          const at = `${lang} @ ${scale}%`
          const context = await browser.newContext()
          const seal = await sealNetwork(context)
          await stubBackend(context, { lang, user: fixture.user, respond: replay(fixture), sidebar: 'open', uiScale: scale })
          await context.addInitScript(() => {
            window.open = () => null
          })
          const page = await context.newPage()
          try {
            await page.goto(variant.path)
            await settle(page)
            if (variant.tab) {
              await page.locator('main [role="tablist"]').nth(variant.tab.list).locator('[role="tab"]').nth(variant.tab.index).click()
              await settle(page)
            }
            const applied = await page.evaluate(() => document.documentElement.dataset.uiScale)
            if (applied !== String(scale)) failures.push(`${at}: the page is at ${applied ?? '?'}%`)
            const sideways = await page.evaluate(() => {
              const el = document.scrollingElement ?? document.documentElement
              return el.scrollWidth > el.clientWidth + 1 ? `${el.scrollWidth} > ${el.clientWidth}` : null
            })
            if (sideways) failures.push(`${at}: the page scrolls sideways (${sideways})`)
            for (const cut of await clipped(page)) if (!/scrolls? sideways/.test(cut)) failures.push(`${at} ${cut}`)
            for (const v of seal.violations()) failures.push(`${at} network: ${v}`)
          } finally {
            await context.close()
          }
        }
      }
      expect(failures, `${role} ${variantName(variant)}`).toEqual([])
    })
  }
}
