import { lazy } from 'react'
import type { ComponentType } from 'react'

import { reloadIntoNewBuild } from './appVersion'

/**
 * React.lazy for a NAMED export: our feature modules export pages by name
 * (`export { EntitiesPage }`), lazy() wants a default. Two pages of one
 * module share the module's loader, so they share one chunk.
 *
 * A tab opened before a deploy asks for chunk names that no longer exist.
 * When the server confirms a newer build, the tab reloads into it once
 * instead of showing a broken page (appVersion.ts); any other failure is
 * thrown as before.
 */
export function lazyPage<M extends Record<string, unknown>, K extends keyof M & string>(
  load: () => Promise<M>,
  name: K,
) {
  return lazy(async () => {
    try {
      const module = await load()
      return { default: module[name] as ComponentType }
    } catch (error) {
      // Reloading: keep the page's loading frame until the new build is up.
      if (await reloadIntoNewBuild()) return new Promise<never>(() => undefined)
      throw error
    }
  })
}
