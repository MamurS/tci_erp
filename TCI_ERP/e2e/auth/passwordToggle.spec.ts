/**
 * «Показать пароль» on the sign-in page (PasswordInput): the eye inside the
 * field shows and hides the password by mouse and by keyboard, says what it
 * will do in the page's language, never submits the form, and moves nothing
 * — the field keeps its exact box in both states.
 *
 * Signed out (no session seeded), network sealed: nothing leaves the machine
 * and no sign-in request is ever made.
 */

import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { sealNetwork } from '../support/network'
import { LANGS, stubBackend } from '../support/stub'

const labelsOf = (lang: string): { field: string; show: string; hide: string; caps: string } => {
  const auth = (
    JSON.parse(readFileSync(`src/i18n/locales/${lang}.json`, 'utf8')) as {
      auth: { password: string; showPassword: string; hidePassword: string; capsLockOn: string }
    }
  ).auth
  return {
    field: auth.password,
    show: auth.showPassword,
    hide: auth.hidePassword,
    caps: auth.capsLockOn,
  }
}

/** A key event in the field as the browser reports it with Caps Lock on or
 * off — Playwright's keyboard cannot latch Caps Lock itself. */
async function keyInField(page: Page, capsLock: boolean) {
  await field(page).evaluate((el, on) => {
    for (const type of ['keydown', 'keyup'])
      el.dispatchEvent(
        new KeyboardEvent(type, {
          key: 'A',
          bubbles: true,
          modifierCapsLock: on,
        } as KeyboardEventInit),
      )
  }, capsLock)
}

const field = (page: Page) => page.locator('input[autocomplete="current-password"]')

async function toggleOf(page: Page): Promise<Locator> {
  const id = await field(page).getAttribute('id')
  expect(id, 'the password input has an id for aria-controls').toBeTruthy()
  return page.locator(`button[aria-controls="${id}"]`)
}

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  expect(b, 'element is on screen').not.toBeNull()
  return b!
}

function expectSameBox(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  for (const k of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(a[k] - b[k])).toBeLessThanOrEqual(0.5)
}

for (const lang of LANGS) {
  test(`sign-in password toggle (${lang})`, async ({ page, context }) => {
    const seal = await sealNetwork(context)
    await stubBackend(context, { lang, signedIn: false })
    const signInCalls: string[] = []
    page.on('request', (r) => {
      if (/\/auth\/v1\/token|\/rpc\/login_begin/.test(r.url())) signInCalls.push(r.url())
    })
    const { field: name, show, hide } = labelsOf(lang)

    await page.goto('/login')
    await expect(field(page)).toBeVisible()
    const toggle = await toggleOf(page)

    // Hidden at first; the toggle is a plain button that offers to show.
    await expect(field(page)).toHaveAttribute('type', 'password')
    await expect(toggle).toHaveAttribute('type', 'button')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(toggle).toHaveAttribute('aria-label', show)
    await expect(toggle).toHaveAttribute('title', show)
    await expect(toggle).toHaveAccessibleName(show)
    // The field is named by its caption alone, not «caption + the eye's label».
    await expect(field(page)).toHaveAccessibleName(name)

    await field(page).fill('Secret-Pass-123')
    const hiddenBox = await box(field(page))
    const toggleBox = await box(toggle)
    const submitBox = await box(page.locator('form button[type="submit"]'))

    // The text never runs under the icon.
    const paddingRight = await field(page).evaluate((el) =>
      parseFloat(getComputedStyle(el).paddingRight),
    )
    expect(hiddenBox.x + hiddenBox.width - toggleBox.x).toBeLessThanOrEqual(paddingRight)

    // Mouse: show…
    await toggle.click()
    await expect(field(page)).toHaveAttribute('type', 'text')
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(toggle).toHaveAttribute('aria-label', hide)
    await expect(toggle).toHaveAttribute('title', hide)
    await expect(field(page)).toHaveAccessibleName(name)
    await expect(field(page)).toHaveValue('Secret-Pass-123')
    expectSameBox(await box(field(page)), hiddenBox)
    expectSameBox(await box(toggle), toggleBox)
    expectSameBox(await box(page.locator('form button[type="submit"]')), submitBox)

    // …and hide.
    await toggle.click()
    await expect(field(page)).toHaveAttribute('type', 'password')
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect(toggle).toHaveAttribute('aria-label', show)
    expectSameBox(await box(field(page)), hiddenBox)

    // Keyboard: Tab from the field lands on the toggle; Enter and Space work.
    await field(page).focus()
    await page.keyboard.press('Tab')
    await expect(toggle).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(field(page)).toHaveAttribute('type', 'text')
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expectSameBox(await box(field(page)), hiddenBox)
    await page.keyboard.press('Space')
    await expect(field(page)).toHaveAttribute('type', 'password')

    // Nothing was submitted: still on the sign-in page, no sign-in call.
    await expect(page).toHaveURL(/\/login$/)
    expect(signInCalls).toEqual([])
    expect(seal.violations()).toEqual([])
  })
}

for (const lang of LANGS) {
  test(`sign-in Caps Lock hint and Enter submits (${lang})`, async ({ page, context }) => {
    const seal = await sealNetwork(context)
    await stubBackend(context, { lang, signedIn: false })
    const signInCalls: string[] = []
    page.on('request', (r) => {
      if (/\/auth\/v1\/token|\/rpc\/login_begin/.test(r.url())) signInCalls.push(r.url())
    })
    const { caps } = labelsOf(lang)

    await page.goto('/login')
    await expect(field(page)).toBeVisible()
    const hint = page.locator(`[id="${await field(page).getAttribute('id')}-caps"]`)
    const fieldBox = await box(field(page))
    const submitBox = await box(page.locator('form button[type="submit"]'))

    // Caps Lock on while typing in the field: the quiet hint, nothing moves.
    await field(page).focus()
    await keyInField(page, true)
    await expect(hint).toHaveText(caps)
    await expect(field(page)).toHaveAttribute('aria-describedby', new RegExp(`-caps$`))
    expectSameBox(await box(field(page)), fieldBox)
    expectSameBox(await box(page.locator('form button[type="submit"]')), submitBox)

    // Caps Lock off, or the field left: the hint goes, nothing moves.
    await keyInField(page, false)
    await expect(hint).toHaveText('')
    await keyInField(page, true)
    await expect(hint).toHaveText(caps)
    await page.locator('input[autocomplete="email"]').focus()
    await expect(hint).toHaveText('')
    expectSameBox(await box(page.locator('form button[type="submit"]')), submitBox)

    // Enter in the password field still submits the form (the sealed network
    // aborts the call, so nothing leaves the machine).
    await page.locator('input[autocomplete="email"]').fill('someone@demo.invalid')
    await field(page).fill('Secret-Pass-123')
    await field(page).press('Enter')
    await expect.poll(() => signInCalls.length).toBeGreaterThan(0)
    expect(seal.violations()).toEqual([])
  })
}
