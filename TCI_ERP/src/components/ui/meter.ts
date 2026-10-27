/**
 * The arithmetic of a meter: how full a bar is and what that means.
 *
 * A meter shows one figure against a cap (an amount against an authority, a
 * group's exposure against its limit). The words beside it carry the
 * meaning; the tone repeats it in colour, never alone (WCAG 1.4.1).
 */

export type MeterTone = 'ok' | 'near' | 'over' | 'unknown'

/** From this share of the cap on, a meter reads «near» (amber). */
export const METER_NEAR = 0.9

/** How far the filled part reaches, 0…1 of the track, and how it reads.
 * Over the cap the bar is full and the overshoot is told in words; a cap of
 * zero (no authority at all) is «over» for any positive value. */
export function meterState(
  value: number | null,
  cap: number | null,
  near = METER_NEAR,
): { fill: number; ratio: number | null; tone: MeterTone } {
  if (value === null || cap === null || !Number.isFinite(value) || !Number.isFinite(cap)) {
    return { fill: 0, ratio: null, tone: 'unknown' }
  }
  if (cap <= 0) {
    return value > 0 ? { fill: 1, ratio: null, tone: 'over' } : { fill: 0, ratio: 0, tone: 'ok' }
  }
  const ratio = value / cap
  const fill = Math.max(0, Math.min(1, ratio))
  const tone: MeterTone = ratio > 1 ? 'over' : ratio >= near ? 'near' : 'ok'
  return { fill, ratio, tone }
}

/** Positions on one shared scale for the requested → decided bar: every
 * figure as a share of the largest, so the bars compare by length. Nulls
 * stay null (not drawn). */
export function scaleFigures<K extends string>(
  figures: Record<K, number | null>,
): { max: number; share: Record<K, number | null> } {
  const values = Object.values<number | null>(figures).filter(
    (v): v is number => v !== null && Number.isFinite(v) && v > 0,
  )
  const max = values.length ? Math.max(...values) : 0
  const share = {} as Record<K, number | null>
  for (const key of Object.keys(figures) as K[]) {
    const v = figures[key]
    share[key] = v === null || !Number.isFinite(v) || max <= 0 ? null : Math.max(0, v) / max
  }
  return { max, share }
}
