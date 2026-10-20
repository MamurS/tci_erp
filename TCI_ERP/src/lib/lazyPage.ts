import { lazy } from 'react'
import type { ComponentType } from 'react'

/**
 * React.lazy for a NAMED export: our feature modules export pages by name
 * (`export { EntitiesPage }`), lazy() wants a default. Two pages of one
 * module share the module's loader, so they share one chunk.
 */
export function lazyPage<M extends Record<string, unknown>, K extends keyof M & string>(
  load: () => Promise<M>,
  name: K,
) {
  return lazy(async () => {
    const module = await load()
    return { default: module[name] as ComponentType }
  })
}
