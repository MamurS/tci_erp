/**
 * Full-text search over the compiled guide in the reader's language. Every
 * word of the query must appear; title hits rank first. Text is compared the
 * way the app's one search compares it (lib/pageSearch.ts normalizeSearch):
 * case and accents never matter, so ё reads as е and й as и; and every
 * apostrophe of Uzbek Latin (ʻ ‘ ’ ' `) is dropped, so «so‘rov», «so'rov»
 * and «sorov» all find the same topics.
 */
import type { HelpBundle } from './types'

export interface HelpHit {
  id: string
  title: string
  section: string
  score: number
  /** Text around the first match; `marks` are [start, end) ranges in it to highlight. */
  snippet: string
  marks: [number, number][]
}

const APOSTROPHES = /[ʻʼ‘’'`´]/g

/** One comparable form of a text (may be shorter: apostrophes go). */
export function foldHelp(text: string): string {
  return text.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(APOSTROPHES, '')
}

/** Folded words of a query (2+ characters), each once. */
export function queryWords(q: string): string[] {
  return [...new Set(foldHelp(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2))]
}

/** foldHelp character by character, with the index map back to the original. */
function foldWithMap(s: string): { n: string; map: number[] } {
  let n = ''
  const map: number[] = []
  for (let i = 0; i < s.length; i++) {
    for (const ch of foldHelp(s[i])) {
      n += ch
      map.push(i)
    }
  }
  map.push(s.length)
  return { n, map }
}

/** Ranges of `text` matching any of the (folded) words, in original positions, merged. */
export function matchRanges(text: string, words: readonly string[]): [number, number][] {
  const { n, map } = foldWithMap(text)
  const out: [number, number][] = []
  for (const w of words) {
    for (let i = n.indexOf(w); i >= 0; i = n.indexOf(w, i + w.length)) out.push([map[i], map[i + w.length - 1] + 1])
  }
  out.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of out) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}

/** Searches the topics `visible` lets through (the reader's role), best first. */
export function searchHelp(
  bundle: HelpBundle,
  q: string,
  visible: (roles: readonly string[]) => boolean = () => true,
  limit = 30,
): HelpHit[] {
  const words = queryWords(q)
  if (!words.length) return []
  const hits: HelpHit[] = []
  const sectionTitle = new Map(bundle.sections.map((s) => [s.id, s.title]))
  for (const t of Object.values(bundle.topics)) {
    if (!visible(t.roles)) continue
    const title = foldHelp(t.title)
    const body = foldHelp(t.text)
    if (!words.every((w) => title.includes(w) || body.includes(w))) continue
    let score = 0
    for (const w of words) {
      if (title.includes(w)) score += 10
      score += Math.min(5, body.split(w).length - 1)
    }
    if (t.index) score -= 1
    // snippet: ~180 characters around the first body match
    const ranges = matchRanges(t.text, words)
    const start = ranges.length ? Math.max(0, ranges[0][0] - 60) : 0
    const end = Math.min(t.text.length, start + 180)
    let snippet = t.text.slice(start, end)
    let shift = start
    if (start > 0) {
      snippet = `…${snippet}`
      shift -= 1
    }
    if (end < t.text.length) snippet += '…'
    const marks = ranges
      .filter(([a, b]) => a >= start && b <= end)
      .map(([a, b]) => [a - shift, b - shift] as [number, number])
    hits.push({ id: t.id, title: t.title, section: sectionTitle.get(t.section) ?? '', score, snippet, marks })
  }
  return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit)
}
