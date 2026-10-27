/**
 * The TEXT size (uiScale.ts, migration 0081): on every screen the layout
 * guard visits, at the largest text size (150 %) with the zoom at 100 % on
 * the owner's screen (1440×900), in en, ru and uz, nothing is cut
 * (`clipped`, the same rule as layout.spec.ts) and the page itself never
 * scrolls sideways. Only the type grows; the columns that hold text widen
 * with it (Table), so a wide list or tab strip MAY scroll sideways inside its
 * own card — as under the zoom (scale.spec.ts) — but a cut header, cell or
 * badge is a failure.
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

const TEXT = 150

test.use({
  viewport: { width: 1440, height: 900 },
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
    test(`text size: ${role} ${variantName(variant)}`, async ({ browser }) => {
      test.skip(Boolean(pending(variant)), PENDING_VARIANTS[pending(variant) ?? ''] ?? '')
      test.setTimeout(150_000)
      const failures: string[] = []
      for (const lang of LANGS) {
        const at = `${lang} @ text ${TEXT}%`
        const context = await browser.newContext()
        const seal = await sealNetwork(context)
        await stubBackend(context, { lang, user: fixture.user, respond: replay(fixture), sidebar: 'open', uiTextScale: TEXT })
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
          const applied = await page.evaluate(() => document.documentElement.dataset.uiText)
          if (applied !== String(TEXT)) failures.push(`${at}: the text is at ${applied ?? '?'}%`)
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
      expect(failures, `${role} ${variantName(variant)}`).toEqual([])
    })
  }
}
