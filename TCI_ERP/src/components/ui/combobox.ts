/**
 * Matching for the Combobox (pure, tested): what a typed query finds, in
 * which order, and which part of each label to highlight.
 *
 * Case, diacritics and the several apostrophes Uzbek names are typed with
 * (‘ ’ ʻ ʼ ') are ignored, and runs of spaces count as one. A label that
 * STARTS with the query ranks first, then one with a WORD starting with it,
 * then one merely containing it; a hit only in a keyword (a registration
 * number) comes last. Ties keep the caller's order.
 */

export interface ComboMatchable {
  id: string
  label: string
  /** Searched too, never highlighted: registration number, short names. */
  keywords?: readonly (string | null | undefined)[]
}

const APOSTROPHES = /[‘’ʻʼ'`´]/g
const IS_APOSTROPHE = /^[‘’ʻʼ'`´]$/

/** Lower case, no diacritics, no apostrophes, single spaces. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(APOSTROPHES, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function rank(option: ComboMatchable, query: string): number | null {
  const label = normalize(option.label)
  if (label.startsWith(query)) return 0
  if (label.includes(` ${query}`) || label.includes(`"${query}`) || label.includes(`«${query}`)) return 1
  if (label.includes(query)) return 2
  if ((option.keywords ?? []).some((k) => k && normalize(k).includes(query))) return 3
  return null
}

export interface ComboResult<T> {
  shown: T[]
  /** Matches beyond the limit: "N more — keep typing". */
  more: number
}

export function matchOptions<T extends ComboMatchable>(options: readonly T[], query: string, limit = 8): ComboResult<T> {
  const q = normalize(query)
  if (!q) return { shown: options.slice(0, limit), more: Math.max(options.length - limit, 0) }
  const hits: { option: T; rank: number; index: number }[] = []
  options.forEach((option, index) => {
    const r = rank(option, q)
    if (r !== null) hits.push({ option, rank: r, index })
  })
  hits.sort((a, b) => a.rank - b.rank || a.index - b.index)
  return { shown: hits.slice(0, limit).map((h) => h.option), more: Math.max(hits.length - limit, 0) }
}

/**
 * The label cut into plain and matching parts, for bold highlighting. Works
 * on the ORIGINAL characters: normalisation never changes the length of a
 * Latin or Cyrillic letter, and apostrophes are skipped while mapping.
 */
export function highlight(label: string, query: string): { text: string; match: boolean }[] {
  const q = normalize(query)
  if (!q) return [{ text: label, match: false }]
  // Map each normalised character back to its index in the original label.
  const map: number[] = []
  let flat = ''
  let lastSpace = false
  for (let i = 0; i < label.length; i++) {
    const ch = label[i]!
    if (IS_APOSTROPHE.test(ch)) continue
    const n = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    if (/\s/.test(n)) {
      if (lastSpace || flat === '') continue
      lastSpace = true
      flat += ' '
      map.push(i)
      continue
    }
    lastSpace = false
    for (const c of n) {
      flat += c
      map.push(i)
    }
  }
  const at = flat.indexOf(q)
  if (at < 0) return [{ text: label, match: false }]
  const start = map[at]!
  const end = map[at + q.length - 1]! + 1
  return [
    { text: label.slice(0, start), match: false },
    { text: label.slice(start, end), match: true },
    { text: label.slice(end), match: false },
  ].filter((part) => part.text !== '')
}
