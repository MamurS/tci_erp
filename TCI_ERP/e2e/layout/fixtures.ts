/**
 * Recorded REST responses, replayed by the stub (e2e/support/stub.ts).
 *
 * tools/layout-fixtures/record.mjs (a manual tool, never run by the suite)
 * signs in each demo user on the canonical project once, walks that user's
 * screens, and writes what every READ answered to fixtures/<role>.json. The
 * layout guard then renders the same screens with the network sealed: each call is answered from the file — by its exact URL, else
 * by the same resource and `select`, else by the resource alone (a query that
 * carries today's date still finds its rows), else the stub's default.
 */

import { readFileSync } from 'node:fs'

import type { StubReply, StubRequest } from '../support/stub'
import type { DemoRole } from './screens'

export interface RecordedReply {
  status: number
  json: unknown
  /** content-range, for the count queries (Prefer: count=exact). */
  range?: string
}

/** One screen as recorded: a path, optionally a tab the URL does not name. */
export interface Variant {
  pattern: string
  path: string
  /** Click tab `index` of tablist `list` in <main> after loading `path`. */
  tab?: { list: number; index: number; label: string }
}

export interface RoleFixture {
  role: DemoRole
  recordedAt: string
  user: { id: string; email: string }
  responses: Record<string, RecordedReply>
  variants: Variant[]
}

export const FIXTURE_DIR = new URL('./fixtures/', import.meta.url)

export function loadFixture(role: DemoRole): RoleFixture | null {
  try {
    return JSON.parse(readFileSync(new URL(`${role}.json`, FIXTURE_DIR), 'utf8')) as RoleFixture
  } catch {
    return null
  }
}

/** The stable key of a REST call: method, resource, sorted query, rpc body. */
export function requestKey(method: string, resource: string, rpc: boolean, url: URL, body: string | null): string {
  const query = [...url.searchParams.entries()]
    .sort(([a, x], [b, y]) => (a === b ? x.localeCompare(y) : a.localeCompare(b)))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  let payload = ''
  if (rpc && body) {
    try {
      payload = ` ${JSON.stringify(sortKeys(JSON.parse(body)))}`
    } catch {
      payload = ` ${body}`
    }
  }
  return `${method} ${rpc ? 'rpc/' : ''}${resource}?${query}${payload}`
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    )
  return value
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }

/** A `respond` for stubBackend that replays a role's recorded responses. */
export function replay(fixture: RoleFixture): (request: StubRequest) => StubReply | undefined {
  const byKey = new Map(Object.entries(fixture.responses))
  // Fallbacks: the first recording per (method, resource, select) and per (method, resource).
  const bySelect = new Map<string, RecordedReply>()
  const byResource = new Map<string, RecordedReply>()
  for (const [key, reply] of byKey) {
    const [method, rest = ''] = key.split(' ')
    const [resource = '', query = ''] = rest.split('?')
    const select = new URLSearchParams(query).get('select') ?? ''
    if (!bySelect.has(`${method} ${resource} ${select}`)) bySelect.set(`${method} ${resource} ${select}`, reply)
    if (!byResource.has(`${method} ${resource}`)) byResource.set(`${method} ${resource}`, reply)
  }
  return (request) => {
    const resource = `${request.rpc ? 'rpc/' : ''}${request.resource}`
    const method = request.method === 'HEAD' ? 'HEAD' : request.method
    const select = request.url.searchParams.get('select') ?? ''
    const found =
      byKey.get(requestKey(method, request.resource, request.rpc, request.url, request.body)) ??
      bySelect.get(`${method} ${resource} ${select}`) ??
      byResource.get(`${method} ${resource}`)
    if (!found) return undefined
    let json = found.json
    if (!request.rpc) {
      if (request.single && Array.isArray(json)) json = json[0] ?? null
      else if (!request.single && json !== null && typeof json === 'object' && !Array.isArray(json)) json = [json]
    }
    return {
      status: found.status,
      json,
      headers: found.range ? { ...CORS, 'content-range': found.range } : CORS,
    }
  }
}

// ---------------------------------------------------------------------------
// Sanitising (the recorder): no real person reaches the repository.
// ---------------------------------------------------------------------------

const PERSON_KEYS = new Set([
  'full_name',
  'phone',
  'contact_person',
  'contact_phone',
  'display_name',
  'user_agent',
])
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g

/** Replaces e-mails (other than @demo.invalid) and person fields with stable
 * placeholders: the same value always becomes the same placeholder, so a
 * screen that compares two of them still behaves. */
export function sanitiser() {
  const seen = new Map<string, string>()
  const placeholder = (kind: string, value: string) => {
    const key = `${kind}:${value}`
    if (!seen.has(key)) seen.set(key, `${kind}-${seen.size + 1}`)
    return seen.get(key)!
  }
  const text = (value: string) =>
    value.replace(EMAIL, (email) =>
      email.toLowerCase().endsWith('@demo.invalid') ? email : `${placeholder('person', email)}@example.invalid`,
    )
  const walk = (value: unknown, key?: string): unknown => {
    if (typeof value === 'string') {
      if (key && PERSON_KEYS.has(key)) {
        if (key.includes('phone')) return '+000 00 000 00 00'
        if (key === 'user_agent') return 'Mozilla/5.0 (X11; Linux x86_64)'
        return value.trim() ? `Person ${placeholder('name', value).split('-')[1]}` : value
      }
      return text(value)
    }
    if (Array.isArray(value)) return value.map((v) => walk(v))
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v, k)]))
    return value
  }
  return walk
}
