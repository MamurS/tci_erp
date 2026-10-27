/**
 * Target size (WCAG 2.2, 2.5.8 AA; the research brief's guardrails): every
 * thing a person clicks on a screen — a button, a tab, a menu item, a
 * checkbox, a select, a link that is not a word inside a sentence — is at
 * least 24 × 24 CSS px, OR is spaced so that a 24 px circle on its centre
 * touches no other target (the standard's spacing exception). Icon buttons
 * in table rows included.
 *
 * Every screen the layout guard visits, in English (sizes are rem and the
 * same in every language); same demo book and SEALED network as
 * layout.spec.ts.
 */

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

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

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForTimeout(250)
}

/** The targets that are too small and too close to another, described. */
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const MIN = 24
    const selector = [
      'button',
      '[role="button"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="option"]',
      'input[type="checkbox"]',
      'input[type="radio"]',
      'select',
      'a[href]',
    ].join(',')
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.opacity !== '0'
    }
    // A link that is a word or phrase inside running text is exempt (2.5.8
    // «inline»): its size is the line's.
    const inline = (el: Element) =>
      el.tagName === 'A' && Boolean(el.closest('p, li > span, dd, td > span')) && getComputedStyle(el).display === 'inline'
    const label = (el: Element) =>
      ((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.getAttribute('title') || el.tagName)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 32)
    // A checkbox inside its <label> is clicked through the label: the label is the target.
    const targetOf = (el: Element): Element =>
      el.tagName === 'INPUT' && el.closest('label') ? (el.closest('label') as Element) : el
    const roots = [...document.querySelectorAll('main, [role="dialog"], header')]
    const all = [...new Set(roots.flatMap((root) => [...root.querySelectorAll(selector)]))]
      .filter(shown)
      .filter((el) => !inline(el))
      .map((el) => ({ el, box: targetOf(el).getBoundingClientRect() }))
    const problems: string[] = []
    for (const a of all) {
      if (a.box.width >= MIN - 0.5 && a.box.height >= MIN - 0.5) continue
      const cx = a.box.left + a.box.width / 2
      const cy = a.box.top + a.box.height / 2
      // Spacing exception: no other target within 12 px of the centre.
      const crowded = all.some((b) => {
        if (b === a || b.box === a.box) return false
        if (b.el.contains(a.el) || a.el.contains(b.el)) return false
        const dx = Math.max(b.box.left - cx, 0, cx - b.box.right)
        const dy = Math.max(b.box.top - cy, 0, cy - b.box.bottom)
        return Math.hypot(dx, dy) < MIN / 2
      })
      if (crowded) problems.push(`«${label(a.el)}» is ${a.box.width.toFixed(0)}×${a.box.height.toFixed(0)} px with another target within 12 px`)
    }
    return { problems: [...new Set(problems)], counted: all.length }
  })
}

for (const role of DEMO_ROLES) {
  const fixture = loadFixture(role)
  if (!fixture) continue
  for (const variant of fixture.variants) {
    test(`targets: ${role} ${variantName(variant)}`, async ({ browser }) => {
      test.skip(Boolean(pending(variant)), PENDING_VARIANTS[pending(variant) ?? ''] ?? '')
      test.setTimeout(90_000)
      const context = await browser.newContext()
      const seal = await sealNetwork(context)
      await stubBackend(context, { lang: 'en', user: fixture.user, respond: replay(fixture), sidebar: 'open' })
      const page = await context.newPage()
      try {
        await page.goto(variant.path)
        await settle(page)
        if (variant.tab) {
          await page.locator('main [role="tablist"]').nth(variant.tab.list).locator('[role="tab"]').nth(variant.tab.index).click()
          await settle(page)
        }
        const result = await smallTargets(page)
        test.info().annotations.push({ type: 'targets', description: `${result.counted} targets` })
        expect(result.problems, `${role} ${variantName(variant)}`).toEqual([])
        expect(seal.violations()).toEqual([])
      } finally {
        await context.close()
      }
    })
  }
}
