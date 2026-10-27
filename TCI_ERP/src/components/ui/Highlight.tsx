/**
 * The part of a cell's text that matches the search, marked (Prompt 30,
 * phase 2) — case- and accent-insensitive on the letters, the original text
 * kept as written.
 */

import { matchRanges } from './highlight'

export function Highlight({ text, query }: { text: string | null | undefined; query: string }) {
  const value = text ?? ''
  const ranges = matchRanges(value, query)
  if (!ranges.length) return <>{value}</>
  const out = []
  let at = 0
  for (const [start, end] of ranges) {
    if (start > at) out.push(value.slice(at, start))
    out.push(
      <mark key={start} className="rounded-sm bg-warning-100 px-px text-inherit">
        {value.slice(start, end)}
      </mark>,
    )
    at = end
  }
  if (at < value.length) out.push(value.slice(at))
  return <>{out}</>
}
