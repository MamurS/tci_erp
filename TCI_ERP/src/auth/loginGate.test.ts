import { describe, expect, it } from 'vitest'

import MIGRATION from '../../supabase/migrations/0046_login_gate.sql?raw'
import {
  LOGIN_BASE_LOCK_SECONDS,
  LOGIN_FREE_ATTEMPTS,
  LOGIN_MAX_LOCK_SECONDS,
  attemptsLeft,
  formatCountdown,
  lockSeconds,
  interruptionReason,
  parseLoginBegin,
} from './loginGate'
import M64 from '../../supabase/migrations/0064_sign_in_interruptions.sql?raw'
import AUTH_CONTEXT from './AuthContext.tsx?raw'

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
      ticket: null,
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

describe('the attempt ticket and the interruption label (0064)', () => {
  const ticket = 'a'.repeat(64)

  it('keeps a well-formed ticket and nothing else', () => {
    expect(parseLoginBegin({ allowed: true, failures: 0, ticket }).ticket).toBe(ticket)
    expect(parseLoginBegin({ allowed: true, failures: 0, ticket: 'short' }).ticket).toBeNull()
    expect(parseLoginBegin({ allowed: false, retry_after_seconds: 5, ticket }).ticket).toBeNull()
    // the database hands out 64 hex characters
    expect(M64).toContain("v_ticket   text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');")
    expect(M64).toContain("return jsonb_build_object('allowed', true, 'failures', v_failures, 'ticket', v_ticket);")
  })

  it('labels only what never reached the password check', () => {
    expect(interruptionReason('captcha')).toBe('captcha')
    expect(interruptionReason('rateLimited')).toBe('rate_limited')
    expect(interruptionReason('network')).toBe('network')
    for (const kind of ['invalidCredentials', 'locked', 'userBanned', 'emailNotConfirmed', 'generic', 'throttled']) {
      expect(interruptionReason(kind), kind).toBeNull()
    }
  })

  it('the sign-in reports it with the attempt\'s own ticket', () => {
    expect(AUTH_CONTEXT).toContain("rpc('login_interrupted', { p_ticket: gate.ticket, p_reason: reason })")
    expect(M64).toContain('create function tci.login_interrupted(p_ticket text, p_reason text)')
  })
})

