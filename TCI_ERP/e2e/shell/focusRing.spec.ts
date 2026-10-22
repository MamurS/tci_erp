/**
 * Focus rings show for KEYBOARD focus only (src/lib/focusSource.ts,
 * index.css). Chrome lights `:focus-visible` on a mouse-clicked button as
 * soon as a key is pressed while it keeps the focus — on the Agenda that is
 * every J/K/T shortcut — so the check is: a segment clicked with the mouse
 * shows no ring, not even after a key; reached with Tab, it does. Run on the
 * Agenda's List | Triage switch (the solid Segmented) and on the chip bar,
 * with the credit demo board and the network sealed.
 */

import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { loadFixture, replay } from '../layout/fixtures'
import { sealNetwork } from '../support/network'
import { stubBackend } from '../support/stub'

test.use({ viewport: { width: 1440, height: 900 } })

/** A ring (box-shadow of 2px or more) or an outline is drawn. */
async function ringed(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el)
    const ring = /0px 0px 0px [1-9]\d*(\.\d+)?px/.test(s.boxShadow.replace(/rgba\(0, 0, 0, 0\)[^,]*(,|$)/g, ''))
    return ring || (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0)
  })
}

test('a segment clicked with the mouse shows no focus ring, even after a key; reached with Tab it does', async ({
  browser,
}) => {
  const fixture = loadFixture('credit')
  test.skip(!fixture, 'no fixtures recorded')
  const context = await browser.newContext()
  const seal = await sealNetwork(context)
  await stubBackend(context, { lang: 'ru', user: fixture!.user, respond: replay(fixture!), sidebar: 'open' })
  const page = await context.newPage()
  try {
    await page.goto('/agenda')
    await page.waitForLoadState('networkidle').catch(() => undefined)
    const segments = page.locator('main [role="group"] button')
    const triage = segments.nth(1)

    await triage.click()
    await expect(triage).toBeFocused()
    expect(await ringed(triage), 'after a mouse click').toBe(false)
    // The Agenda's J moves the triage selection; the focus stays on the segment.
    await page.keyboard.press('j')
    await expect(triage).toBeFocused()
    expect(await ringed(triage), 'after a mouse click and a key that does not move the focus').toBe(false)

    // Tab away and back: keyboard focus shows the ring.
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(triage).toBeFocused()
    expect(await ringed(triage), 'reached with Tab').toBe(true)

    // A chip (toggle button) behaves the same.
    const chip = page.locator('main [role="toolbar"] button').first()
    await chip.click()
    await expect(chip).toBeFocused()
    expect(await ringed(chip), 'chip after a mouse click').toBe(false)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(chip).toBeFocused()
    expect(await ringed(chip), 'chip reached with the keyboard').toBe(true)

    expect(seal.violations()).toEqual([])
  } finally {
    await context.close()
  }
})
