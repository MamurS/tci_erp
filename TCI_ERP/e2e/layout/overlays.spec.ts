/**
 * Overlays (bug 2026-11-03: «Запросить организацию» from the top-bar search
 * opened INSIDE the top bar — its backdrop covered the 64 px bar only and the
 * dialog was cut off at the bar's bottom edge, because the bar's
 * `backdrop-filter` made it the containing block of the fixed dialog).
 *
 * For every overlay the app opens — from the top bar, the sidebar, the
 * search, Agenda rows, tables, inside a dialog, and in the portal — with the
 * demo banner on and off, at 1280×720 and 1920×1080, in en / ru / uz:
 *
 * - it is portalled: outside the app root, a child of <body>;
 * - its box is wholly inside the viewport;
 * - it is on top: the element at its centre belongs to it;
 * - a dialog's backdrop covers the whole viewport, the dialog sits below the
 *   demo banner, focus is inside it, Tab stays inside it and Esc closes it.
 *
 * Demo books (e2e/layout/fixtures) where recorded; the network SEALED
 * (e2e/support/network.ts) — nothing reaches *.supabase.co.
 */

import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'
import type { Browser, Locator, Page } from '@playwright/test'

import { sealNetwork } from '../support/network'
import { LANGS, stubBackend } from '../support/stub'
import type { Lang, StubReply, StubRequest } from '../support/stub'
import { loadFixture, replay } from './fixtures'
import type { DemoRole } from './screens'

test.use({
  launchOptions: {
    executablePath: process.env.PW_CHROMIUM_PATH || undefined,
  },
})

type Locale = Record<string, unknown>
const LOCALES = Object.fromEntries(
  LANGS.map((lang) => [
    lang,
    JSON.parse(readFileSync(`src/i18n/locales/${lang}.json`, 'utf8')) as Locale,
  ]),
) as Record<Lang, Locale>

function text(lang: Lang, key: string): string {
  let node: unknown = LOCALES[lang]
  for (const part of key.split('.')) node = (node as Record<string, unknown>)[part]
  if (typeof node !== 'string') throw new Error(`no ${lang} string for ${key}`)
  return node
}

/** The search term the scenarios type: nothing matches it, so the search
 * offers «request this company». */
const NOTHING = 'zqxwv'

/** The demo book, except that a search for NOTHING finds nothing. */
function answer(recorded: (request: StubRequest) => StubReply | undefined) {
  return (request: StubRequest): StubReply | undefined => {
    if (request.method === 'GET' && decodeURIComponent(request.url.search).includes(NOTHING))
      return { json: [] }
    return recorded(request)
  }
}

const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
] as const

type Kind = 'modal' | 'popover' | 'drawer' | 'tour' | 'toast'

interface Scenario {
  name: string
  /** The demo book to replay; none: an empty book. */
  fixture?: DemoRole
  /** Roles for the empty book. */
  roles?: string[]
  path: string
  kind: Kind
  /** Opens the overlay; returns its box (the dialog, the menu, the panel). */
  open: (page: Page, lang: Lang) => Promise<Locator>
  /** Skipped with this reason when the screen does not offer the overlay. */
  absent?: string
}

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  await page.waitForTimeout(200)
}

const dialog = (page: Page) => page.locator('[role="dialog"][aria-modal="true"]').last()

async function openSearchList(page: Page) {
  const input = page.locator('[data-global-search]')
  await input.click()
  await input.fill(NOTHING)
  const list = page.locator('#global-search-list')
  await expect(list.locator('[role="option"]').first()).toBeVisible({ timeout: 10_000 })
  return list
}

async function openUserMenu(page: Page) {
  await page.locator('header button[aria-haspopup="menu"]').first().click()
  return page.locator('[role="menu"]').last()
}

