/**
 * The failed-sign-in notice, as data (migration 0062). Pure, so the rules the
 * banner relies on are tested without a DOM.
 *
 * The database decides what counts: tickets of the user's e-mail that never
 * became a success, after BOTH the previous successful sign-in and the
 * user's acknowledgement watermark, and before this sign-in. The page only
 * reads it — and first records its own sign-in (`record_sign_in`), because
 * on a project without the access-token hook nothing else marks the ticket
 * of a successful sign-in as one.
 */

export interface SignInNotice {
  /** Wrong passwords (attempts that may have reached the password check). */
  count: number
  firstAt: string | null
  lastAt: string | null
  /** Attempts the browser reported as stopped before the password check
   * (0064: captcha, rate limit, network) — listed apart, never hidden. */
  interrupted: number
}

export interface FailedSignIn {
  at: string
  ipMasked: string | null
  userAgent: string | null
}

export type InterruptionReason = 'captcha' | 'rate_limited' | 'network'
export const INTERRUPTION_REASONS: readonly InterruptionReason[] = ['captcha', 'rate_limited', 'network']

export interface InterruptedSignIn extends FailedSignIn {
  reason: InterruptionReason
}

const NONE: SignInNotice = { count: 0, firstAt: null, lastAt: null, interrupted: 0 }

/** `tci.my_sign_in_notice()` → the banner's data; anything malformed is "nothing to say". */
export function parseSignInNotice(raw: unknown): SignInNotice {
  if (!raw || typeof raw !== 'object') return NONE
  const r = raw as Record<string, unknown>
  const whole = (v: unknown) => {
    const n = Number(v ?? 0)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  }
  const count = whole(r.failed_since_previous_sign_in)
  const interrupted = whole(r.interrupted_since_previous_sign_in)
  if (count === 0 && interrupted === 0) return NONE
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return {
    count,
    firstAt: count > 0 ? str(r.first_failed_at) : null,
    lastAt: count > 0 ? str(r.last_failed_at) : null,
    interrupted,
  }
}

/** `tci.my_interrupted_sign_ins()` rows, newest first; unknown reasons dropped. */
export function parseInterruptedSignIns(raw: unknown): InterruptedSignIn[] {
  if (!Array.isArray(raw)) return []
  const out: InterruptedSignIn[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const row = r as Record<string, unknown>
    const reason = row.reason
    if (typeof reason !== 'string' || !(INTERRUPTION_REASONS as readonly string[]).includes(reason)) continue
    const [parsed] = parseFailedSignIns([row])
    if (parsed) out.push({ ...parsed, reason: reason as InterruptionReason })
  }
  return out
}

/** `tci.my_failed_sign_ins()` rows, newest first. */
export function parseFailedSignIns(raw: unknown): FailedSignIn[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (r): r is Record<string, unknown> =>
        Boolean(r) && typeof r === 'object' && typeof r.at === 'string',
    )
    .map((r) => ({
      at: r.at as string,
      ipMasked: typeof r.ip_masked === 'string' && r.ip_masked ? r.ip_masked : null,
      userAgent: typeof r.user_agent === 'string' && r.user_agent ? r.user_agent : null,
    }))
}

/** A user agent shortened to what a person recognises: browser and system. */
export function describeUserAgent(ua: string | null): string | null {
  if (!ua) return null
  const browser =
    /Edg\/\d+/.exec(ua)?.[0]?.replace('Edg', 'Edge') ??
    /Firefox\/\d+/.exec(ua)?.[0] ??
    /OPR\/\d+/.exec(ua)?.[0]?.replace('OPR', 'Opera') ??
    /Chrome\/\d+/.exec(ua)?.[0] ??
    (/Version\/[\d.]+ .*Safari/.test(ua) ? 'Safari' : null)
  const system =
    /Windows NT|Mac OS X|Android|iPhone|iPad|Linux/.exec(ua)?.[0]?.replace('Mac OS X', 'macOS') ??
    null
  const parts = [browser, system].filter(Boolean)
  return parts.length ? parts.join(' · ') : ua.slice(0, 60)
}
