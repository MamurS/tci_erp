/** Legacy-route redirect map (Phase 3a): /buyers and /policyholders merged
 * into /entities. Pure function so the mapping is unit-testable; query
 * strings (e.g. ?tab=rating) are preserved by the caller. */

const LEGACY_PREFIXES = ['/buyers', '/policyholders'] as const

/** Returns the /entities path for a legacy path, or null when not legacy. */
export function legacyRedirect(pathname: string): string | null {
  for (const prefix of LEGACY_PREFIXES) {
    if (pathname === prefix) return '/entities'
    if (pathname.startsWith(prefix + '/')) {
      return '/entities' + pathname.slice(prefix.length)
    }
  }
  return null
}
