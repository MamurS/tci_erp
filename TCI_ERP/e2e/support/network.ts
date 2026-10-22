/**
 * No real network from a browser test. The app is served from localhost and
 * every Supabase call is answered by the stub (stub.ts); this seals the rest:
 *
 * - any request to a host other than localhost that no stub route answered
 *   is ABORTED here — never continued, never fetched — and remembered;
 * - any response that came from a host other than localhost or the stub, and
 *   any WebSocket to a host other than localhost, is remembered too.
 *
 * Call it BEFORE stubBackend: Playwright tries the most recently registered
 * route first, so the stub's routes win and this one only sees what they do
 * not cover. `violations()` lists what was attempted; a test asserts it empty.
 */

import type { BrowserContext } from '@playwright/test'

import { STUB_URL } from './stub'

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])
const STUB_HOST = new URL(STUB_URL).hostname

export interface NetworkSeal {
  /** Every request that tried to leave the machine (aborted), and anything
   * that answered from outside it. Empty when the test stayed sealed. */
  violations: () => string[]
}

export async function sealNetwork(context: BrowserContext): Promise<NetworkSeal> {
  const seen: string[] = []
  await context.route(
    (url) => !LOCAL.has(url.hostname),
    async (route) => {
      const request = route.request()
      seen.push(`blocked ${request.method()} ${request.url().slice(0, 160)}`)
      await route.abort('blockedbyclient')
    },
  )
  context.on('response', (response) => {
    const host = new URL(response.url()).hostname
    if (!LOCAL.has(host) && host !== STUB_HOST) seen.push(`answered from ${host}: ${response.url().slice(0, 160)}`)
  })
  context.on('page', (page) => {
    // The dev server's own hot-reload socket is local; any other is not.
    page.on('websocket', (socket) => {
      if (!LOCAL.has(new URL(socket.url()).hostname)) seen.push(`websocket ${socket.url().slice(0, 160)}`)
    })
  })
  return { violations: () => [...new Set(seen)] }
}
