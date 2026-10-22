// node --test (Node >= 22.18 strips the types itself). Covers the pure half of
// the Worker: the client-IP rewrite and the container environment, the latter
// locked to the Python service's own source.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  CONTAINER_PORT,
  SERVICE_ENV_VARS,
  containerEnvVars,
  forwardHeaders,
  isProxyFailure,
} from '../src/forward.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const appDir = join(repoRoot, 'services', 'analytics', 'app')

test('the edge IP overwrites every client-supplied address header', () => {
  const incoming = new Headers({
    'cf-connecting-ip': '198.51.100.7', // as the edge set it
    'x-forwarded-for': '1.1.1.1, 2.2.2.2', // client-chosen: must not survive
    'x-real-ip': '3.3.3.3',
    'true-client-ip': '4.4.4.4',
    forwarded: 'for=5.5.5.5',
    'cf-connecting-ipv6': '2001:db8::1',
    authorization: 'Bearer token',
    'content-type': 'application/json',
  })
  const out = forwardHeaders(incoming, incoming.get('cf-connecting-ip'))
  assert.equal(out.get('cf-connecting-ip'), '198.51.100.7')
  assert.equal(out.get('x-forwarded-for'), '198.51.100.7')
  for (const h of ['x-real-ip', 'true-client-ip', 'forwarded', 'cf-connecting-ipv6']) {
    assert.equal(out.has(h), false, h)
  }
  // Everything else passes untouched.
  assert.equal(out.get('authorization'), 'Bearer token')
  assert.equal(out.get('content-type'), 'application/json')
})

test('the right-most X-Forwarded-For hop is the edge IP, never a client value', () => {
  const out = forwardHeaders(new Headers({ 'x-forwarded-for': '9.9.9.9' }), '203.0.113.5')
  const hops = (out.get('x-forwarded-for') ?? '').split(',').map((h) => h.trim())
  assert.deepEqual(hops, ['203.0.113.5'])
})

test('without an edge IP no address header is sent at all', () => {
  const out = forwardHeaders(
    new Headers({ 'x-forwarded-for': '9.9.9.9', 'cf-connecting-ip': '8.8.8.8' }),
    null,
  )
  assert.equal(out.has('x-forwarded-for'), false)
  assert.equal(out.has('cf-connecting-ip'), false)
})

test('a client cannot pick the container port', () => {
  const out = forwardHeaders(new Headers({ 'cf-container-target-port': '22' }), '203.0.113.5')
  assert.equal(out.has('cf-container-target-port'), false)
})

test('only set, non-empty service variables reach the container', () => {
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'secret',
    COMPANIES_HOUSE_API_KEY: '   ',
    TRUST_PROXY_HEADERS: 'true',
    ANALYTICS: { binding: true },
    UNRELATED: 'x',
  }
  assert.deepEqual(containerEnvVars(env as never), {
    PORT: String(CONTAINER_PORT),
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'secret',
    TRUST_PROXY_HEADERS: 'true',
  })
})

test('SERVICE_ENV_VARS is exactly what services/analytics reads', () => {
  const read = new Set<string>()
  const pattern = /(?:os\.environ\.get|_int|_csv)\(\s*"([A-Z][A-Z0-9_]+)"/g
  for (const file of readdirSync(appDir).filter((f) => f.endsWith('.py'))) {
    for (const m of readFileSync(join(appDir, file), 'utf8').matchAll(pattern)) read.add(m[1]!)
  }
  assert.ok(read.size > 0, 'no environment reads found — did the service move?')
  assert.deepEqual([...read].sort(), [...SERVICE_ENV_VARS].sort())
})

test('the container port is the one the Dockerfile serves on', () => {
  const dockerfile = readFileSync(join(repoRoot, 'Dockerfile'), 'utf8')
  assert.ok(dockerfile.includes(`--port \${PORT:-${CONTAINER_PORT}}`))
  assert.ok(dockerfile.includes(`EXPOSE ${CONTAINER_PORT}`))
})

test('the service has the /health endpoint the readiness probe uses', () => {
  assert.ok(readFileSync(join(appDir, 'main.py'), 'utf8').includes('@app.get("/health"'))
})

test('only a non-JSON 5xx is treated as the proxy failing', () => {
  assert.equal(isProxyFailure(500, 'text/plain;charset=UTF-8'), true)
  assert.equal(isProxyFailure(500, null), true)
  assert.equal(isProxyFailure(500, 'application/json'), false) // the service's opaque 500
  assert.equal(isProxyFailure(504, 'application/json'), false) // the service's deadline
  assert.equal(isProxyFailure(404, 'text/plain'), false)
})