const SCENARIOS: Scenario[] = [
  {
    name: 'top bar › search results',
    fixture: 'commercial',
    path: '/',
    kind: 'popover',
    open: (page) => openSearchList(page),
  },
  {
    // The reported bug.
    name: 'top bar › search › «request a company» dialog',
    fixture: 'commercial',
    path: '/',
    kind: 'modal',
    open: async (page, lang) => {
      const list = await openSearchList(page)
      await list.getByText(text(lang, 'data.notFound.paletteSub')).click()
      return dialog(page)
    },
  },
  {
    name: 'top bar › user menu',
    fixture: 'commercial',
    path: '/',
    kind: 'popover',
    open: (page) => openUserMenu(page),
  },
  {
    name: 'top bar › user menu › guided tour',
    fixture: 'commercial',
    path: '/',
    kind: 'tour',
    open: async (page, lang) => {
      await openUserMenu(page)
      await page.getByRole('menuitem', { name: text(lang, 'tour.ui.takeTour') }).click()
      const card = page.locator('[data-testid="tour"] [role="dialog"]')
      await expect(card).toBeVisible({ timeout: 15_000 })
      return card
    },
  },
  {
    name: 'sidebar › toggle tooltip',
    fixture: 'commercial',
    path: '/',
    kind: 'popover',
    open: async (page, lang) => {
      await page.getByRole('button', { name: text(lang, 'nav.hide'), exact: true }).hover()
      const tip = page.locator('[role="tooltip"]')
      await expect(tip).toBeVisible({ timeout: 5_000 })
      return tip
    },
  },
  {
    name: 'sidebar › workspace switcher',
    roles: ['sales', 'claims'],
    path: '/',
    kind: 'popover',
    open: async (page) => {
      await page.locator('aside button[aria-haspopup="listbox"]').first().click()
      return page.locator('[role="listbox"][data-overlay="listbox"]').last()
    },
  },
  {
    name: 'Agenda row › ⋯ menu',
    fixture: 'credit',
    path: '/agenda',
    kind: 'popover',
    open: async (page) => {
      const row = page.locator('[data-row-key]').first()
      await row.hover()
      await row.locator('button[aria-haspopup="menu"]').last().click()
      return page.locator('[role="menu"]').last()
    },
  },
  {
    name: 'Agenda row › snooze › pick a date (dialog)',
    fixture: 'credit',
    path: '/agenda',
    kind: 'modal',
    open: async (page, lang) => {
      const row = page.locator('[data-row-key]').first()
      await row.hover()
      await row.getByRole('button', { name: text(lang, 'agenda.snooze.action') }).click()
      await page.getByRole('menuitem', { name: text(lang, 'agenda.snooze.pickDate') }).click()
      return dialog(page)
    },
  },
  {
    name: 'Agenda row › snooze dialog › calendar (above the dialog)',
    fixture: 'credit',
    path: '/agenda',
    kind: 'popover',
    open: async (page, lang) => {
      const row = page.locator('[data-row-key]').first()
      await row.hover()
      await row.getByRole('button', { name: text(lang, 'agenda.snooze.action') }).click()
      await page.getByRole('menuitem', { name: text(lang, 'agenda.snooze.pickDate') }).click()
      await dialog(page)
        .getByRole('button', { name: text(lang, 'date.openCalendar') })
        .click()
      return page.locator('[role="dialog"][data-overlay="popover"]').last()
    },
  },
  {
    name: 'registry › table settings',
    fixture: 'commercial',
    path: '/entities',
    kind: 'popover',
    open: async (page, lang) => {
      await page
        .getByRole('button', { name: text(lang, 'ui.table.settings') })
        .first()
        .click()
      return page.locator('[role="dialog"][data-overlay="popover"]').last()
    },
  },
  {
    name: 'registry row › quick view (side panel)',
    fixture: 'commercial',
    path: '/entities',
    kind: 'drawer',
    open: async (page, lang) => {
      const row = page.locator('main tbody tr').first()
      await row.hover()
      await row.getByTitle(text(lang, 'ui.quickView.label')).click()
      return page.locator('[data-side-panel]')
    },
  },
  {
    name: 'registry › new company (long form dialog)',
    fixture: 'info',
    path: '/entities',
    kind: 'modal',
    open: async (page, lang) => {
      await page
        .getByRole('button', { name: text(lang, 'entities.add') })
        .first()
        .click()
      return dialog(page)
    },
  },
  {
    name: 'portal › request a limit (dialog)',
    fixture: 'client',
    path: '/portal/limits',
    kind: 'modal',
    open: async (page, lang) => {
      await page
        .getByRole('button', { name: text(lang, 'portal.limits.request') })
        .first()
        .click()
      return dialog(page)
    },
  },
  {
    name: 'portal › request a limit › company picker (above the dialog)',
    fixture: 'client',
    path: '/portal/limits',
    kind: 'popover',
    open: async (page, lang) => {
      await page
        .getByRole('button', { name: text(lang, 'portal.limits.request') })
        .first()
        .click()
      const picker = dialog(page).locator('input[role="combobox"]').first()
      await picker.click()
      await picker.fill('dem')
      const list = page.locator('[role="listbox"][data-overlay="listbox"]').last()
      await expect(list).toBeVisible({ timeout: 10_000 })
      return list
    },
  },
  {
    name: 'new version toast',
    fixture: 'credit',
    path: '/agenda',
    kind: 'toast',
    open: async (page) => {
      const toast = page.getByTestId('new-version-notice')
      await expect(toast).toBeVisible({ timeout: 15_000 })
      return toast
    },
  },
]

