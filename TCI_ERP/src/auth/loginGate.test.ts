import { describe, expect, it } from 'vitest'

import MIGRATION from '../../supabase/migrations/0046_login_gate.sql?raw'
import {
  LOGIN_BASE_LOCK_SECONDS,
  LOGIN_FREE_ATTEMPTS,
  LOGIN_MAX_LOCK_SECONDS,
  attemptsLeft,
  formatCountdown,
  lockSeconds,
  parseLoginBegin,
} from './loginGate'

describe('the schedule mirrors migration 0046', () => {
  it('uses the same defaults', () => {
    expect(MIGRATION).toContain(
      `add column login_free_attempts     integer not null default ${LOGIN_FREE_ATTEMPTS}`,
    )
    expect(MIGRATION).toContain(
      `add column login_base_lock_seconds integer not null default ${LOGIN_BASE_LOCK_SECONDS}`,
    )
    expect(MIGRATION).toContain(
      `add column login_max_lock_seconds  integer not null default ${LOGIN_MAX_LOCK_SECONDS}`,
    )
  })

  it('doubles from 30 s after the third failure, capped at an hour', () => {
    expect(MIGRATION).toContain('least(p_max, (p_base * power(2, least(p_failures - p_free, 20)))::int)')
    expect([2, 3, 4, 5, 9, 10, 50].map((f) => lockSeconds(f))).toEqual([0, 30, 60, 120, 1920, 3600, 3600])
  })
})

describe('parseLoginBegin', () => {
  it('reads both answers', () => {
    expect(parseLoginBegin({ allowed: true, failures: 2 })).toEqual({
      allowed: true,
      failures: 2,
      retryAfterSeconds: null,
    })
    expect(parseLoginBegin({ allowed: false, retry_after_seconds: 44.2 })).toMatchObject({
      allowed: false,
      retryAfterSeconds: 45,
    })
  })

  it('never treats a malformed answer as permission', () => {
    expect(parseLoginBegin(null).allowed).toBe(false)
    expect(parseLoginBegin({ allowed: 'yes' }).allowed).toBe(false)
  })
})

describe('helpers', () => {
  it('counts the tries left and formats the countdown', () => {
    expect(attemptsLeft(0)).toBe(2)
    expect(attemptsLeft(1)).toBe(1)
    expect(attemptsLeft(2)).toBe(0)
    expect(formatCountdown(45)).toBe('00:45')
    expect(formatCountdown(754)).toBe('12:34')
    expect(formatCountdown(0)).toBe('00:00')
  })
})
