/**
 * Records the layout guard's fixtures (e2e/layout/fixtures/<role>.json) from
 * the canonical project. A MANUAL tool, run by hand when the screens change
 * shape — never in CI, and deliberately NOT a Playwright test: the guard
 * itself (e2e/layout/layout.spec.ts) runs with the network sealed and never
 * reaches canonical; only this script does, and only to READ.
 *
 *   SUPABASE_ANON_KEY=… DEMO_PASSWORD=… \
 *     node --experimental-strip-types tools/layout-fixtures/record.mjs [role …]
 *
 * (PW_CHROMIUM_PATH=/path/to/chrome to use an installed Chromium.) The two
 * secrets come from the environment only and are written nowhere: the anon
 * key is the project's publishable key, the password the demo users'
 * (demo.<role>@demo.invalid).
 *
 * How: the app is served by Vite on :5175 built against stub.supabase.co, as
 * in the e2e suite. Each demo user signs in (login_begin + signInWithPassword,
 * as the sign-in page does); its GET/HEAD requests — and calls of functions
 * the migrations declare STABLE, which Postgres forbids to write — are
 * forwarded to canonical with that user's token and recorded. Every other
 * call (a write, a volatile function such as refresh_agenda, auth, storage)
 * is answered locally and never leaves the browser. Each of the user's
 * screens (e2e/layout/screens.ts) is opened and every tab in it clicked
 * through; what was read is stored sanitised — no e-mail but @demo.invalid,
 * no person's name or phone — with the list of screen variants found.
 */

import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

import { FIXTURE_DIR, requestKey, sanitiser } from '../../e2e/layout/fixtures.ts'
import { DEMO_ROLES, ROUTES } from '../../e2e/layout/screens.ts'

const CANONICAL = 'https://reunqrpeumokqgarknge.supabase.co'
const STUB_URL = 'https://stub.supabase.co'
const PORT = 5175
const BASE = `http://localhost:${PORT}`
const KEY = process.env.SUPABASE_ANON_KEY ?? ''
const PASSWORD = process.env.DEMO_PASSWORD ?? ''
const MAX_VARIANTS = 24
const APP_DIR = fileURLToPath(new URL('../../', import.meta.url))

if (!KEY || !PASSWORD) {
  console.error('SUPABASE_ANON_KEY and DEMO_PASSWORD are required')
  process.exit(2)
}
const roles = process.argv.slice(2).length ? process.argv.slice(2) : DEMO_ROLES

/** Functions the migrations declare STABLE or IMMUTABLE (the last definition wins). */
function readOnlyFunctions() {
  const dir = new URL('../../supabase/migrations/', import.meta.url)
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(new URL(f, dir), 'utf8'))
    .join('\n')
  const last = new Map()
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+tci\.(\w+)\s*\(([\s\S]*?)\bas\s+\$(\w*)\$/gi)) {
    last.set(m[1].toLowerCase(), /^\s*(stable|immutable)\b/im.test(m[2] ?? ''))
  }
  return new Set([...last].filter(([, ro]) => ro).map(([name]) => name))
}

/** A concrete id for each `:id` route of a role, chosen to show rich data. */
async function resolveIds(token, role) {
  const first = async (table, query, column = 'id') => {
    const response = await fetch(`${CANONICAL}/rest/v1/${table}?select=${column}&limit=1&${query}`, {
      headers: { apikey: KEY, authorization: `Bearer ${token}`, 'accept-profile': 'tci' },
    })
    const rows = response.ok ? await response.json() : []
    return rows[0]?.[column]
  }
  const ids = {}
  if (role === 'credit') {
    ids['/entities/:id'] = await first('credit_assessments', 'order=created_at.desc', 'entity_id')
    ids['/limits/:id'] =
      (await first('credit_limit_requests', 'status=in.(submitted,under_review,escalated)&order=submitted_at.desc')) ??
      (await first('credit_limit_requests', ''))
  }
  if (role === 'commercial') {
    ids['/policies/:id'] = (await first('policies', 'status=eq.active')) ?? (await first('policies', ''))
    ids['/declarations/:id'] = await first('declarations', 'order=period_end.desc')
    ids['/overdues/:id'] = await first('overdue_notifications', 'order=created_at.desc')
  }
  if (role === 'sales')
    ids['/requests/:id'] =
      (await first('insurance_requests', 'status=neq.draft&order=created_at.desc')) ?? (await first('insurance_requests', ''))
  if (role === 'claims') ids['/claims/:id'] = await first('claims', 'order=created_at.desc')
  if (role === 'info') ids['/data/requests/:id'] = await first('entity_requests', 'order=created_at.desc')
  return Object.fromEntries(Object.entries(ids).filter((e) => Boolean(e[1])))
}

async function settle(page) {
  await page.waitForLoadState('networkidle').catch(() => undefined)
  await page.waitForTimeout(400)
}

const here = (page) => {
  const u = new URL(page.url())
  return u.pathname + u.search
}

async function startVite() {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: APP_DIR,
    env: { ...process.env, VITE_SUPABASE_URL: STUB_URL, VITE_SUPABASE_ANON_KEY: 'stub-anon-key', VITE_ANALYTICS_API_URL: '' },
    stdio: 'ignore',
    detached: true,
  })
  const stop = () => {
    try {
      process.kill(-vite.pid)
    } catch {
      /* already gone */
    }
  }
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(BASE)).ok) return stop
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  stop()
  throw new Error(`vite did not start on :${PORT}`)
}

