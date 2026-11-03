/**
 * The guided tour (Prompt 32, src/features/tour): it starts by itself for a
 * person with no record of it, walks the acting role's steps end to end —
 * opening the routes they name, skipping an anchor that is not on screen,
 * explaining an empty list — in en / ru / uz, records the outcome on the
 * profile (0098), and never starts again once a completed or skipped tour is
 * stored there. Also: Esc, the keyboard, «Take the tour», the start event, a
 * «What's new» tour, and that the overlay moves nothing under it.
 *
 * The demo book (e2e/layout/fixtures) where one is recorded, else an empty
 * one; the network SEALED (e2e/support/network.ts) — nothing reaches
 * *.supabase.co.
 */

import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'

import { loadFixture, replay } from '../layout/fixtures'
import type { DemoRole } from '../layout/screens'
import { sealNetwork } from '../support/network'
import type { NetworkSeal } from '../support/network'
import { LANGS, stubBackend } from '../support/stub'
import type { Lang, StubRequest } from '../support/stub'
import { ROLE_TOURS } from '../../src/features/tour/registry'
import type { UserRole } from '../../src/lib/roles'

test.use({ viewport: { width: 1440, height: 900 } })
// Every test walks the tour through several pages; a loaded CI runner needs
// more than the default 30 s.
test.describe.configure({ timeout: 120_000 })

type Locale = Record<string, unknown>
const LOCALES = Object.fromEntries(
  LANGS.map((lang) => [lang, JSON.parse(readFileSync(`src/i18n/locales/${lang}.json`, 'utf8')) as Locale]),
) as Record<Lang, Locale>

function text(lang: Lang, key: string): string {
  let node: unknown = LOCALES[lang]
  for (const part of key.split('.')) node = (node as Record<string, unknown>)[part]
  return node as string
}

interface RoleCase {
  role: UserRole
  /** The recorded demo book of a role that has one. */
  fixture?: DemoRole
  start: string
  /** Steps that must be SHOWN (not skipped) on the way. */
  shows: string[]
}

const CASES: RoleCase[] = [
  { role: 'sales', fixture: 'sales', start: '/', shows: ['welcome', 'workspace', 'search', 'requests', 'policies', 'agenda', 'userMenu', 'finish'] },
  { role: 'commercial_underwriter', fixture: 'commercial', start: '/', shows: ['welcome', 'policies', 'requests', 'limits', 'agenda', 'finish'] },
  { role: 'credit_underwriter', fixture: 'credit', start: '/', shows: ['welcome', 'workbench', 'queue', 'decision', 'agenda', 'finish'] },
  // No demo book recorded: the worklist is empty and the step says so.
  { role: 'credit_analyst', start: '/', shows: ['welcome', 'ratings', 'sectors', 'agenda', 'finish'] },
  { role: 'information_manager', fixture: 'info', start: '/', shows: ['welcome', 'requests', 'views', 'entities', 'finish'] },
  { role: 'claims', fixture: 'claims', start: '/', shows: ['welcome', 'queue', 'overdues', 'finish'] },
  { role: 'admin', start: '/', shows: ['welcome', 'tabs', 'users', 'authorities', 'finish'] },
  { role: 'client', fixture: 'client', start: '/portal', shows: ['welcome', 'sections', 'requestLimit', 'profile', 'finish'] },
]

interface Opened {
  page: Page
  seal: NetworkSeal
  /** Bodies of the profile writes (PATCH user_profiles). */
  writes: string[]
  errors: string[]
}

