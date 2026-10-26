/**
 * Side-by-side cards start on one line (DESIGN.md «Side-by-side panels line
 * up»): on every screen the layout guard visits, wherever two blocks of a
 * grid or flex row stand side by side, the first card in each starts at the
 * same height (±1 px). A title above the card on one side means a title
 * above the card on the other.
 *
 * Found by the owner (2026-10-26) on the portal's «My policies»: each policy
 * opened with its number above its cards, while «What you can do» carried
 * its title inside the card, so the side card began 44 px higher.
 *
 * Same screens, demo book and SEALED network as layout.spec.ts.
 */

import { expect, test } from '@playwright/test'

import { sealNetwork } from '../support/network'
import { stubBackend } from '../support/stub'
import { loadFixture, replay } from './fixtures'
import type { Variant } from './fixtures'
import { DEMO_ROLES, PENDING_VARIANTS } from './screens'

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

for (const role of DEMO_ROLES) {
  const fixture = loadFixture(role)
  if (!fixture) continue
  for (const variant of fixture.variants) {
    test(`card tops: ${role} ${variantName(variant)}`, async ({ browser }) => {
      test.skip(Boolean(pending(variant)), PENDING_VARIANTS[pending(variant) ?? ''] ?? '')
      const context = await browser.newContext()
      const seal = await sealNetwork(context)
      await stubBackend(context, { lang: 'ru', user: fixture.user, respond: replay(fixture), sidebar: 'open' })
      const page = await context.newPage()
      try {
        await page.goto(variant.path)
        await page.waitForLoadState('networkidle').catch(() => undefined)
        await page.evaluate(() => document.fonts.ready.then(() => undefined))
        await page.waitForTimeout(250)
        if (variant.tab) {
          await page.locator('main [role="tablist"]').nth(variant.tab.list).locator('[role="tab"]').nth(variant.tab.index).click()
          await page.waitForLoadState('networkidle').catch(() => undefined)
          await page.waitForTimeout(250)
        }
        const misaligned = await page.evaluate(() => {
          const out: string[] = []
          const text = (el: Element) => ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)
          // A Card is the primitive with the card shadow (primitives.tsx).
          const firstCard = (el: Element) => (el.classList.contains('shadow-card') ? el : el.querySelector('.shadow-card'))
          for (const row of document.querySelectorAll('main *')) {
            const display = getComputedStyle(row).display
            if (display !== 'grid' && display !== 'flex') continue
            const blocks = [...row.children]
              .map((el) => ({ el, r: el.getBoundingClientRect() }))
              .filter(({ r }) => r.height > 0)
            for (let i = 0; i + 1 < blocks.length; i++) {
              const a = blocks[i]!
              const b = blocks[i + 1]!
              // Side by side: one top, the second to the right of the first.
              if (Math.abs(a.r.top - b.r.top) > 2 || b.r.left < a.r.right - 1) continue
              const ca = firstCard(a.el)
              const cb = firstCard(b.el)
              if (!ca || !cb) continue
              const d = ca.getBoundingClientRect().top - cb.getBoundingClientRect().top
              if (Math.abs(d) > 1) out.push(`«${text(a.el)}» and «${text(b.el)}»: their cards start ${Math.abs(d).toFixed(0)}px apart`)
            }
          }
          return [...new Set(out)]
        })
        for (const v of seal.violations()) misaligned.push(`network: ${v}`)
        expect(misaligned, `${role} ${variantName(variant)}`).toEqual([])
      } finally {
        await context.close()
      }
    })
  }
}
