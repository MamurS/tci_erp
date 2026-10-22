/**
 * Pure helpers for the Worker → container hop. No Workers-only API in here, so
 * the same module is exercised by `node --test` (test/forward.test.ts).
 *
 * Two jobs:
 *
 *  1. The CLIENT IP. services/analytics/app/hardening.py `client_ip()` buckets
 *     its rate limits on `CF-Connecting-IP` when TRUST_PROXY_HEADERS is set,
 *     else on the RIGHT-most `X-Forwarded-For` hop. Cloudflare's edge sets
 *     `CF-Connecting-IP` on the request that reaches the Worker; the Worker
 *     re-states it on the request to the container and OVERWRITES every
 *     client-IP header the caller might have sent, so nobody can mint a fresh
 *     rate-limit bucket by sending one. Values from the client are never
 *     appended to — they are dropped.
 *
 *  2. The CONTAINER ENVIRONMENT. Only the variables the service actually
 *     reads are passed, and an unset/empty one is left out entirely so the
 *     service's own defaults (and "not configured" states) apply.
 */

/** Every header a client could use to claim an address. All are dropped. */
export const CLIENT_IP_HEADERS = [
  'cf-connecting-ip',
  'cf-connecting-ipv6',
  'x-forwarded-for',
  'x-real-ip',
  'true-client-ip',
  'forwarded',
] as const

/**
 * Headers that steer the @cloudflare/containers proxy itself. The Container
 * class reads `cf-container-target-port` from the forwarded request to pick
 * the container port, so a client sending it could reach a port other than
 * the service's. Never let one through from outside.
 */
export const CONTAINER_CONTROL_HEADERS = ['cf-container-target-port'] as const

/**
 * The headers for the request to the container.
 *
 * @param incoming the original request's headers
 * @param clientIp the original request's `CF-Connecting-IP` (set by
 *   Cloudflare's edge, not by the client). Null/empty in `wrangler dev`; then
 *   no IP header is sent and the service falls back to the socket address.
 */
export function forwardHeaders(incoming: Headers, clientIp: string | null): Headers {
  const out = new Headers(incoming)
  for (const name of [...CLIENT_IP_HEADERS, ...CONTAINER_CONTROL_HEADERS]) out.delete(name)
  const ip = (clientIp ?? '').trim()
  if (ip) {
    out.set('cf-connecting-ip', ip)
    // A single hop, so the service's right-most-XFF fallback agrees too.
    out.set('x-forwarded-for', ip)
  }
  return out
}

/**
 * Every environment variable services/analytics reads (app/settings.py,
 * app/supabase_admin.py, app/registry.py, app/main.py). Locked to the Python
 * source by test/forward.test.ts: a new variable there fails the test until it
 * is listed here.
 */
export const SERVICE_ENV_VARS = [
  // secrets (Worker secrets, never in wrangler.jsonc)
  'SUPABASE_SERVICE_ROLE_KEY',
  'COMPANIES_HOUSE_API_KEY',
  // plain configuration (wrangler.jsonc `vars`)
  'SUPABASE_URL',
  'CORS_ALLOW_ORIGINS',
  'CORS_PREVIEW_REGEX',
  'TRUST_PROXY_HEADERS',
  'LOG_LEVEL',
  'MAX_BODY_BYTES',
  'REQUEST_TIMEOUT_SECONDS',
  'PROVISIONING_PER_IP_PER_HOUR',
  'PROVISIONING_PER_CALLER_PER_HOUR',
  'COMPUTE_PER_IP_PER_HOUR',
] as const

export type ServiceEnvName = (typeof SERVICE_ENV_VARS)[number]

/** The port the Dockerfile's uvicorn listens on (`${PORT:-8000}`). */
export const CONTAINER_PORT = 8000

/**
 * The container's environment, built from the Worker's vars and secrets.
 * Anything not in SERVICE_ENV_VARS (bindings, unrelated vars) is not passed.
 */
export function containerEnvVars(
  env: Partial<Record<ServiceEnvName, unknown>>,
): Record<string, string> {
  const out: Record<string, string> = { PORT: String(CONTAINER_PORT) }
  for (const name of SERVICE_ENV_VARS) {
    const value = env[name]
    if (typeof value === 'string' && value.trim() !== '') out[name] = value.trim()
  }
  return out
}

/**
 * True when the response is the Container class's own proxy failure rather
 * than an answer from the service. The service's errors are always JSON
 * (opaque `{"detail": …, "request_id": …}`); the class answers a failed proxy
 * with a text/plain 500 that names the internal error, which must not reach a
 * browser.
 */
export function isProxyFailure(status: number, contentType: string | null): boolean {
  return status >= 500 && !(contentType ?? '').toLowerCase().includes('application/json')
}
