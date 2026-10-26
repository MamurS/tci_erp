/**
 * The type, weight, spacing and colour scales are closed sets (Prompt 30,
 * DESIGN.md «Tokens»): a class list in src may name only
 *   * a text size of the scale (`text-caption` … `text-display`; an `em`
 *     size relative to its parent is allowed) — no `text-[13px]`, no
 *     `text-sm`;
 *   * the regular, medium or semibold weight — bold only with the display
 *     face, which has no semibold;
 *   * spacing on the 4 px grid (2 px for hairline offsets: `*-0.5`);
 *   * colours from the tokens — no `bg-[#…]`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return /design$|offers[\\/]kp$/.test(path) ? [] : files(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

function classLists(source: string): string[] {
  const out: string[] = []
  for (const m of source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
    for (const part of (m[1] ?? m[2] ?? m[3]).split(/\$\{[^}]*\}/)) {
      if (/(^|\s)(?:[^\s:]+:)*(text|bg|font|p[xytblr]?|m[xytblr]?|gap)-/.test(part)) out.push(part)
    }
  }
  return out
}

const RULES: [string, RegExp, (list: string[]) => boolean][] = [
  ['a text size off the scale', /^text-\[[0-9.]+(rem|px)\]!?$/, () => true],
  ['a Tailwind text size instead of the scale', /^text-(xs|sm|base|lg|xl|[2-9]xl)$/, () => true],
  ['bold without the display face', /^font-bold$/, (list) => !list.includes('font-display')],
  ['a weight outside regular / medium / semibold', /^font-(thin|extralight|light|extrabold|black)$/, () => true],
  ['spacing off the 4 px grid', /^-?(p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y)-[1-9]\.5$/, () => true],
  ['a colour that is not a token', /^(text|bg|border|ring|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]$/, () => true],
]

describe('the scales are closed', () => {
  it('names only sizes, weights, spacing and colours of the system', () => {
    const offenders: string[] = []
    for (const file of files(SRC)) {
      for (const list of classLists(readFileSync(file, 'utf8'))) {
        const tokens = list.split(/\s+/).filter(Boolean).map((t) => t.replace(/^(?:[^\s:]+:)*/, ''))
        for (const token of tokens) {
          for (const [what, pattern, applies] of RULES) {
            if (pattern.test(token) && applies(tokens)) offenders.push(`${relative(SRC, file)}: ${what} — ${token}`)
          }
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([])
  })
})