async function record(browser, role, readOnly) {
  const email = `demo.${role}@demo.invalid`
  const db = createClient(CANONICAL, KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  await db.schema('tci').rpc('login_begin', { p_email: email })
  const { data, error } = await db.auth.signInWithPassword({ email, password: PASSWORD })
  if (error || !data.session) throw new Error(`${email}: ${error?.message ?? 'no session'}`)
  const session = data.session
  const clean = sanitiser()
  const responses = {}

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript(
    ([value]) => {
      if (sessionStorage.getItem('rec-seeded')) return
      sessionStorage.setItem('rec-seeded', '1')
      localStorage.setItem('sb-stub-auth-token', value)
      localStorage.setItem('tci-erp-lang', 'ru')
      localStorage.setItem('i18nextLng', 'ru')
      localStorage.setItem('tci-erp-sidebar', 'open')
      window.open = () => null
    },
    [JSON.stringify(session)],
  )
  // Anything that is neither the local app nor a Supabase call goes nowhere.
  await context.route(
    (url) => url.hostname !== 'localhost',
    (route) => route.abort('blockedbyclient'),
  )
  await context.route(`${STUB_URL}/auth/v1/**`, (route) => {
    const url = route.request().url()
    return route.fulfill({ json: url.includes('/user') ? session.user : url.includes('/logout') ? {} : session })
  })
  await context.route(`${STUB_URL}/storage/v1/**`, (route) => route.fulfill({ json: [] }))
  await context.route(`${STUB_URL}/rest/v1/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const rpc = url.pathname.includes('/rpc/')
    const resource = url.pathname.replace(/^\/rest\/v1\/(rpc\/)?/, '')
    const method = request.method()
    const read = method === 'GET' || method === 'HEAD' || (rpc && method === 'POST' && readOnly.has(resource))
    if (!read) return route.fulfill({ status: rpc ? 200 : 201, json: rpc ? null : [] })
    const headers = { ...request.headers(), apikey: KEY, authorization: `Bearer ${session.access_token}` }
    delete headers.host
    const response = await route.fetch({ url: `${CANONICAL}${url.pathname}${url.search}`, headers })
    const text = method === 'HEAD' ? '' : await response.text()
    let json
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = null
    }
    const range = response.headers()['content-range']
    responses[requestKey(method, resource, rpc, url, request.postData())] = {
      status: response.status(),
      json: clean(json),
      ...(range ? { range } : {}),
    }
    return route.fulfill({ response })
  })

  const page = await context.newPage()
  const ids = await resolveIds(session.access_token, role)
  const variants = []
  const seen = new Set()
  const add = (v) => {
    const key = `${v.path}#${v.tab ? `${v.tab.list}.${v.tab.index}` : ''}`
    if (seen.has(key)) return false
    seen.add(key)
    variants.push(v)
    return true
  }

  for (const [pattern, entry] of Object.entries(ROUTES)) {
    if (entry.role !== role) continue
    const path = pattern.includes(':id') ? (ids[pattern] ? pattern.replace(':id', ids[pattern]) : null) : pattern
    if (!path) {
      console.warn(`[record ${role}] nothing to record for ${pattern}: skipped`)
      continue
    }
    const queue = [path]
    let count = 0
    while (queue.length && count < MAX_VARIANTS) {
      const at = queue.shift()
      await page.goto(BASE + at)
      await settle(page)
      const landed = here(page)
      if (!add({ pattern, path: landed })) continue
      count++
      // Every tab inside the page: one that changes the URL is a new screen;
      // one that does not is recorded as a click on this one.
      const lists = await page.locator('main [role="tablist"]').count()
      for (let list = 0; list < lists; list++) {
        const n = await page.locator('main [role="tablist"]').nth(list).locator('[role="tab"]').count()
        for (let index = 0; index < n; index++) {
          if (here(page) !== landed) {
            await page.goto(BASE + landed)
            await settle(page)
          }
          const tab = page.locator('main [role="tablist"]').nth(list).locator('[role="tab"]').nth(index)
          if (!(await tab.count())) continue
          const label = (await tab.innerText()).replace(/\s+/g, ' ').trim()
          if ((await tab.getAttribute('aria-selected')) === 'true') continue
          await tab.click()
          await settle(page)
          const after = here(page)
          if (after !== landed) {
            if (!seen.has(`${after}#`)) queue.push(after)
          } else if (count < MAX_VARIANTS && add({ pattern, path: landed, tab: { list, index, label } })) {
            count++
          }
        }
      }
    }
  }
  await context.close()

  const fixture = { role, recordedAt: new Date().toISOString(), user: { id: session.user.id, email }, responses, variants }
  mkdirSync(FIXTURE_DIR, { recursive: true })
  writeFileSync(new URL(`${role}.json`, FIXTURE_DIR), `${JSON.stringify(fixture)}\n`)
  console.log(`[record ${role}] ${variants.length} screens, ${Object.keys(responses).length} responses`)
}

const stopVite = await startVite()
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined })
try {
  const readOnly = readOnlyFunctions()
  for (const role of roles) await record(browser, role, readOnly)
} finally {
  await browser.close()
  stopVite()
}
