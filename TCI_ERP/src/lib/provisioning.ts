/** Client for the user-provisioning endpoints of the analytics service.
 *
 * These calls carry the CALLER's own Supabase access token; the service
 * resolves the caller from it and loads their roles server-side. The
 * service-role key that actually creates users lives only in that service
 * and never reaches this bundle.
 */

import { supabase } from './supabase'

const BASE_URL: string = import.meta.env.VITE_ANALYTICS_API_URL ?? 'http://localhost:8000'

/** The service is unreachable, or provisioning is not configured on it.
 * Both mean the same thing to the user: the screen cannot work right now. */
export class ProvisioningUnavailableError extends Error {
  constructor() {
    super('provisioning service unavailable')
    this.name = 'ProvisioningUnavailableError'
  }
}

/** The service refused the request. `code` is its machine-readable reason
 * (see the mapping in features/admin/provisioningErrors.ts). */
export class ProvisioningError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ProvisioningError'
    this.status = status
    this.code = code
  }
}

export interface ProvisionedUser {
  user_id: string
  email: string
  /** Shown ONCE. Never persisted anywhere - not by the service, not here. */
  temporary_password: string
  roles: string[]
  entity_id: string | null
  must_change_password: boolean
}

export interface CreateUserInput {
  email: string
  full_name: string | null
  roles: string[]
  entity_id: string | null
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ProvisioningError(401, 'no_session', 'not signed in')
  return { Authorization: `Bearer ${token}` }
}

/** Pulls the {code, message} shape the service returns out of a FastAPI
 * error envelope, which nests it under `detail`. */
function parseError(status: number, body: unknown): ProvisioningError {
  const detail = (body as { detail?: unknown } | null)?.detail
  if (detail && typeof detail === 'object' && 'code' in detail) {
    const typed = detail as { code?: unknown; message?: unknown }
    return new ProvisioningError(
      status,
      String(typed.code ?? 'unknown'),
      String(typed.message ?? ''),
    )
  }
  // FastAPI validation errors arrive as a list; the field detail is not
  // useful to an operator, so they collapse to one code.
  if (Array.isArray(detail)) return new ProvisioningError(status, 'invalid_input', '')
  return new ProvisioningError(status, 'unknown', typeof detail === 'string' ? detail : '')
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const headers = await authHeader()
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...headers, ...(init.headers ?? {}) },
    })
  } catch {
    throw new ProvisioningUnavailableError()
  }
  if (response.status === 503) throw new ProvisioningUnavailableError()
  if (!response.ok) {
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      /* non-JSON error body: fall through to the generic code */
    }
    throw parseError(response.status, body)
  }
  return (await response.json()) as T
}

export function createUser(input: CreateUserInput): Promise<ProvisionedUser> {
  return call<ProvisionedUser>('/users', { method: 'POST', body: JSON.stringify(input) })
}

export function resetUserPassword(userId: string): Promise<ProvisionedUser> {
  return call<ProvisionedUser>(`/users/${userId}/reset-password`, { method: 'POST' })
}

export function setUserDisabled(
  userId: string,
  disabled: boolean,
): Promise<{ user_id: string; disabled: boolean }> {
  return call(`/users/${userId}/${disabled ? 'disable' : 'enable'}`, { method: 'POST' })
}

/** Is provisioning usable right now? Drives the service-unavailable state.
 * Unauthenticated on the service side, so it works before any other call. */
export async function provisioningAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/users/provisioning-status`)
    if (!response.ok) return false
    const body = (await response.json()) as { configured?: boolean }
    return body.configured === true
  } catch {
    return false
  }
}
