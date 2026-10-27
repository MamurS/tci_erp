/**
 * The contrast guard (Prompt 30): every text and icon colour pair the
 * screens use reaches WCAG 4.5 : 1 for normal text and 3 : 1 for large text
 * and icons.
 *
 * Two layers:
 *   1. the palette itself — the pairing rule holds for every ramp, the grade
 *      scale and the canvas (so a pair chosen by the rule needs no check);
 *   2. the code — every `text-…` / `fill-…` / `stroke-…` colour class in a
 *      class list (any string literal of src that reads as one) is paired
 *      with the background of the same list — without one, with white AND
 *      the canvas, or for a light colour with the dark surface it sits on
 *      (the sidebar, a navy header bar, a primary button) — alpha blended,
 *      and judged as text or as an icon / large text.
 *      A class string with a size (`size-*`, `h-* w-*`) or the display face
 *      or a title size is an icon / large text; anything else is text.
 * A pair that fails names the file, the classes and the ratio.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import { contrast, luminance } from './oklch'
import {
  CANVAS,
  DEFAULT_THEME,
  GRADE_COLORS,
  GRAPHIC_MIN,
  RAMPS,
  TEXT_MIN,
  THEME_NAMES,
  colorTokens,
  darkColorTokens,
  lightChromeTokens,
  worstContrastAt,
} from './palette'

const SRC = join(__dirname, '..')

/** Every colour token a class may name, as hex, in blue light mode (the
 * themes and dark mode are audited below with their own). */
let TOKENS: Record<string, string> = colorTokens(DEFAULT_THEME)

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** `fg` at `alpha` over the opaque `bg`. */
function blend(fg: string, alpha: number, bg: string): string {
  const a = hexToRgb(fg)
  const b = hexToRgb(bg)
  return `#${a.map((x, i) => Math.round(x * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`
}

/** A colour class value (`slate-500`, `white/70`) → [hex, alpha]. */
function resolve(value: string, tokens: Record<string, string> = TOKENS): [string, number] | null {
  const [name, opacity] = value.split('/')
  const hex = tokens[name]
  if (!hex) return null
  return [hex, opacity ? Number(opacity) / 100 : 1]
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !path.includes(`${join('src', 'design')}`) ? [path] : []
  })
}

/** Every string literal of a file that reads as a class list — className
 * attributes, the tone maps of the primitives, ternaries — with the
 * `${…}` holes of template literals cut out. */
function classStrings(source: string): string[] {
  const out: string[] = []
  for (const m of source.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)) {
    for (const part of (m[1] ?? m[2] ?? m[3]).split(/\$\{[^}]*\}/)) {
      if (/(^|\s)(?:[^\s:]+:)*(text|bg|fill|stroke)-[a-z]/.test(part)) out.push(part)
    }
  }
  return out
}

/** The dark surface a light colour with no background of its own sits on:
 * the sidebar, the navy header bars, else a primary button. */
function darkSurface(file: string): string {
  if (/layout[\\/](Sidebar|SidebarToggle|WorkspaceSwitcher)\.tsx$/.test(file)) return TOKENS['accent-800']
  if (/(PortalShell|PrintPage|ReportPage|LoginPage)\.tsx$/.test(file)) return TOKENS['accent-800']
  return TOKENS['accent-600']
}

/** The brand surfaces (data-brand-surface): in light mode a colour theme
 * draws them in its light chrome (palette.ts lightChromeTokens). */
const BRAND_SURFACE =
  /(layout[\\/](Sidebar|SidebarToggle|WorkspaceSwitcher)|PortalShell|LoginPage|HeroBand|CardStickyBar)\.tsx$/

/** Drawn in the light colours of their theme in every mode: the brand
 * surfaces (data-brand-surface) and paper (data-paper, the print routes). */
const LIGHT_ALWAYS =
  /((layout[\\/](Sidebar|SidebarToggle|WorkspaceSwitcher)|PortalShell|PrintPage|ReportPage|LoginPage|HeroBand|CardStickyBar|DocRenderer|CompareView)\.tsx|entities[\\/]report[\\/][^\\/]+\.tsx)$/

interface Finding {
  file: string
  classes: string
  pair: string
  ratio: number
  need: number
}

const VARIANT = /^(?:\[[^\]]*\]:|[a-z0-9@*_-]+(?:\[[^\]]*\])?:)*/
/** Variants whose state is not something a reader must read (WCAG exempts
 * disabled controls; placeholders are hints, checked by their own rule). */
const EXEMPT_VARIANTS = /(^|:)(disabled|placeholder|group-disabled|aria-disabled):/
/** White text on coloured badges (0089): set on <html> in light mode only
 * (src/lib/uiTheme.ts effectiveBadgeInk), so dark mode never draws it. Its
 * colours pair with the background under the same variant. */
const BADGE_WHITE = 'in-data-[badge-ink=white]:'
/** A variant that names its own background: an arbitrary structural one
 * (`[&_th]:`) or the badge ink. */
const pairsOwnBackground = (prefix: string) => prefix.startsWith('[') || prefix === BADGE_WHITE

/**
 * `light`: the colours of a theme in light mode. `dark`: its dark-mode
 * colours — then every file but the brand surfaces and paper (LIGHT_ALWAYS)
 * is drawn in them, and the surfaces mirror light mode's: a colour that is
 * light in light mode sits on the dark counterpart of its dark surface.
 */
