/**
 * A signed-in browser with no backend: the app is built against
 * https://stub.supabase.co (playwright.config.ts) and every Supabase call is
 * answered here, so an e2e test needs no credentials and no network and can
 * never write anything anywhere.
 *
 * Reads answer with an empty list (or null for a single row) unless a test
 * passes rows for a resource; writes answer with an empty success.
 */

import type { BrowserContext } from '@playwright/test'

export const STUB_URL = 'https://stub.supabase.co'
const STORAGE_KEY = 'sb-stub-auth-token'

export const STUB_USER_ID = '00000000-0000-4000-8000-000000000001'

export type Lang = 'en' | 'ru' | 'uz'
export const LANGS: readonly Lang[] = ['en', 'ru', 'uz']

export interface StubOptions {
  lang?: Lang
  roles?: readonly string[]
  /** localStorage 'tci-erp-sidebar': 'open' (pinned) or 'closed'. */
  sidebar?: 'open' | 'closed'
  /** Rows per REST resource name (table, view or rpc), e.g. { legal_entities: [...] }. */
  rows?: Record<string, unknown>
  /** The signed-in user; a stub id and e2e.user@demo.invalid by default. */
  user?: { id: string; email: string }
  /** false: no session is seeded, so the app starts signed out (/login). */
  signedIn?: boolean
  /** Answers a REST call before `rows` and the defaults (undefined: fall
   * through) — e.g. replaying recorded fixtures (e2e/layout/fixtures.ts). */
  respond?: (request: StubRequest) => StubReply | undefined
}

/** A REST call as the stub sees it. */
export interface StubRequest {
  method: string
  /** Table, view or rpc name, without /rest/v1/ and rpc/. */
  resource: string
  rpc: boolean
  url: URL
  /** The request wants one object (Accept: application/vnd.pgrst.object). */
  single: boolean
  body: string | null
}

export interface StubReply {
  status?: number
  json: unknown
  headers?: Record<string, string>
}

function fakeSession(id = STUB_USER_ID, email = 'e2e.user@demo.invalid') {
  const now = Math.floor(Date.now() / 1000)
  const user = {
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    app_metadata: { provider: 'email' },
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  }
  return {
    access_token: 'stub-access-token',
    refresh_token: 'stub-refresh-token',
    token_type: 'bearer',
    expires_in: 3600 * 24 * 365,
    expires_at: now + 3600 * 24 * 365,
    user,
  }
}

export async function stubBackend(context: BrowserContext, options: StubOptions = {}): Promise<void> {
  const {
    lang = 'ru',
    roles = ['commercial_underwriter'],
    sidebar = 'open',
    rows = {},
    user,
    respond,
    signedIn = true,
  } = options
  const session = fakeSession(user?.id, user?.email)

  await context.addInitScript(
    ([key, value, language, side]) => {
      // Only on the first load of the test: a test that toggles the sidebar
      // and reloads must see what it chose.
      if (sessionStorage.getItem('e2e-seeded')) return
      sessionStorage.setItem('e2e-seeded', '1')
      if (value) localStorage.setItem(key, value)
      localStorage.setItem('i18nextLng', language)
      localStorage.setItem('tci-erp-lang', language)
      localStorage.setItem('tci-erp-sidebar', side)
    },
    [STORAGE_KEY, signedIn ? JSON.stringify(session) : '', lang, sidebar] as const,
  )

  await context.route(`${STUB_URL}/auth/v1/**`, async (route) => {
    const url = route.request().url()
    if (url.includes('/user')) return route.fulfill({ json: session.user })
    if (url.includes('/factors') || url.includes('/logout')) return route.fulfill({ json: {} })
    return route.fulfill({ json: session })
  })

  await context.route(`${STUB_URL}/storage/v1/**`, (route) => route.fulfill({ json: [] }))

  await context.route(`${STUB_URL}/rest/v1/**`, async (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())
    const resource = pathname.replace(/^\/rest\/v1\/(rpc\/)?/, '')
    const single = (request.headers()['accept'] ?? '').includes('vnd.pgrst.object')

    const reply = respond?.({
      method: request.method(),
      resource,
      rpc: pathname.includes('/rpc/'),
      url: new URL(request.url()),
      single,
      body: request.postData(),
    })
    if (reply) return route.fulfill({ status: reply.status ?? 200, json: reply.json, headers: reply.headers })

    if (request.method() !== 'GET' && !pathname.includes('/rpc/')) {
      return route.fulfill({ status: 201, json: single ? {} : [] })
    }
    let body: unknown = resource in rows ? rows[resource] : resource === 'user_roles' ? roles.map((role) => ({ role })) : []
    if (single) body = Array.isArray(body) ? (body[0] ?? null) : body
    return route.fulfill({ json: body })
  })
}
