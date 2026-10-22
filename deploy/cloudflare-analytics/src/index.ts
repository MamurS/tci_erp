/**
 * TCI analytics on Cloudflare Containers.
 *
 * The Worker is a thin front door: every request goes to ONE container
 * instance running the repo-root Dockerfile (services/analytics). One instance,
 * because the service's rate limiter is in-process — two instances would each
 * keep their own count.
 *
 * The service keeps all of its own hardening (CORS allowlist, body cap,
 * deadline, opaque errors, rate limits); the Worker adds no logic of its own
 * beyond the client-IP header and hiding the proxy's internal error text.
 * Runbook: services/analytics/README.md, «Cloudflare Containers».
 */
import { Container, getContainer } from '@cloudflare/containers'

import {
  CONTAINER_PORT,
  containerEnvVars,
  forwardHeaders,
  isProxyFailure,
  type ServiceEnvName,
} from './forward'

export interface Env extends Partial<Record<ServiceEnvName, string>> {
  ANALYTICS: DurableObjectNamespace<AnalyticsContainer>
}

/** The single instance every request is routed to. */
const INSTANCE_NAME = 'tci-analytics'

export class AnalyticsContainer extends Container<Env> {
  override defaultPort = CONTAINER_PORT
  /** Idle time before the container is stopped (and billing stops). */
  override sleepAfter = '10m'
  /**
   * Read from the Worker's vars and secrets when the Durable Object is
   * created, and handed to the container when it STARTS. A running container
   * keeps the environment it started with: a secret changed in the dashboard
   * reaches the service on its next start (after `sleepAfter` of idleness, or
   * a redeploy that rolls the container).
   */
  override envVars = containerEnvVars(this.env)
  /** Startup readiness probe — the service's liveness endpoint. */
  override pingEndpoint = 'localhost/health'

  override onError(error: unknown): never {
    // Logged without the request; the message is the runtime's, not ours.
    console.error('analytics container error', error instanceof Error ? error.message : String(error))
    throw error
  }
}

function unavailable(): Response {
  return new Response(JSON.stringify({ detail: 'analytics service unavailable' }), {
    status: 503,
    headers: { 'content-type': 'application/json', 'retry-after': '30' },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = forwardHeaders(request.headers, request.headers.get('cf-connecting-ip'))
    const forwarded = new Request(request, { headers })
    try {
      const response = await getContainer(env.ANALYTICS, INSTANCE_NAME).fetch(forwarded)
      if (isProxyFailure(response.status, response.headers.get('content-type'))) {
        console.error('analytics container proxy failure', response.status, await response.text())
        return unavailable()
      }
      return response
    } catch (error) {
      console.error('analytics container unreachable', error instanceof Error ? error.message : String(error))
      return unavailable()
    }
  },
} satisfies ExportedHandler<Env>
