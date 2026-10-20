/**
 * The presentation scale of the credit rating score: ten bands from 10
 * (exceptional) to 100 (insolvent), lower is better — the legend of the
 * reference risk reports. It DESCRIBES the engine's 1–100 score; it does not
 * replace the engine's grade bands (A1…D), which still drive authority and
 * the limit coefficient (GET /grade-scale stays their single source).
 *
 * Pure module: no React, fully unit-tested.
 */

export const SCALE_POINTS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const
export type ScalePoint = (typeof SCALE_POINTS)[number]

/** i18n keys under rating.scale10.* — one per legend point. */
export const SCALE_LABEL_KEYS: Record<ScalePoint, string> = {
  10: 'exceptional',
  20: 'veryStrong',
  30: 'strong',
  40: 'good',
  50: 'average',
  60: 'watch',
  70: 'weak',
  80: 'distressed',
  90: 'uninsurable',
  100: 'insolvent',
}

/** Five colours, used in pairs (10/20, 30/40, …), measured from the reference. */
export const SCALE_COLORS = ['#17b81a', '#a6c419', '#f2a900', '#f2661a', '#ee1c1c'] as const

export function colorForPoint(point: ScalePoint): string {
  return SCALE_COLORS[Math.floor((point - 10) / 20)]
}

/** Colour of an arbitrary score: the colour of the band it falls in. */
export function colorForScore(score: number): string {
  const point = Math.min(100, Math.max(10, Math.ceil(score / 10) * 10)) as ScalePoint
  return colorForPoint(point)
}

export function clampScore(score: number): number {
  return Math.min(100, Math.max(0, score))
}

/**
 * Where a score sits on the ten-point legend, in words — the reference's
 * rule ("Rating 72 (Weak band)", "Rating 78 (between Weak and Distressed)"):
 *  - in the first half of a decade (offset < 5 from its legend point) →
 *    that band;
 *  - in the second half → between that point and the next one.
 * Anything below 10 is the first band; 100 is the last.
 */
export type ScalePlacement =
  | { kind: 'in'; point: ScalePoint }
  | { kind: 'between'; lower: ScalePoint; upper: ScalePoint }

export function placeScore(score: number): ScalePlacement {
  const s = clampScore(score)
  if (s < 10) return { kind: 'in', point: 10 }
  if (s >= 100) return { kind: 'in', point: 100 }
  const lower = (Math.floor(s / 10) * 10) as ScalePoint
  if (s - lower < 5) return { kind: 'in', point: lower }
  return { kind: 'between', lower, upper: (lower + 10) as ScalePoint }
}

/** Rating change vs the previous assessment. Up = worse on this scale. */
export interface ScoreChange {
  delta: number
  direction: 'better' | 'worse' | 'same'
}

export function scoreChange(current: number, previous: number | null | undefined): ScoreChange | null {
  if (previous === null || previous === undefined || !Number.isFinite(previous)) return null
  const delta = Math.round((current - previous) * 10) / 10
  if (Math.abs(delta) < 0.05) return { delta: 0, direction: 'same' }
  return { delta, direction: delta > 0 ? 'worse' : 'better' }
}

/** Gauge geometry: angle in degrees for a score, 180° (left, 0) → 0° (right, 100). */
export function gaugeAngle(score: number): number {
  return 180 - (clampScore(score) / 100) * 180
}
