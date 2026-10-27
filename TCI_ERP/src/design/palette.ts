/**
 * The colour system (Prompt 30, docs/design-research-2026-10.md): every ramp
 * is built in OKLCH with ten steps (50 … 900), and every step of every hue
 * has the SAME WCAG relative luminance (`STEP_LUMINANCE`) — so a pair that
 * passes for one hue passes for all, and the pairing rule holds by
 * construction:
 *
 *   * text: steps at least 5 apart (≥ 4.5 : 1);
 *   * icons, large text, graphics: steps at least 4 apart (≥ 3 : 1);
 *   * white and the page canvas count as step 50.
 *
 * Each step's lightness is solved for that luminance at the step's chroma
 * (gamut-mapped), so the ramps stay as vivid as sRGB allows while the
 * contrast is exact. `contrast.test.ts` proves the rule for every ramp, and
 * `tokens.test.ts` keeps `tokens.css` (the Tailwind `@theme`) generated from
 * this file — edit here, then `npm run design:tokens`.
 */

import { contrast, cssOklch, hexToOklch, luminance, oklchToHex } from './oklch.ts'

export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const
export type Step = (typeof STEPS)[number]

/** The target relative luminance of each step (index = position in STEPS).
 * Chosen so that (Yᵢ + 0.05) / (Yᵢ₊₅ + 0.05) ≥ 4.5 and
 * (Yᵢ + 0.05) / (Yᵢ₊₄ + 0.05) ≥ 3 for every i. */
export const STEP_LUMINANCE = [0.955, 0.885, 0.76, 0.58, 0.26, 0.16, 0.112, 0.073, 0.044, 0.015] as const

/** How much of a ramp's peak chroma each step carries: tints and shades
 * quieter, the middle vivid. */
const CHROMA_SHAPE = [0.12, 0.3, 0.55, 0.8, 1, 1, 0.92, 0.82, 0.7, 0.58] as const

interface RampSpec {
  /** OKLCH hue in degrees. */
  hue: number
  /** Peak chroma (reached at steps 400–500 when sRGB allows). */
  chroma: number
  /** What the ramp is for — shown on the token page and in DESIGN.md. */
  role: string
}

/** The ramps. Class names: `slate` is the warm NEUTRAL (the Tailwind name
 * is kept so the existing classes re-colour), `accent` the navy BRAND,
 * `sky` the secondary brand blue of the «TCI» logo. */
export const RAMP_SPECS = {
  slate: { hue: 70, chroma: 0.012, role: 'neutral — backgrounds, text, borders' },
  accent: { hue: 250, chroma: 0.13, role: 'brand navy — primary actions, selection, titles' },
  sky: { hue: 232, chroma: 0.17, role: 'secondary brand — links, focus, highlights' },
  success: { hue: 155, chroma: 0.17, role: 'semantic — success, growth, approved' },
  warning: { hue: 70, chroma: 0.17, role: 'semantic — warning, attention, due soon' },
  danger: { hue: 27, chroma: 0.22, role: 'semantic — error, loss, overdue, declined' },
  info: { hue: 262, chroma: 0.16, role: 'semantic — information, neutral notice' },
  violet: { hue: 300, chroma: 0.17, role: 'data — categorical' },
  teal: { hue: 190, chroma: 0.14, role: 'data — categorical' },
  magenta: { hue: 345, chroma: 0.18, role: 'data — categorical' },
} as const satisfies Record<string, RampSpec>

export type RampName = keyof typeof RAMP_SPECS
export type Ramp = Record<Step, string>

/** The darkest-to-lightest search for the lightness that gives a target
 * luminance at a chroma and hue. */
function solveStep(targetY: number, chroma: number, hue: number): string {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (luminance(oklchToHex({ l: mid, c: chroma, h: hue })) < targetY) lo = mid
    else hi = mid
  }
  return oklchToHex({ l: (lo + hi) / 2, c: chroma, h: hue })
}

export function buildRamp(spec: Pick<RampSpec, 'hue' | 'chroma'>): Ramp {
  return Object.fromEntries(
    STEPS.map((step, i) => [step, solveStep(STEP_LUMINANCE[i], spec.chroma * CHROMA_SHAPE[i], spec.hue)]),
  ) as Ramp
}

export const RAMPS: Record<RampName, Ramp> = Object.fromEntries(
  Object.entries(RAMP_SPECS).map(([name, spec]) => [name, buildRamp(spec)]),
) as Record<RampName, Ramp>

/** The page canvas: a faint warm grey between neutral 50 and 100, light
 * enough that neutral 500 still reads at 4.5 : 1 on it (checked). */
export const CANVAS = solveStep(0.93, RAMP_SPECS.slate.chroma * 0.2, RAMP_SPECS.slate.hue)

// ---------------------------------------------------------------------------
// The grade scale A1 → D: diverging teal → green → yellow → amber → red. Each
// grade has a TINT (badge background, step 100), a SOLID (bars, dots, chart
// marks, step 400 — ≥ 3 : 1 on white) and an INK (text on the tint or on
// white, step 600 — ≥ 4.5 : 1 on both).
// ---------------------------------------------------------------------------