interface Geometry {
  /** The window (what a backdrop must cover) and the part of it not taken by
   * a scrollbar (what a dialog must stay inside). */
  viewport: { width: number; height: number; inner: number }
  box: { left: number; top: number; right: number; bottom: number; width: number; height: number }
  portalled: boolean
  onTop: boolean
  backdrop: { left: number; top: number; right: number; bottom: number } | null
  bannerBottom: number | null
  focusInside: boolean
}

async function geometry(box: Locator): Promise<Geometry> {
  return box.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const root = document.getElementById('root')
    const cx = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1)
    const cy = Math.min(Math.max(r.top + Math.min(r.height / 2, 20), 0), window.innerHeight - 1)
    // A tooltip lets the pointer through (pointer-events: none), which hides
    // it from elementFromPoint: ask with the pointer caught for a moment.
    const pointer = (el as HTMLElement).style.pointerEvents
    ;(el as HTMLElement).style.pointerEvents = 'auto'
    const hit = document.elementFromPoint(cx, cy)
    ;(el as HTMLElement).style.pointerEvents = pointer
    const backdropEl = el.closest('[data-backdrop]')
    const b = backdropEl?.getBoundingClientRect() ?? null
    const banner = document.querySelector('[data-testid="demo-banner"]')
    return {
      viewport: {
        width: document.documentElement.clientWidth,
        height: window.innerHeight,
        inner: window.innerWidth,
      },
      box: {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
      },
      portalled: !(root?.contains(el) ?? false),
      onTop: Boolean(hit && (el === hit || el.contains(hit))),
      backdrop: b ? { left: b.left, top: b.top, right: b.right, bottom: b.bottom } : null,
      bannerBottom: banner ? banner.getBoundingClientRect().bottom : null,
      focusInside: el.contains(document.activeElement),
    }
  })
}

const EPS = 0.5

function expectInside(g: Geometry, label: string) {
  expect(g.box.width, `${label}: has a size`).toBeGreaterThan(0)
  expect(g.box.left, `${label}: left edge inside the viewport`).toBeGreaterThanOrEqual(-EPS)
  expect(g.box.top, `${label}: top edge inside the viewport`).toBeGreaterThanOrEqual(-EPS)
  expect(g.box.right, `${label}: right edge inside the viewport`).toBeLessThanOrEqual(
    g.viewport.width + EPS,
  )
  expect(g.box.bottom, `${label}: bottom edge inside the viewport`).toBeLessThanOrEqual(
    g.viewport.height + EPS,
  )
}

