/**
 * One badge spec (DESIGN.md «Badges»): every badge, tag, counter and chip
 * is drawn by the Badge primitive (or wears `badgeClassName`) and says its
 * size class in `data-badge="sm|md"`. On every screen the layout guard
 * visits, in en / ru / uz:
 *
 * - badges of one size class have ONE height (to the device pixel) — and
 *   it is the spec's: sm 20 px, md 24 px;
 * - badges beside each other on a line (overlapping vertically, at most
 *   3 rem apart) share their vertical centre (±1 px);
 * - in a header (`data-badge-row`: the title and its status badges) every
 *   badge is centred on the title (±1 px);
 * - a badge is set in the body font, never in capitals by inheritance.
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

const SPEC_HEIGHT = { sm: 20, md: 24 } as const

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

/** What is wrong with the badges on the page, if anything. */
async function badgeProblems(page: Page, spec = SPEC_HEIGHT) {
  return page.evaluate((spec) => {
    const dpr = window.devicePixelRatio || 1
    const px = (v: number) => Math.round(v * dpr) / dpr
    const text = (el: Element) => ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 24)
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
    }
    const badges = [...document.querySelectorAll<HTMLElement>('main [data-badge], [role="dialog"] [data-badge]')].filter(shown)
    const problems: string[] = []
    const heights: Record<string, Set<number>> = {}
    for (const b of badges) {
      const size = b.dataset.badge as 'sm' | 'md'
      const h = px(b.getBoundingClientRect().height)
      ;(heights[size] ??= new Set()).add(h)
      if (spec[size] !== undefined && h !== spec[size]) problems.push(`«${text(b)}» (${size}) is ${h}px tall, not ${spec[size]}`)
      const s = getComputedStyle(b)
      if (s.textTransform === 'uppercase') problems.push(`«${text(b)}» (${size}) is set in capitals`)
      if (/PT Sans Narrow/i.test(s.fontFamily.split(',')[0] ?? '')) problems.push(`«${text(b)}» (${size}) is set in the display face`)
    }
    // Neighbours on one line share a centre.
    const boxes = badges.map((b) => ({ b, r: b.getBoundingClientRect() }))
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!
        const c = boxes[j]!
        const overlap = Math.min(a.r.bottom, c.r.bottom) - Math.max(a.r.top, c.r.top)
        const gap = Math.max(a.r.left, c.r.left) - Math.min(a.r.right, c.r.right)
        if (overlap <= 0 || gap > 48) continue
        const d = Math.abs((a.r.top + a.r.bottom) / 2 - (c.r.top + c.r.bottom) / 2)
        if (d > 1) problems.push(`«${text(a.b)}» and «${text(c.b)}» are side by side but their centres differ by ${d.toFixed(1)}px`)
      }
    }
    // In a header, every badge is centred on the title.
    for (const row of document.querySelectorAll('main [data-badge-row]')) {
      const title = row.querySelector('h1, h2')
      if (!title) continue
      const t = title.getBoundingClientRect()
      const tc = (t.top + t.bottom) / 2
      for (const b of row.querySelectorAll('[data-badge]')) {
        if (!shown(b)) continue
        const r = b.getBoundingClientRect()
        const d = Math.abs((r.top + r.bottom) / 2 - tc)
        if (d > 1) problems.push(`header badge «${text(b)}» sits ${d.toFixed(1)}px off the title's centre`)
      }
    }
    const counts = Object.fromEntries(Object.entries(heights).map(([k, v]) => [k, [...v]]))
    return { problems: [...new Set(problems)], counted: badges.length, heights: counts }
  }, spec)
}

for (const role of DEMO_ROLES) {
  const fixture = loadFixture(role)
  if (!fixture) continue
  for (const variant of fixture.variants) {
    test(`badges: ${role} ${variantName(variant)}`, async ({ browser }) => {
      test.skip(Boolean(pending(variant)), PENDING_VARIANTS[pending(variant) ?? ''] ?? '')
      test.setTimeout(120_000)
      const failures: string[] = []
      const covered: string[] = []
      for (const lang of LANGS) {
        const context = await browser.newContext()
        const seal = await sealNetwork(context)
        await stubBackend(context, { lang, user: fixture.user, respond: replay(fixture), sidebar: 'open' })
        const page = await context.newPage()
        try {
          await page.goto(variant.path)
          await settle(page)
          if (variant.tab) {
            await page.locator('main [role="tablist"]').nth(variant.tab.list).locator('[role="tab"]').nth(variant.tab.index).click()
            await settle(page)
          }
          const result = await badgeProblems(page)
          covered.push(`${lang}: ${result.counted} badges ${JSON.stringify(result.heights)}`)
          for (const p of result.problems) failures.push(`${lang}: ${p}`)
          for (const v of seal.violations()) failures.push(`${lang} network: ${v}`)
        } finally {
          await context.close()
        }
      }
      test.info().annotations.push({ type: 'badges', description: covered.join(' · ') })
      expect(failures, `${role} ${variantName(variant)}`).toEqual([])
    })
  }
}