export const GRADE_SPECS = {
  A1: { hue: 185, chroma: 0.15 },
  A2: { hue: 150, chroma: 0.17 },
  B1: { hue: 125, chroma: 0.16 },
  B2: { hue: 95, chroma: 0.16 },
  C1: { hue: 70, chroma: 0.17 },
  C2: { hue: 48, chroma: 0.19 },
  D: { hue: 27, chroma: 0.22 },
} as const

export type GradeKey = keyof typeof GRADE_SPECS

export interface GradeColors {
  tint: string
  solid: string
  ink: string
}

export const GRADE_COLORS: Record<GradeKey, GradeColors> = Object.fromEntries(
  Object.entries(GRADE_SPECS).map(([grade, spec]) => {
    const ramp = buildRamp(spec)
    return [grade, { tint: ramp[100], solid: ramp[400], ink: ramp[600] }]
  }),
) as Record<GradeKey, GradeColors>

// ---------------------------------------------------------------------------
// Data palettes
// ---------------------------------------------------------------------------

/** Categorical series in a fixed order chosen so that neighbours differ in
 * hue by at least ~60°: navy, amber, teal, magenta, sky, success, violet,
 * danger. All at step 400 (≥ 3 : 1 on white). */
export const CATEGORICAL: readonly string[] = [
  RAMPS.accent[400],
  RAMPS.warning[400],
  RAMPS.teal[400],
  RAMPS.magenta[400],
  RAMPS.sky[400],
  RAMPS.success[400],
  RAMPS.violet[400],
  RAMPS.danger[400],
]

/** Sequential (magnitude): one hue, light to dark — the sky ramp 100 … 900. */
export const SEQUENTIAL: readonly string[] = STEPS.slice(1).map((s) => RAMPS.sky[s])

// ---------------------------------------------------------------------------
// The pairing rule
// ---------------------------------------------------------------------------

export const TEXT_MIN = 4.5
export const GRAPHIC_MIN = 3

/** The smallest contrast any two steps `distance` apart reach, over every
 * ramp (and the canvas and white as step 50). */
export function worstContrastAt(distance: number): { ratio: number; where: string } {
  let worst = { ratio: Infinity, where: '' }
  for (const [name, ramp] of Object.entries(RAMPS)) {
    for (let i = 0; i + distance < STEPS.length; i++) {
      const pairs: [string, string, string][] = [[ramp[STEPS[i]], ramp[STEPS[i + distance]], `${name}-${STEPS[i]}/${STEPS[i + distance]}`]]
      if (i === 0) {
        pairs.push(['#ffffff', ramp[STEPS[distance]], `white/${name}-${STEPS[distance]}`])
        pairs.push([CANVAS, ramp[STEPS[distance]], `canvas/${name}-${STEPS[distance]}`])
      }
      for (const [a, b, where] of pairs) {
        const ratio = contrast(a, b)
        if (ratio < worst.ratio) worst = { ratio, where }
      }
    }
  }
  return worst
}

// ---------------------------------------------------------------------------
// Type, space, radius, elevation, motion
// ---------------------------------------------------------------------------

/** The type scale: 12 / 13 / 14 / 16 / 20 / 28 / 36 px, in rem (the zoom
 * multiplies them with everything else — 0076; the text size multiplies
 * them alone — 0081, `textSized`). Name → [size, line height]. */
export const TYPE_SCALE = {
  caption: ['0.75rem', '1rem'],
  small: ['0.8125rem', '1.125rem'],
  body: ['0.875rem', '1.25rem'],
  lead: ['1rem', '1.5rem'],
  title: ['1.25rem', '1.75rem'],
  headline: ['1.75rem', '2.125rem'],
  display: ['2.25rem', '2.5rem'],
} as const

/** A type token at the person's text size: `--ui-text` is set on <html>
 * (1 = as designed; uiScale.ts). */
export function textSized(size: string): string {
  return `calc(${size} * var(--ui-text, 1))`
}

/** The spacing steps a layout may use (4 px grid; 2 px only for hairline
 * offsets). Tailwind's own spacing unit stays 0.25rem. */
export const SPACING_STEPS = [0.5, 1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20] as const

export const RADII = { sm: '0.25rem', md: '0.375rem', lg: '0.5rem', xl: '0.75rem' } as const

/** Fewer shadows: a hairline lift at rest, a soft one for overlays. */
export const SHADOWS = {
  card: '0 1px 2px 0 rgb(40 34 26 / 0.04)',
  pop: '0 10px 28px -8px rgb(24 20 14 / 0.18), 0 3px 8px -4px rgb(24 20 14 / 0.10)',
} as const

/** Motion (IBM Carbon): productive for task work, expressive for rare
 * moments. Easings: standard, entrance (ease-out), exit (ease-in). */