async function open(
  context: BrowserContext,
  c: RoleCase,
  lang: Lang,
  /** undefined: the stub's default, every tour already completed. */
  tourState: Record<string, unknown> | null | undefined,
  path = c.start,
): Promise<Opened> {
  const seal = await sealNetwork(context)
  const fixture = c.fixture ? loadFixture(c.fixture) : null
  const recorded = fixture ? replay(fixture) : null
  await stubBackend(context, {
    lang,
    sidebar: 'open',
    tourState,
    ...(fixture && recorded
      ? {
          user: fixture.user,
          // The demo book was recorded before 0085: it holds no
          // buyer_risk_context, and the stub's default (an empty list) is not
          // its shape. «No context» is a shape the decision page knows.
          respond: (r: StubRequest) => (r.rpc && r.resource === 'buyer_risk_context' ? { json: null } : recorded(r)),
        }
      : { roles: [c.role] }),
  })
  const page = await context.newPage()
  const writes: string[] = []
  const errors: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().includes('/rest/v1/user_profiles')) writes.push(request.postData() ?? '')
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(path)
  return { page, seal, writes, errors }
}

const dialog = (page: Page) => page.getByTestId('tour').getByRole('dialog')

/** The step on screen once it has settled (not busy). */
async function settledStep(page: Page): Promise<string> {
  const card = dialog(page)
  await expect(card).toBeVisible()
  await expect(card).not.toHaveAttribute('aria-busy', 'true', { timeout: 15_000 })
  return (await card.getAttribute('data-tour-step')) ?? ''
}

/** Next until Done; returns the steps shown, in order. */
async function walk(page: Page, lang: Lang): Promise<string[]> {
  const shown: string[] = []
  for (let i = 0; i < 30; i++) {
    const step = await settledStep(page)
    shown.push(step)
    const done = dialog(page).getByRole('button', { name: text(lang, 'tour.ui.done'), exact: true })
    if (await done.isVisible()) {
      await done.click()
      await expect(page.getByTestId('tour')).toHaveCount(0)
      return shown
    }
    await dialog(page).getByRole('button', { name: text(lang, 'tour.ui.next'), exact: true }).click()
    await expect
      .poll(async () => (await page.getByTestId('tour').count()) === 0 || (await dialog(page).getAttribute('data-tour-step')) !== step, {
        timeout: 15_000,
      })
      .toBe(true)
    if ((await page.getByTestId('tour').count()) === 0) return shown
  }
  throw new Error(`the tour did not end: ${shown.join(' → ')}`)
}

for (const c of CASES) {
  const tour = ROLE_TOURS[c.role]
  for (const lang of LANGS) {
    test(`${c.role} (${lang}): the tour starts on the first sign-in, runs to the end and is recorded`, async ({ browser }) => {
      test.skip(Boolean(c.fixture) && !loadFixture(c.fixture!), 'no demo book recorded for this role')
      test.setTimeout(120_000)
      const context = await browser.newContext()
      try {
        const { page, seal, writes, errors } = await open(context, c, lang, {})
        // The first visit may compile the page and fetch the en / uz strings.
        await expect(dialog(page)).toContainText(text(lang, tour.steps[0]!.titleKey), { timeout: 30_000 })
        // The card says where you are in the tour.
        const position = new RegExp(text(lang, 'tour.ui.step').replace('{{n}}', '1').replace('{{total}}', '\\d+'))
        await expect(dialog(page)).toContainText(position)
        const shown = await walk(page, lang)
        for (const id of c.shows) expect(shown, `${c.role}: shown ${shown.join(', ')}`).toContain(id)
        expect(shown.at(-1)).toBe(tour.steps.at(-1)!.id)
        // Recorded as completed on the person's own profile.
        await expect.poll(() => writes.join('\n')).toContain(`"${tour.id}":{"status":"completed"`)
        expect(errors).toEqual([])
        expect(seal.violations()).toEqual([])
      } finally {
        await context.close()
      }
    })
  }

  test(`${c.role}: a completed tour stored on the profile does not start again`, async ({ browser }) => {
    test.skip(Boolean(c.fixture) && !loadFixture(c.fixture!), 'no demo book recorded for this role')
    const context = await browser.newContext()
    try {
      const state = { [tour.id]: { status: 'completed', last_step: tour.steps.length - 1, at: '2026-11-02T08:00:00.000Z' } }
      const { page, seal } = await open(context, c, 'en', state)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(1500)
      await expect(page.getByTestId('tour')).toHaveCount(0)
      expect(seal.violations()).toEqual([])
    } finally {
      await context.close()
    }
  })
}

