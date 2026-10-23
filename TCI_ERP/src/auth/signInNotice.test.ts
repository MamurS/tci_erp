/**
 * The failed-sign-in notice (migration 0062): what the banner reads, and the
 * database rules it depends on, locked to the migration text.
 */
import { describe, expect, it } from 'vitest'

import M62 from '../../supabase/migrations/0062_sign_in_notice.sql?raw'
import SIGN_IN_NOTICE from './SignInNotice.tsx?raw'
import { describeUserAgent, parseFailedSignIns, parseSignInNotice } from './signInNotice'

describe('parseSignInNotice', () => {
  it('nothing to say for zero, null or junk', () => {
    expect(parseSignInNotice(null).count).toBe(0)
    expect(parseSignInNotice({ failed_since_previous_sign_in: 0 }).count).toBe(0)
    expect(parseSignInNotice({ failed_since_previous_sign_in: 'x' }).count).toBe(0)
    expect(parseSignInNotice('11').count).toBe(0)
  })

  it('reads the count and the time range', () => {
    expect(
      parseSignInNotice({
        failed_since_previous_sign_in: 3,
        first_failed_at: '2026-10-22T08:59:43Z',
        last_failed_at: '2026-10-22T16:42:04Z',
      }),
    ).toEqual({ count: 3, firstAt: '2026-10-22T08:59:43Z', lastAt: '2026-10-22T16:42:04Z' })
  })
})

describe('parseFailedSignIns', () => {
  it('keeps rows with a time, maps empty values to null', () => {
    expect(
      parseFailedSignIns([
        { at: '2026-10-22T16:42:04Z', ip_masked: '144.124.192.0/24', user_agent: 'Mozilla/5.0' },
        { at: '2026-10-22T16:37:56Z', ip_masked: '', user_agent: null },
        { ip_masked: 'no time' },
      ]),
    ).toEqual([
      { at: '2026-10-22T16:42:04Z', ipMasked: '144.124.192.0/24', userAgent: 'Mozilla/5.0' },
      { at: '2026-10-22T16:37:56Z', ipMasked: null, userAgent: null },
    ])
    expect(parseFailedSignIns(null)).toEqual([])
  })
})

describe('describeUserAgent', () => {
  it('names the browser and the system a person recognises', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome/141 · macOS')
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      ),
    ).toBe('Edge/141 · Windows NT')
    expect(
      describeUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'),
    ).toBe('Firefox/131 · Linux')
    expect(describeUserAgent(null)).toBeNull()
  })
})

describe('the anchor and the acknowledgement (0062)', () => {
  it('the app records its own sign-in before it asks what to report', () => {
    expect(M62).toContain('create function tci.record_sign_in()')
    // only the caller's own fresh ticket, from the same network
    expect(M62).toContain('and ip_hash is not distinct from tci.request_ip_hash()')
    expect(M62).toContain('and expires_at > clock_timestamp()')
    expect(M62).toContain(
      "update tci.login_attempts set status = 'succeeded', resolved_at = now() where id = v_ticket.id;",
    )
    // the banner calls it first, then reads the notice
    const record = SIGN_IN_NOTICE.indexOf("rpc('record_sign_in')")
    const read = SIGN_IN_NOTICE.indexOf("rpc('my_sign_in_notice')")
    expect(record).toBeGreaterThan(0)
    expect(read).toBeGreaterThan(record)
  })

  it('counts only after BOTH the previous sign-in and the acknowledgement', () => {
    expect(M62).toContain(
      "and a.at > greatest(coalesce((select at from successes where rn = 2), '-infinity'::timestamptz),",
    )
    expect(M62).toContain("coalesce(me.ack, '-infinity'::timestamptz))")
  })

  it('dismissing and changing the password both write the server-side watermark', () => {
    expect(M62).toContain('create function tci.acknowledge_sign_in_failures()')
    expect(M62).toContain('sign_in_ack_at = clock_timestamp()')
    expect(SIGN_IN_NOTICE).toContain("rpc('acknowledge_sign_in_failures')")
    // never a browser-storage acknowledgement
    expect(SIGN_IN_NOTICE).not.toMatch(/localStorage|sessionStorage/)
  })
})