async function run(
  browser: Browser,
  scenario: Scenario,
  lang: Lang,
  viewport: (typeof VIEWPORTS)[number],
  banner: boolean,
) {
  const label = `${scenario.name} [${lang} ${viewport.width}×${viewport.height} banner ${banner ? 'on' : 'off'}]`
  const fixture = scenario.fixture ? loadFixture(scenario.fixture) : null
  if (scenario.fixture && !fixture)
    return { skipped: `no demo book recorded for ${scenario.fixture}` }
  const context = await browser.newContext({ viewport })
  const seal = await sealNetwork(context)
  await stubBackend(context, {
    lang,
    sidebar: 'open',
    demoMode: banner,
    ...(fixture
      ? { user: fixture.user, respond: answer(replay(fixture)) }
      : { roles: scenario.roles ?? ['sales'] }),
  })
  if (scenario.kind === 'toast') {
    await context.route('**/version.json*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ build: 'a-newer-build' }),
      }),
    )
  }
  const page = await context.newPage()
  try {
    await page.goto(scenario.path)
    await settle(page)
    if (banner) await expect(page.getByTestId('demo-banner')).toBeVisible({ timeout: 10_000 })
    const box = await scenario.open(page, lang)
    await expect(box).toBeVisible({ timeout: 10_000 })
    // Let the entrance (150 ms) finish before measuring.
    await page.waitForTimeout(250)
    const g = await geometry(box)

    expect(g.portalled, `${label}: rendered outside the app root (portal)`).toBe(true)
    expectInside(g, label)
    expect(g.onTop, `${label}: drawn on top`).toBe(true)

    if (scenario.kind === 'modal') {
      expect(g.backdrop, `${label}: has a backdrop`).not.toBeNull()
      const b = g.backdrop!
      expect(b.left, `${label}: backdrop left`).toBeLessThanOrEqual(EPS)
      expect(b.top, `${label}: backdrop top`).toBeLessThanOrEqual(EPS)
      expect(b.right, `${label}: backdrop right`).toBeGreaterThanOrEqual(g.viewport.inner - EPS)
      expect(b.bottom, `${label}: backdrop bottom`).toBeGreaterThanOrEqual(g.viewport.height - EPS)
      if (g.bannerBottom !== null && g.bannerBottom > 0)
        expect(g.box.top, `${label}: below the demo banner`).toBeGreaterThanOrEqual(
          g.bannerBottom - EPS,
        )
      expect(g.focusInside, `${label}: focus inside the dialog`).toBe(true)
      // Tab goes round inside the dialog.
      for (let i = 0; i < 12; i++) await page.keyboard.press('Tab')
      expect(
        await box.evaluate((el) => el.contains(document.activeElement)),
        `${label}: Tab stays inside`,
      ).toBe(true)
      await page.keyboard.press('Escape')
      await expect(box, `${label}: Esc closes it`).toBeHidden()
    }
    if (scenario.kind === 'tour') {
      const scrim = page.locator('[data-testid="tour"]')
      const s = await scrim.evaluate((el) => el.getBoundingClientRect().toJSON() as DOMRect)
      expect(s.left <= EPS && s.top <= EPS, `${label}: the tour covers the viewport`).toBe(true)
      expect(
        s.right >= g.viewport.inner - EPS && s.bottom >= g.viewport.height - EPS,
        `${label}: the tour covers the viewport`,
      ).toBe(true)
    }
    expect(seal.violations()).toEqual([])
    return { skipped: null }
  } finally {
    await context.close()
  }
}

for (const scenario of SCENARIOS) {
  for (const lang of LANGS) {
    test(`overlay: ${scenario.name} (${lang})`, async ({ browser }) => {
      test.setTimeout(180_000)
      for (const viewport of VIEWPORTS) {
        for (const banner of [false, true]) {
          const result = await run(browser, scenario, lang, viewport, banner)
          if (result.skipped) test.skip(true, result.skipped)
        }
      }
    })
  }
}
