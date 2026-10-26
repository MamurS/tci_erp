/**
 * View switches never move the page (DESIGN.md «No layout shift on
 * interaction»): on every screen the layout guard visits, in en, ru and uz,
 * every option of every view switch (the Segmented primitive: «In force |
 * All policies», a period, a display currency) is clicked in turn, and the
 * key-figure cells, the columns of fixed-layout tables and the tab strips
 * keep their place and width (±1 px) — when the switch shows the same
 * structure (as many cells, as many columns). A switch to a different
 * structure (an empty state, another table) has nothing to compare.
 *
 * Found by the owner (2026-10-26): «Policies in force» → «Policies» made the
 * key-figure cells redistribute their width, and a divider vanished.
 *
 * Same screens, demo book and SEALED network as layout.spec.ts.
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { sealNetwork } from '../support/network'
import { LANGS, stubBackend } from '../support/stub'
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

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForTimeout(250)
}

type Boxes = Record<string, Record<string, [number, number]>>

/** x and width of what must not move, grouped so that only like is compared
 * with like: the key figures of one strip, the columns of one table. */
async function layout(page: Page): Promise<Boxes> {
  return page.evaluate(() => {
    const out: Record<string, Record<string, [number, number]>> = {}
    const main = document.querySelector('main') ?? document.body
    const box = (el: Element): [number, number] => {
      const r = el.getBoundingClientRect()
      return [Math.round(r.left * 10) / 10, Math.round(r.width * 10) / 10]
    }
    const strips = new Set<Element>()
    main.querySelectorAll('[data-key-figure]').forEach((c) => c.parentElement && strips.add(c.parentElement))
    ;[...strips].forEach((strip, s) => {
      const cells = [...strip.querySelectorAll(':scope > [data-key-figure]')]
      out[`key figures ${s + 1} (${cells.length})`] = Object.fromEntries(cells.map((c, i) => [`cell ${i + 1}`, box(c)]))
    })
    let t = 0
    for (const table of main.querySelectorAll('table')) {
      if (table.closest('[role="dialog"]') || !table.getClientRects().length) continue
      t++
      if (getComputedStyle(table).tableLayout !== 'fixed') continue
      const ths = [...table.querySelectorAll(':scope > thead > tr > th')]
      out[`table ${t} (${ths.length} columns)`] = Object.fromEntries(ths.map((th, i) => [`column ${i + 1}`, box(th)]))
    }
    main.querySelectorAll('[role="tablist"]').forEach((list, l) => {
      const tabs = [...list.querySelectorAll('[role="tab"]')]
      out[`tabs ${l + 1} (${tabs.length})`] = Object.fromEntries(tabs.map((tab, i) => [`tab ${i + 1}`, box(tab)]))
    })
    return out
  })
}

function moved(before: Boxes, after: Boxes): string[] {
  const out: string[] = []
  for (const [group, items] of Object.entries(before)) {
    const next = after[group]
    if (!next) continue
    for (const [name, [x, w]] of Object.entries(items)) {
      const b = next[name]
      if (!b) continue
      if (Math.abs(b[0] - x) > 1 || Math.abs(b[1] - w) > 1) out.push(`${group} › ${name}: x ${x}→${b[0]}, width ${w}→${b[1]}`)
    }
  }
  return out
}

for (const role of DEMO_ROLES) {
  const fixture = loadFixture(role)
  if (!fixture) continue
  for (const variant of fixture.variants) {
    test(`switches: ${role} ${variantName(variant)}`, async ({ browser }) => {
      test.skip(Boolean(pending(variant)), PENDING_VARIANTS[pending(variant) ?? ''] ?? '')
      test.setTimeout(240_000)
      const failures: string[] = []
      const covered: string[] = []
      for (const lang of LANGS) {
        const context = await browser.newContext()
        const seal = await sealNetwork(context)
        await stubBackend(context, { lang, user: fixture.user, respond: replay(fixture), sidebar: 'open' })
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
          const url = page.url()
          const groups = page.locator('main [role="group"]:has(> button[aria-pressed])')
          const n = await groups.count()
          for (let g = 0; g < n; g++) {
            const buttons = groups.nth(g).locator(':scope > button[aria-pressed]')
            const options = await buttons.count()
            if (options < 2 || !(await groups.nth(g).isVisible())) continue
            const start = await buttons.evaluateAll((els) => els.findIndex((el) => el.getAttribute('aria-pressed') === 'true'))
            const before = await layout(page)
            for (let o = 0; o < options; o++) {
              if (o === start || (await buttons.nth(o).isDisabled())) continue
              const label = ((await buttons.nth(o).innerText()) || `option ${o + 1}`).trim()
              await buttons.nth(o).click()
              await settle(page)
              if (page.url().split('?')[0] !== url.split('?')[0]) break
              covered.push(`${lang}: «${label}»`)
              for (const m of moved(before, await layout(page))) failures.push(`${lang} «${label}»: ${m}`)
            }
            if (start >= 0 && page.url().split('?')[0] === url.split('?')[0]) {
              await buttons.nth(start).click()
              await settle(page)
            }
          }
          for (const v of seal.violations()) failures.push(`${lang} network: ${v}`)
        } finally {
          await context.close()
        }
      }
      test.info().annotations.push({ type: 'switches', description: covered.join(' · ') || 'none on this screen' })
      expect([...new Set(failures)], `${role} ${variantName(variant)}`).toEqual([])
    })
  }
}
