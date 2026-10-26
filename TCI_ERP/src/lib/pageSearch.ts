/**
 * The one search (owner, 2026-10-26): the field in the top bar searches the
 * whole system AND filters the page that is open. What is typed lives in the
 * URL (`?q=`), so a filtered list can be bookmarked and shared.
 *
 * Terms are separated by commas and applied IN ORDER, each narrowing what the
 * previous one left: «Samarkand, TCI-2026, UZ» keeps the rows about
 * Samarkand, of those the ones on a TCI-2026 policy, of those the Uzbek ones.
 *
 * A term that EXACTLY equals a value of some remaining row (a whole company
 * name, a policy number, a registration number, a country code) selects
 * exactly those rows: «TCI-10000» finds that policy and not TCI-100001. Any
 * other term matches as «contains». Case, accents, repeated spaces and the
 * different apostrophes of Uzbek Latin (ʻ ‘ ' `) never matter.
 *
 * No country needs to be given: a name finds the company wherever it is
 * registered, and a country (code or name) is just one more term when a name
 * exists in two countries.
 */

/** One comparable form of a text. */
export function normalizeSearch(text: string): string {
  return text
    .toLocaleLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ʻʼ‘’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** The terms of a query: split on commas, trimmed, empties dropped. */
export function parseTerms(query: string | null | undefined): string[] {
  if (!query) return []
  return query
    .split(',')
    .map((term) => normalizeSearch(term))
    .filter((term) => term.length > 0)
}

/** What a row can be found by (names, numbers, codes, labels). */
export type SearchFields<T> = (row: T) => readonly (string | number | null | undefined)[]

function valuesOf<T>(row: T, fields: SearchFields<T>): string[] {
  return fields(row)
    .filter((v): v is string | number => v !== null && v !== undefined && v !== '')
    .map((v) => normalizeSearch(String(v)))
}

/** How one term reads against the rows it narrows: an exact value, or a part
 * of one, or nothing. */
export type TermMatch = 'exact' | 'contains' | 'none'

/**
 * Narrow `rows` by every term in order (see the module comment). Returns the
 * rows left and how each term matched, so a page can say «nothing matches
 * “X”» naming the term that emptied the list.
 */
export function filterByTerms<T>(
  rows: readonly T[],
  terms: readonly string[],
  fields: SearchFields<T>,
): { rows: T[]; matches: TermMatch[] } {
  let left = [...rows]
  const matches: TermMatch[] = []
  if (terms.length === 0) return { rows: left, matches }
  const cache = new Map<T, string[]>()
  const of = (row: T) => {
    let values = cache.get(row)
    if (!values) {
      values = valuesOf(row, fields)
      cache.set(row, values)
    }
    return values
  }
  for (const raw of terms) {
    const term = normalizeSearch(raw)
    if (!term) continue
    const exact = left.filter((row) => of(row).some((v) => v === term))
    if (exact.length > 0) {
      left = exact
      matches.push('exact')
      continue
    }
    left = left.filter((row) => of(row).some((v) => v.includes(term)))
    matches.push(left.length > 0 ? 'contains' : 'none')
  }
  return { rows: left, matches }
}

/** Convenience: only the rows. */
export function searchRows<T>(rows: readonly T[], query: string | null | undefined, fields: SearchFields<T>): T[] {
  return filterByTerms(rows, parseTerms(query), fields).rows
}

/** The term that left nothing, when one did (for the empty state). */
export function emptyingTerm(query: string | null | undefined, matches: readonly TermMatch[]): string | null {
  const terms = (query ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const i = matches.indexOf('none')
  return i >= 0 ? (terms[i] ?? null) : null
}

/** The term being typed: the last one of the comma-separated query (what the
 * system-wide results look up). */
export function lastTerm(query: string): string {
  const parts = query.split(',')
  return (parts[parts.length - 1] ?? '').trim()
}
