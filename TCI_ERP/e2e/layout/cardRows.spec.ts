/**
 * Side-by-side cards end on one line (DESIGN.md «Side-by-side cards»).
 *
 * Every row of cards placed side by side is a `PanelGrid`, which marks
 * itself `data-card-row`: its cards stretch to the tallest, so on every
 * screen the layout guard visits, at 1280 and 1920 wide,
 * the cards of one line of such a row (children sharing a top edge) share
 * their bottom edge within 1 px. Rows that stack below their breakpoint have
 * one card per line and pass trivially.
 *
 * Same screens, same recorded demo book and the same SEALED network as
 * layout.spec.ts; the pending variants there are pending here too. Every
 * recorded tab of the company card, the policy and the claim is a variant.
 * Beyond them: the Agenda's TRIAGE view with a short and a long queue (3 /
 * 40 rows) and a short and a long task panel (the recorded thread / 30
 * comments) — two full-height panes that end on one line, scroll inside
 * themselves and keep their headers and the selected item in view — and the
 * two-column relationship dialog on the company card's group tab.
 */

import { expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'

import { sealNetwork } from '../support/network'
import { LANGS, stubBackend } from '../support/stub'
import type { Lang } from '../support/stub'
import { agendaBoard } from './agendaBoards'
import { loadFixture, replay } from './fixtures'
import type { RoleFixture, Variant } from './fixtures'
import { DEMO_ROLES, PENDING_VARIANTS } from './screens'

const WIDTHS = [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
] as const

test.use({
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

async function open(browser: Browser, fixture: RoleFixture, variant: Variant, lang: Lang, width: number, height: number) {
  const context = await browser.newContext({ viewport: { width, height } })
  const seal = await sealNetwork(context)
  await stubBackend(context, { lang, user: fixture.user, respond: replay(fixture), sidebar: 'open' })
  const page = await context.newPage()
  await page.goto(variant.path)
  await settle(page)
  if (variant.tab) {
    await page.locator('main [role="tablist"]').nth(variant.tab.list).locator('[role="tab"]').nth(variant.tab.index).click()
    await settle(page)
  }
  return { context, page, seal }
}

/** Per card row: its cards, grouped by top edge, whose bottoms differ. */
async function unevenRows(page: Page) {
  return page.evaluate(() => {
    const out: { rows: number; sideBySide: number; uneven: string[] } = { rows: 0, sideBySide: 0, uneven: [] }
    const text = (el: Element) => ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 32)
    // In <main>, and in an open dialog (a modal's two columns).
    document.querySelectorAll('main [data-card-row], [role="dialog"] [data-card-row]').forEach((row, ri) => {
      const cards = [...row.children].filter((c) => c.getClientRects().length && c.getBoundingClientRect().height > 0)
      if (!cards.length) return
      out.rows++
      const lines = new Map<number, Element[]>()
      for (const card of cards) {
        const top = Math.round(card.getBoundingClientRect().top)
        const line = [...lines.keys()].find((k) => Math.abs(k - top) <= 1) ?? top
        lines.set(line, [...(lines.get(line) ?? []), card])
      }
      for (const line of lines.values()) {
        if (line.length < 2) continue
        out.sideBySide++
        const bottoms = line.map((c) => c.getBoundingClientRect().bottom)
        if (Math.max(...bottoms) - Math.min(...bottoms) > 1)
          out.uneven.push(
            `row ${ri + 1}: ${line.map((c, i) => `«${text(c)}» ends at ${bottoms[i]!.toFixed(1)}`).join(', ')}`,
          )
      }
    })
    return out
  })
}

for (const role of DEMO_ROLES) {
  const fixture = loadFixture(role)
  if (!fixture) continue
  for (const variant of fixture.variants) {
    test(`card rows: ${role} ${variantName(variant)}`, async ({ browser }) => {
      test.skip(Boolean(pending(variant)), PENDING_VARIANTS[pending(variant) ?? ''] ?? '')
      test.setTimeout(150_000)
      const failures: string[] = []
      const covered: string[] = []
      // Stretching is structural, not a matter of wording: one language per
      // screen here (the layout guard runs all three); the triage panes,
      // whose heights are computed, run in all three below.
      for (const lang of ['ru'] as const) {
        for (const { width, height } of WIDTHS) {
          const { context, page, seal } = await open(browser, fixture, variant, lang, width, height)
          try {
            const result = await unevenRows(page)
            covered.push(`${lang}@${width}: ${result.rows} rows, ${result.sideBySide} side by side`)
            for (const u of result.uneven) failures.push(`${lang} @ ${width}px ${u}`)
            for (const v of seal.violations()) failures.push(`${lang} @ ${width}px network: ${v}`)
          } finally {
            await context.close()
          }
        }
      }
      test.info().annotations.push({ type: 'card rows', description: covered.join(' · ') })
      expect(failures, `${role} ${variantName(variant)}`).toEqual([])
    })
  }
}

// ---------------------------------------------------------------------------
// Agenda → Triage: two full-height panes
// ---------------------------------------------------------------------------

for (const [queue, thread] of [
  [3, 0],
  [3, 30],
  [40, 0],
  [40, 30],
] as const) {
  test(`card rows: agenda triage, ${queue} rows, ${thread ? 'long' : 'short'} task panel`, async ({ browser }) => {
    const fixture = loadFixture('credit')
    test.skip(!fixture, 'no fixtures recorded')
    test.setTimeout(300_000)
    const failures: string[] = []
    for (const lang of LANGS) {
      for (const { width, height } of WIDTHS) {
        const at = `${lang} @ ${width}px`
        const context = await browser.newContext({ viewport: { width, height } })
        const seal = await sealNetwork(context)
        await stubBackend(context, {
          lang,
          user: fixture!.user,
          respond: agendaBoard(fixture!, { queue, thread: thread || undefined }),
          sidebar: 'open',
        })
        const page = await context.newPage()
        try {
          await page.goto('/agenda')
          await page.locator('main [data-agenda-title]').first().waitFor({ timeout: 30_000 })
          await page.locator('main [data-agenda-views] button').nth(1).click()
          await page.locator('main [data-triage-pane="task"]').waitFor()
          await settle(page)

          const panes = () =>
            page.evaluate(() =>
              ['queue', 'task'].map((k) => {
                const pane = document.querySelector(`main [data-triage-pane="${k}"]`)
                if (!pane) return { top: NaN, bottom: NaN, headTop: null, scrolls: false, missing: k }
                const head = pane.querySelector('[data-triage-pane-head]')
                const scroll = pane.querySelector<HTMLElement>('[data-triage-scroll]')
                const r = pane.getBoundingClientRect()
                return {
                  top: r.top,
                  bottom: r.bottom,
                  headTop: head ? head.getBoundingClientRect().top : null,
                  scrolls: scroll ? scroll.scrollHeight > scroll.clientHeight + 1 : false,
                  missing: null as string | null,
                }
              }),
            )
          const [q, d] = await panes()
          if (q!.missing || d!.missing) {
            failures.push(`${at}: the ${q!.missing ?? d!.missing} pane is not on the page`)
            continue
          }
          if (Math.abs(q!.bottom - d!.bottom) > 1) failures.push(`${at}: queue ends at ${q!.bottom}, task at ${d!.bottom}`)
          if (Math.abs(q!.top - d!.top) > 1) failures.push(`${at}: queue starts at ${q!.top}, task at ${d!.top}`)
          if (q!.bottom > height) failures.push(`${at}: the panes run past the viewport (${q!.bottom} > ${height})`)
          // The page itself does not scroll: the panes do.
          const page_ = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: window.innerHeight }))
          if (page_.sh > page_.ih + 1) failures.push(`${at}: the page scrolls (${page_.sh} > ${page_.ih})`)
          if (queue === 40 && !q!.scrolls) failures.push(`${at}: a 40-row queue does not scroll inside its pane`)

          // Pinned heads: scrolling a pane leaves its head where it was.
          await page.evaluate(() =>
            document.querySelectorAll<HTMLElement>('main [data-triage-scroll]').forEach((el) => (el.scrollTop = el.scrollHeight)),
          )
          const [q2, d2] = await panes()
          if (q2!.headTop !== q!.headTop || d2!.headTop !== d!.headTop) failures.push(`${at}: a pane header moved when its pane scrolled`)
          await page.evaluate(() =>
            document.querySelectorAll<HTMLElement>('main [data-triage-scroll]').forEach((el) => (el.scrollTop = 0)),
          )

          // The selected item stays in view as J moves down the queue.
          await page.mouse.move(width - 2, height - 2)
          for (let i = 0; i < Math.min(queue - 1, 25); i++) await page.keyboard.press('j')
          await page.waitForTimeout(150)
          const visible = await page.evaluate(() => {
            const pane = document.querySelector<HTMLElement>('main [data-triage-pane="queue"] [data-triage-scroll]')
            if (!pane) return 'the queue pane is not on the page'
            const item = pane.querySelector('[aria-current="true"], [aria-pressed="true"], [data-selected="true"]')
            if (!item) return 'no selected item marked'
            const p = pane.getBoundingClientRect()
            const r = item.getBoundingClientRect()
            return r.top >= p.top - 1 && r.bottom <= p.bottom + 1 ? 'ok' : `selected item at ${r.top}–${r.bottom}, pane ${p.top}–${p.bottom}`
          })
          if (visible !== 'ok') failures.push(`${at}: ${visible}`)
          const [q3, d3] = await panes()
          if (Math.abs(q3!.bottom - d3!.bottom) > 1) failures.push(`${at} after J: panes end at ${q3!.bottom} / ${d3!.bottom}`)

          for (const v of seal.violations()) failures.push(`${at} network: ${v}`)
        } finally {
          await context.close()
        }
      }
    }
    expect(failures).toEqual([])
  })
}

