/**
 * Pure helpers of the command palette (⌘K / Ctrl+K): matching navigation
 * entries and making a search term safe for a PostgREST `or=` filter.
 */

/** Case- and accent-insensitive "contains" on every word of the query. */
export function matchesQuery(text: string, query: string): boolean {
  const norm = (s: string) =>
    s
      .toLocaleLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
  const haystack = norm(text)
  return norm(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

/**
 * A search term for `.or('name.ilike.%term%,registration_number.ilike.%term%')`.
 * Commas, parentheses and quotes would break the filter grammar, and `%`/`*`
 * are wildcards — none of them is meaningful in a company name search, so
 * they are dropped. Returns null when nothing searchable is left.
 */
export function sanitizeSearchTerm(raw: string): string | null {
  const cleaned = raw.replace(/[,()%*"'\\]/g, ' ').replace(/\s+/g, ' ').trim()
  return cleaned.length >= 2 ? cleaned : null
}

/** Is this the palette shortcut? ⌘K on macOS, Ctrl+K elsewhere. */
export function isPaletteShortcut(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey'>): boolean {
  return e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)
}

/** What the palette can find besides sections, and the page each opens. */
export const PALETTE_SOURCES = ['entities', 'policies', 'claims', 'requests'] as const
export type PaletteSource = (typeof PALETTE_SOURCES)[number]

export const SOURCE_PATHS: Record<PaletteSource, string> = {
  entities: '/entities',
  policies: '/policies',
  claims: '/claims',
  requests: '/requests',
}

/** The sources the ACTING role may open (the same route rule as the
 * sidebar): a person acting as sales is not offered claims they could not
 * open in that role. The database still decides which rows come back. */
export function paletteSources(canOpen: (path: string) => boolean): PaletteSource[] {
  return PALETTE_SOURCES.filter((s) => canOpen(SOURCE_PATHS[s]))
}