const SALES = CASES[0]!
const ANALYST = CASES.find((c) => c.role === 'credit_analyst')!

test('an empty list is explained, never highlighted empty', async ({ browser }) => {
  const context = await browser.newContext()
  try {
    const { page } = await open(context, ANALYST, 'en', {})
    await expect(dialog(page)).toBeVisible({ timeout: 30_000 })
    for (let i = 0; i < 12 && (await settledStep(page)) !== 'ratings'; i++)
      await dialog(page).getByRole('button', { name: text('en', 'tour.ui.next'), exact: true }).click()
    expect(await settledStep(page)).toBe('ratings')
    await expect(dialog(page).locator('[data-tour-no-data]')).toContainText(text('en', 'tour.ui.noData'))
    await expect(page.locator('[data-tour-highlight]')).toHaveCount(0)
  } finally {
    await context.close()
  }
})

test('Esc ends the tour and records it skipped; the keyboard drives it', async ({ browser }) => {
  const context = await browser.newContext()
  try {
    const { page, writes } = await open(context, SALES, 'en', {})
    expect(await settledStep(page)).toBe('welcome')
    // Focus is on the card; Tab stays inside it.
    await expect(dialog(page)).toBeFocused()
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab')
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true)
    }
    await dialog(page).focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => settledStep(page)).toBe('workspace')
    await page.keyboard.press('Enter')
    await expect.poll(() => settledStep(page)).toBe('sidebar')
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => settledStep(page)).toBe('workspace')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('tour')).toHaveCount(0)
    await expect.poll(() => writes.join('\n')).toContain('"sales":{"status":"skipped","last_step":1')
  } finally {
    await context.close()
  }
})

test('«Take the tour» in the user menu and the tci:tour:start event start it again', async ({ browser }) => {
  const context = await browser.newContext()
  try {
    const { page } = await open(context, SALES, 'ru', undefined)
    await page.waitForLoadState('networkidle')
    await expect(page.getByTestId('tour')).toHaveCount(0)
    await page.locator('[data-tour="user-menu"] > button').click()
    await page.getByRole('menuitem', { name: text('ru', 'tour.ui.takeTour') }).click()
    await expect(dialog(page)).toContainText(text('ru', 'tour.shared.welcome.title'))
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('tour')).toHaveCount(0)
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('tci:tour:start')))
    await expect(dialog(page)).toContainText(text('ru', 'tour.shared.welcome.title'))
  } finally {
    await context.close()
  }
})

test('a «What’s new» tour reaches someone who was here before it, once', async ({ browser }) => {
  const context = await browser.newContext()
  try {
    const veteran = { sales: { status: 'completed', last_step: 12, at: '2026-10-01T08:00:00.000Z' } }
    const { page, writes } = await open(context, SALES, 'uz', veteran)
    await expect(dialog(page)).toContainText(text('uz', 'tour.release202611.intro.title'))
    await walk(page, 'uz')
    await expect.poll(() => writes.join('\n')).toContain('"release:2026.11":{"status":"completed"')
  } finally {
    await context.close()
  }
})

test('the overlay is fixed: nothing under it moves', async ({ browser }) => {
  const context = await browser.newContext()
  try {
    const { page } = await open(context, SALES, 'en', undefined)
    await page.waitForLoadState('networkidle')
    const boxes = () =>
      page.evaluate(() =>
        ['header', '#app-sidebar', 'main'].map((sel) => {
          const r = document.querySelector(sel)!.getBoundingClientRect()
          return [r.x, r.y, r.width, r.height].map((v) => Math.round(v))
        }),
      )
    const before = await boxes()
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('tci:tour:start')))
    await settledStep(page)
    expect(await page.getByTestId('tour').evaluate((el) => getComputedStyle(el).position)).toBe('fixed')
    expect(await boxes()).toEqual(before)
    await dialog(page).getByRole('button', { name: text('en', 'tour.ui.next'), exact: true }).click()
    await settledStep(page)
    expect(await boxes()).toEqual(before)
  } finally {
    await context.close()
  }
})
