/** Cloudflare Turnstile for the sign-in form (audit Phase A2).
 *
 * Supabase Auth verifies the token server-side once CAPTCHA protection is
 * switched on in the dashboard (Authentication → Attack protection); the
 * browser's only job is to obtain a token and pass it as `captchaToken`.
 *
 * The widget is configured for INVISIBLE mode in the Cloudflare dashboard;
 * `appearance: 'interaction-only'` keeps it out of the layout unless a
 * challenge is actually needed, and `execution: 'execute'` lets the form
 * ask for a token at submit time rather than on page load.
 *
 * Without VITE_TURNSTILE_SITE_KEY nothing loads and sign-in works as before:
 * local development, previews and the CI build never talk to Cloudflare.
 * The script host is allow-listed in the CSP (`public/_headers`).
 */

export const TURNSTILE_SCRIPT_URL =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileRenderOptions {
  sitekey: string
  callback: (token: string) => void
  'error-callback'?: (code?: string) => void
  'expired-callback'?: () => void
  execution?: 'render' | 'execute'
  appearance?: 'always' | 'execute' | 'interaction-only'
  size?: 'normal' | 'compact' | 'flexible'
}

interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string
  execute: (widgetId: string) => void
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

/** The site key, or undefined when CAPTCHA is not configured for this build. */
export function turnstileSiteKey(): string | undefined {
  const key = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined
  return key && key.trim() ? key.trim() : undefined
}

export function isTurnstileEnabled(siteKey: string | undefined): boolean {
  return typeof siteKey === 'string' && siteKey.length > 0
}

let loading: Promise<TurnstileApi> | null = null

/** Injects the Turnstile script once and resolves with its API. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (loading) return loading
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT_URL
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile)
      else reject(new Error('turnstile did not initialise'))
    }
    script.onerror = () => reject(new Error('turnstile script failed to load'))
    document.head.appendChild(script)
  })
  return loading
}

export interface TurnstileHandle {
  /** Obtains a fresh token (a challenge is shown only if Cloudflare asks). */
  getToken: () => Promise<string>
  dispose: () => void
}

/** Renders an invisible widget into `container` and returns a handle that
 * produces one token per call. Each token is single-use on the Supabase
 * side, so the widget is reset after every sign-in attempt. */
export async function mountTurnstile(
  container: HTMLElement,
  siteKey: string,
): Promise<TurnstileHandle> {
  const api = await loadTurnstile()
  let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null
  const widgetId = api.render(container, {
    sitekey: siteKey,
    execution: 'execute',
    appearance: 'interaction-only',
    callback: (token) => {
      pending?.resolve(token)
      pending = null
    },
    'error-callback': (code) => {
      pending?.reject(new Error(`turnstile error ${code ?? ''}`.trim()))
      pending = null
    },
    'expired-callback': () => {
      pending?.reject(new Error('turnstile token expired'))
      pending = null
    },
  })
  return {
    getToken: () =>
      new Promise<string>((resolve, reject) => {
        pending = { resolve, reject }
        api.reset(widgetId)
        api.execute(widgetId)
      }),
    dispose: () => {
      try {
        api.remove(widgetId)
      } catch {
        // already gone
      }
    },
  }
}
