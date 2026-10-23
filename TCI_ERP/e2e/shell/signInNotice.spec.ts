/**
 * The after-sign-in notice (0062, 0064): wrong passwords and attempts the
 * browser reported as interrupted (anti-bot check, rate limit, network) are
 * shown apart — the interruptions on their own line and in their own table,
 * never as wrong passwords. Network sealed; the notice RPCs are answered here.
 */

import { expect, test } from '@playwright/test'

import { loadFixture, replay } from '../layout/fixtures'
import { sealNetwork } from '../support/network'
import { stubBackend } from '../support/stub'
import type { StubReply, StubRequest } from '../support/stub'

test.use({ viewport: { width: 1440, height: 900 } })

function noticeAnswers(notice: Record<string, unknown>) {
  return (request: StubRequest): StubReply | undefined => {
    if (!request.rpc) return undefined
    switch (request.resource) {
      case 'record_sign_in':
        return { json: { recorded: false } }
      case 'my_sign_in_notice':
        return { json: notice }
      case 'my_failed_sign_ins':
        return { json: [{ at: '2026-10-23T08:10:00Z', ip_masked: '203.0.113.0/24', user_agent: 'Mozilla/5.0 Firefox/131.0' }] }
      case 'my_interrupted_sign_ins':
        return {
          json: [
            { at: '2026-10-23T08:20:00Z', ip_masked: '198.51.100.0/24', user_agent: null, reason: 'captcha' },
            { at: '2026-10-23T08:15:00Z', ip_masked: '198.51.100.0/24', user_agent: null, reason: 'network' },
          ],
        }
      default:
        return undefined
    }
  }
}

test('interruptions are listed apart from wrong passwords', async ({ browser }) => {
  const fixture = loadFixture('credit')
  test.skip(!fixture, 'no fixtures recorded')
  const context = await browser.newContext()
  const seal = await sealNetwork(context)
  const answer = noticeAnswers({
    failed_since_previous_sign_in: 1,
    first_failed_at: '2026-10-23T08:10:00Z',
    last_failed_at: '2026-10-23T08:10:00Z',
    interrupted_since_previous_sign_in: 2,
  })
  const recorded = replay(fixture!)
  await stubBackend(context, {
    lang: 'ru',
    user: fixture!.user,
    sessionId: '00000000-0000-4000-8000-0000000064aa',
    respond: (r) => answer(r) ?? recorded(r),
    sidebar: 'open',
  })
  const page = await context.newPage()
  try {
    await page.goto('/agenda')
    const notice = page.getByRole('alert').filter({ hasText: 'Неудачные попытки входа' })
    await expect(notice).toBeVisible({ timeout: 15_000 })
    await expect(notice).toContainText('была 1 неудачная попытка')
    await expect(notice).toContainText('2 попытки прервались до проверки пароля')

    await notice.getByRole('button', { name: 'Показать попытки' }).click()
    await expect(notice.getByRole('table')).toHaveCount(2)
    const interrupted = notice.getByRole('table').filter({ hasText: 'Прервано до проверки пароля' })
    await expect(interrupted.getByRole('row')).toHaveCount(3) // header + 2
    await expect(interrupted).toContainText('Проверка «не робот»')
    await expect(interrupted).toContainText('Ошибка сети')
    expect(seal.violations()).toEqual([])
  } finally {
    await context.close()
  }
})

test('with interruptions only, the notice says so and calls none of them a wrong password', async ({ browser }) => {
  const fixture = loadFixture('credit')
  test.skip(!fixture, 'no fixtures recorded')
  const context = await browser.newContext()
  const seal = await sealNetwork(context)
  const answer = noticeAnswers({ failed_since_previous_sign_in: 0, interrupted_since_previous_sign_in: 1 })
  const recorded = replay(fixture!)
  await stubBackend(context, {
    lang: 'en',
    user: fixture!.user,
    sessionId: '00000000-0000-4000-8000-0000000064ab',
    respond: (r) => answer(r) ?? recorded(r),
    sidebar: 'open',
  })
  const page = await context.newPage()
  try {
    await page.goto('/agenda')
    const notice = page.getByRole('alert').filter({ hasText: 'Interrupted sign-in attempts on your account' })
    await expect(notice).toBeVisible({ timeout: 15_000 })
    await expect(notice).toContainText('1 attempt stopped before the password was checked')
    await expect(notice).not.toContainText('failed attempt')
    expect(seal.violations()).toEqual([])
  } finally {
    await context.close()
  }
})