export const MOTION = {
  durations: {
    'fast-01': '70ms',
    'fast-02': '110ms',
    'moderate-01': '150ms',
    'moderate-02': '240ms',
    'slow-01': '400ms',
  },
  easings: {
    'productive-standard': 'cubic-bezier(0.2, 0, 0.38, 0.9)',
    'productive-entrance': 'cubic-bezier(0, 0, 0.38, 0.9)',
    'productive-exit': 'cubic-bezier(0.2, 0, 1, 0.9)',
    'expressive-standard': 'cubic-bezier(0.4, 0.14, 0.3, 1)',
    'expressive-entrance': 'cubic-bezier(0, 0, 0.3, 1)',
    'expressive-exit': 'cubic-bezier(0.4, 0.14, 1, 1)',
  },
} as const

// ---------------------------------------------------------------------------
// Aliases kept for the existing classes (pos / neg / warn)
// ---------------------------------------------------------------------------

export const ALIASES: Record<string, string> = {
  'pos-50': RAMPS.success[50],
  'pos-500': RAMPS.success[500],
  'neg-50': RAMPS.danger[50],
  'neg-500': RAMPS.danger[500],
  'neg-600': RAMPS.danger[600],
  'warn-50': RAMPS.warning[50],
  'warn-500': RAMPS.warning[500],
  // The earlier brand names, now pointing into the system.
  'brand-navy': RAMPS.accent[800],
  'brand-blue': RAMPS.sky[400],
  'brand-orange': GRADE_COLORS.C2.solid,
  'brand-amber': RAMPS.warning[300],
  ink: RAMPS.slate[900],
  'ink-muted': RAMPS.slate[600],
}

// ---------------------------------------------------------------------------
// The generated @theme
// ---------------------------------------------------------------------------

export function renderTokensCss(): string {
  const lines: string[] = [
    '/* GENERATED by src/design/palette.ts — do not edit; run `npm run design:tokens`. */',
    '/* Values in sRGB hex; the OKLCH each was solved from is in the comment. */',
    '@theme {',
    '  /* Tailwind\'s own palettes are not part of this system. */',
    '  --color-*: initial;',
    '  --color-white: #ffffff;',
    '  --color-black: #000000;',
    '  --color-transparent: transparent;',
    '  --color-current: currentColor;',
    `  --color-canvas: ${CANVAS};`,
  ]
  for (const [name, ramp] of Object.entries(RAMPS)) {
    lines.push(`  /* ${name}: ${RAMP_SPECS[name as RampName].role} */`)
    for (const step of STEPS) {
      lines.push(`  --color-${name}-${step}: ${ramp[step]}; /* ${cssOklch(hexToOklch(ramp[step]))} */`)
    }
  }
  lines.push('  /* Aliases of the earlier names (positive / negative / warning). */')
  for (const [alias, hex] of Object.entries(ALIASES)) lines.push(`  --color-${alias}: ${hex};`)
  lines.push('  /* The grade scale A1 → D: tint, solid, ink. */')
  for (const [grade, colors] of Object.entries(GRADE_COLORS)) {
    const key = grade.toLowerCase()
    lines.push(`  --color-grade-${key}-tint: ${colors.tint};`)
    lines.push(`  --color-grade-${key}: ${colors.solid};`)
    lines.push(`  --color-grade-${key}-ink: ${colors.ink};`)
  }
  lines.push('  /* The five-colour presentation gauge (ratingScale.ts) reads the grade solids. */')
  ;(['A1', 'B1', 'B2', 'C2', 'D'] as const).forEach((g, i) => lines.push(`  --color-scale-${i + 1}: ${GRADE_COLORS[g].solid};`))
  lines.push('  /* Data palettes. */')
  CATEGORICAL.forEach((hex, i) => lines.push(`  --color-data-${i + 1}: ${hex};`))
  SEQUENTIAL.forEach((hex, i) => lines.push(`  --color-seq-${i + 1}: ${hex};`))
  lines.push('')
  lines.push('  /* The person\'s text size (uiScale.ts, 0081) multiplies the type only. */')
  for (const [name, [size, lineHeight]] of Object.entries(TYPE_SCALE)) {
    lines.push(`  --text-${name}: ${textSized(size)};`)
    lines.push(`  --text-${name}--line-height: ${textSized(lineHeight)};`)
  }
  lines.push('')
  for (const [name, value] of Object.entries(RADII)) lines.push(`  --radius-${name}: ${value};`)
  for (const [name, value] of Object.entries(SHADOWS)) lines.push(`  --shadow-${name}: ${value};`)
  lines.push('')
  for (const [name, value] of Object.entries(MOTION.durations)) lines.push(`  --duration-${name}: ${value};`)
  for (const [name, value] of Object.entries(MOTION.easings)) lines.push(`  --ease-${name}: ${value};`)
  lines.push('  /* Every `transition-*` utility is productive by default. */')
  lines.push(`  --default-transition-duration: ${MOTION.durations['fast-02']};`)
  lines.push(`  --default-transition-timing-function: ${MOTION.easings['productive-standard']};`)
  lines.push('}')
  return `${lines.join('\n')}\n`
}

/** Hex → WCAG luminance, re-exported for the token page. */
export { contrast, luminance }