// ---------------------------------------------------------------------------
// A dialog with two columns: the relationship direction on the group tab
// ---------------------------------------------------------------------------

test('card rows: the relationship dialog (company card › group)', async ({ browser }) => {
  const fixture = loadFixture('credit')
  test.skip(!fixture, 'no fixtures recorded')
  const variant = fixture!.variants.find((v) => v.path.includes('tab=group'))
  test.skip(!variant, 'no group tab recorded')
  const failures: string[] = []
  for (const { width, height } of WIDTHS) {
    const { context, page, seal } = await open(browser, fixture!, variant!, 'ru', width, height)
    try {
      const add = page.locator('main button').filter({ hasText: /связь|relationship|bog‘liqlik/i }).first()
      test.skip(!(await add.count()), 'the demo user is not offered «add relationship»')
      await add.click()
      await page.locator('[role="dialog"] [data-card-row]').waitFor()
      const result = await unevenRows(page)
      if (result.sideBySide === 0 && width >= 1280) failures.push(`${width}px: the dialog's two columns are not side by side`)
      for (const u of result.uneven) failures.push(`${width}px ${u}`)
      for (const v of seal.violations()) failures.push(`${width}px network: ${v}`)
    } finally {
      await context.close()
    }
  }
  expect(failures).toEqual([])
})