function audit(
  light: Record<string, string> = TOKENS,
  dark?: Record<string, string>,
  chrome?: Record<string, string>,
): Finding[] {
  const findings: Finding[] = []
  for (const file of files(SRC)) {
    const source = readFileSync(file, 'utf8')
    TOKENS = dark && !LIGHT_ALWAYS.test(file) ? dark : chrome && BRAND_SURFACE.test(file) ? chrome : light
    for (const raw of classStrings(source)) {
      const tokens = raw.split(/\s+/).filter(Boolean)
      // The background a colour sits on: the one with the same structural
      // variant (`[&_th]:bg-…` for `[&_th]:text-…`), else the plain one.
      // State variants (hover:, focus:) never decide it.
      const bgOf = (prefix: string): [string, number] | undefined =>
        tokens
          .map((t) => {
            const at = t.lastIndexOf('bg-')
            if (at < 0 || t.slice(0, at) !== prefix) return null
            return resolve(t.slice(at + 3))
          })
          .filter((v): v is [string, number] => v !== null)
          .at(-1)
      const graphic =
        tokens.some((t) => /^(size|h)-\d/.test(t) && !t.startsWith('h-px')) ||
        tokens.includes('font-display') ||
        tokens.some((t) => /^text-(title|headline|display)$/.test(t))
      for (const token of tokens) {
        if (EXEMPT_VARIANTS.test(token)) continue
        if (dark && token.startsWith(BADGE_WHITE)) continue
        const base = token.replace(VARIANT, '')
        const prefix = token.slice(0, token.length - base.length)
        const last = bgOf(pairsOwnBackground(prefix) ? prefix : '') ?? bgOf('')
        const m = /^(text|fill|stroke)-([a-z0-9-]+(?:\/\d+)?)$/.exec(base)
        if (!m) continue
        const color = resolve(m[2])
        const inLight = resolve(m[2], light)
        if (!color || !inLight) continue
        const need = graphic || m[1] !== 'text' ? GRAPHIC_MIN : TEXT_MIN
        // No background of its own: a light colour sits on a dark surface,
        // anything else on white and on the canvas. A translucent background shows what is under it: under light text
        // the dark surface (a chip in the sidebar), under dark text white.
        const onDark = luminance(inLight[0]) > 0.4
        const own = last ? (last[1] < 1 ? blend(last[0], last[1], onDark ? darkSurface(file) : TOKENS.white) : last[0]) : null
        const surfaces = own ? [own] : onDark ? [darkSurface(file)] : [TOKENS.white, TOKENS.canvas]
        for (const surface of surfaces) {
          const fg = color[1] < 1 ? blend(color[0], color[1], surface) : color[0]
          const ratio = contrast(fg, surface)
          if (ratio + 1e-9 < need) {
            findings.push({ file: relative(SRC, file), classes: raw.trim(), pair: `${m[0]} on ${surface}`, ratio, need })
          }
        }
      }
    }
  }
  TOKENS = light
  return findings
}

describe('the palette keeps the pairing rule', () => {
  it('steps 5 apart read as text, 4 apart as icons and large text', () => {
    expect(worstContrastAt(5).ratio).toBeGreaterThanOrEqual(TEXT_MIN)
    expect(worstContrastAt(4).ratio).toBeGreaterThanOrEqual(GRAPHIC_MIN)
  })

  it('every grade reads: ink on its tint and on white, the solid on white', () => {
    for (const c of Object.values(GRADE_COLORS)) {
      expect(contrast(c.ink, c.tint)).toBeGreaterThanOrEqual(TEXT_MIN)
      expect(contrast(c.ink, '#ffffff')).toBeGreaterThanOrEqual(TEXT_MIN)
      expect(contrast(c.solid, '#ffffff')).toBeGreaterThanOrEqual(GRAPHIC_MIN)
    }
  })

  it('secondary text reads on the canvas', () => {
    expect(contrast(RAMPS.slate[500], CANVAS)).toBeGreaterThanOrEqual(TEXT_MIN)
  })
})

describe('every text and icon colour in use passes', () => {
  it('has no pair below 4.5 : 1 (text) or 3 : 1 (icons, large text)', () => {
    const findings = audit()
    expect(
      findings.map((f) => `${f.file}: ${f.pair} = ${f.ratio.toFixed(2)} < ${f.need} — "${f.classes}"`),
    ).toEqual([])
  })
})

describe('every colour theme, light and dark, passes too (0082)', () => {
  for (const theme of THEME_NAMES) {
    const light = colorTokens(theme)
    for (const mode of ['light', 'dark'] as const) {
      if (theme === DEFAULT_THEME && mode === 'light') continue
      it(`${theme} · ${mode}`, () => {
        const findings =
          mode === 'light'
            ? audit(light, undefined, theme === DEFAULT_THEME ? undefined : lightChromeTokens(theme))
            : audit(light, darkColorTokens(theme))
        expect(
          findings.map((f) => `${f.file}: ${f.pair} = ${f.ratio.toFixed(2)} < ${f.need} — "${f.classes}"`),
        ).toEqual([])
      })
    }
  }
})
