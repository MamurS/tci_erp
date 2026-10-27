/** Where `query` occurs in `text`, ignoring case and diacritics — the ranges
 * Highlight marks. A query of several comma-separated terms (the one search,
 * lib/pageSearch.ts) marks every term. A term shorter than two characters
 * marks nothing. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export function matchRanges(text: string, query: string): [number, number][] {
  const terms = query.split(',')
  if (terms.length > 1) {
    const all = terms.flatMap((term) => matchRanges(text, term)).sort((a, b) => a[0] - b[0])
    const merged: [number, number][] = []
    for (const r of all) {
      const last = merged[merged.length - 1]
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
      else merged.push([r[0], r[1]])
    }
    return merged
  }
  const q = fold(query.trim())
  if (q.length < 2 || !text) return []
  // Fold character by character so indices map back onto the original.
  const map: number[] = []
  let folded = ''
  for (let i = 0; i < text.length; i++) {
    const f = fold(text[i])
    for (let k = 0; k < f.length; k++) map.push(i)
    folded += f
  }
  const ranges: [number, number][] = []
  let from = 0
  for (;;) {
    const at = folded.indexOf(q, from)
    if (at < 0) break
    ranges.push([map[at], map[at + q.length - 1] + 1])
    from = at + q.length
  }
  return ranges
}
