/**
 * The sign-in gate as the login page sees it — pure module.
 *
 * Every sign-in starts with tci.login_begin(email) (migration 0046), which
 * either refuses with `retry_after_seconds` or records an attempt that
 * counts as a failure until a real success refunds it. The schedule below
 * MIRRORS tci.login_lock_seconds and the workflow_settings defaults; it is
 * only used to tell the person how many tries they have before the first
 * wait. The database decides; loginGate.test.ts locks the mirror to the
 * migration text.
 */

export const LOGIN_FREE_ATTEMPTS = 3
export const LOGIN_BASE_LOCK_SECONDS = 30
export const LOGIN_MAX_LOCK_SECONDS = 3600

/** Mirror of tci.login_lock_seconds: the wait after `failures` failures. */
export function lockSeconds(
  failures: number,
  free = LOGIN_FREE_ATTEMPTS,
  base = LOGIN_BASE_LOCK_SECONDS,
  max = LOGIN_MAX_LOCK_SECONDS,
): number {
  if (failures < free) return 0
  return Math.min(max, base * 2 ** Math.min(failures - free, 20))
}

export interface LoginBeginResult {
  allowed: boolean
  /** Failures already counted for this email from this network. */
  failures: number
  /** Present when refused. */
  retryAfterSeconds: number | null
}

/** Defensive parse of the RPC answer; anything unexpected means "go ahead"
 * is NOT assumed — a malformed answer refuses for a short moment. */
export function parseLoginBegin(raw: unknown): LoginBeginResult {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    if (r.allowed === true) {
      return { allowed: true, failures: Number(r.failures) || 0, retryAfterSeconds: null }
    }
    if (r.allowed === false) {
      const s = Number(r.retry_after_seconds)
      return { allowed: false, failures: 0, retryAfterSeconds: Number.isFinite(s) && s > 0 ? Math.ceil(s) : 30 }
    }
  }
  return { allowed: false, failures: 0, retryAfterSeconds: 5 }
}

/** Tries left before the first wait, after this attempt failed. */
export function attemptsLeft(failuresBefore: number, free = LOGIN_FREE_ATTEMPTS): number {
  return Math.max(0, free - (failuresBefore + 1))
}

/** 45 → "00:45", 754 → "12:34", 3600 → "60:00". */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds))
  const m = Math.floor(s / 60)
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
