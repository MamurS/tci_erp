/** Where `query` occurs in `text`, ignoring case and diacritics — the ranges
 * Highlight marks. A query shorter than two characters marks nothing. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

export function matchRanges(text: string, query: string): [number, number][] {
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
