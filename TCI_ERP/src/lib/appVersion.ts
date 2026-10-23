/**
 * "Is this tab running the build that is deployed now?"
 *
 * A single-page app never reloads by itself: a tab opened before a deploy
 * keeps the old code through sign-outs and sign-ins until someone presses
 * reload. That is how a correct sign-in was still counted as a failure the
 * day after 0062 shipped — the old tab never called `record_sign_in`. The
 * build stamps its id into the bundle and into `/version.json`
 * (vite.config.ts); a running tab re-reads the file and compares.
 *
 * Anything that is not a well-formed answer — the dev server, a deploy from
 * before this file existed (the SPA fallback answers with index.html), the
 * network down — is "unknown", never "stale": a false alarm would ask
 * people to reload for nothing.
 */

declare const __APP_BUILD__: string | undefined

/** The build this tab is running ('dev' under `vite dev` and in unit tests). */
export const CURRENT_BUILD: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev'

export const VERSION_FILE = '/version.json'

/** How often an open tab asks, and the least time between two asks. */
export const VERSION_POLL_MS = 5 * 60_000
export const VERSION_MIN_GAP_MS = 60_000

/** `/version.json` → its build id, or null when the answer is not one. */
export function parseVersionFile(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const build = (raw as Record<string, unknown>).build
  return typeof build === 'string' && build.trim() !== '' ? build : null
}

/** Stale only when the server named a build and it is not ours. (`vite
 * dev` serves no version file, so a dev tab never sees a build to differ
 * from.) */
export function isStaleBuild(current: string, served: string | null): boolean {
  return served !== null && served !== current
}

/** Asks the server which build it serves now; null when it cannot tell. */
export async function fetchServedBuild(): Promise<string | null> {
  try {
    const response = await fetch(`${VERSION_FILE}?t=${Date.now()}`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return null
    return parseVersionFile(await response.json())
  } catch {
    return null
  }
}

export async function newerBuildIsServed(): Promise<boolean> {
  return isStaleBuild(CURRENT_BUILD, await fetchServedBuild())
}

const RELOADED_KEY = 'tci-erp-reloaded-for'

/**
 * Reload ONCE into the build the server serves now, if it is newer. Used
 * when a page chunk fails to load (after a deploy the old chunk names are
 * gone, so a stale tab breaks on its next lazy route) and by the sign-in
 * page. The marker (per served build) stops a reload loop when something
 * else is wrong; storage may be unavailable, and then we do not reload —
 * the notice still offers it.
 */
export async function reloadIntoNewBuild(): Promise<boolean> {
  const served = await fetchServedBuild()
  if (!isStaleBuild(CURRENT_BUILD, served)) return false
  try {
    if (window.sessionStorage.getItem(RELOADED_KEY) === served) return false
    window.sessionStorage.setItem(RELOADED_KEY, served ?? '')
  } catch {
    return false
  }
  window.location.reload()
  return true
}
