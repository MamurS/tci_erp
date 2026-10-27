/**
 * Key figures with context (Prompt 30, phase 2) — pure helpers of KpiCard:
 * the change against a stated baseline and its colour, and a sparkline path.
 *
 * Colour follows MEANING, not direction (DESIGN.md «dynamics colouring is
 * direction-aware»): more claims is bad, more premium is good. A figure with
 * no good direction is neutral. No baseline, or a zero one, shows no change —
 * never a made-up percentage.
 */

export type GoodDirection = 'up' | 'down' | 'none'

export interface KpiDelta {
  /** Signed change as a fraction (0.042 = +4.2 %). */
  ratio: number
  direction: 'up' | 'down' | 'flat'
  tone: 'pos' | 'neg' | 'neutral'
}

/** Changes smaller than this read as flat (rounding noise, not a move). */
const FLAT = 0.0005

export function kpiDelta(
  current: number | null,
  baseline: number | null,
  good: GoodDirection,
): KpiDelta | null {
  if (
    current === null ||
    baseline === null ||
    !Number.isFinite(current) ||
    !Number.isFinite(baseline)
  )
    return null
  if (baseline === 0) return null
  const ratio = (current - baseline) / Math.abs(baseline)
  const direction = Math.abs(ratio) < FLAT ? 'flat' : ratio > 0 ? 'up' : 'down'
  const tone =
    direction === 'flat' || good === 'none' ? 'neutral' : direction === good ? 'pos' : 'neg'
  return { ratio, direction, tone }
}

/** An SVG polyline path through the points, scaled into width × height with
 * a 1-unit inset; null for fewer than two finite points. A flat series sits
 * on the middle line. */
export function sparklinePath(
  points: readonly (number | null)[],
  width = 80,
  height = 24,
): string | null {
  const values = points.filter((p): p is number => p !== null && Number.isFinite(p))
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min
  const step = (width - 2) / (values.length - 1)
  return values
    .map((v, i) => {
      const x = 1 + i * step
      const y = span === 0 ? height / 2 : 1 + (1 - (v - min) / span) * (height - 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')
}

/** How many of the dated records existed at the start of each of the last
 * `months` calendar months and now (oldest first, `months + 1` values) — the
 * honest trend of a running count whose records are never deleted (a
 * register). The second-to-last value is the count at the start of this
 * month: the baseline «vs start of month». */
export function runningCountByMonth(createdAt: readonly string[], now: Date, months = 6): number[] {
  const times = createdAt.map((d) => Date.parse(d)).filter((n) => Number.isFinite(n))
  const out: number[] = []
  for (let k = months - 1; k >= 0; k--) {
    const start = new Date(now.getFullYear(), now.getMonth() - k, 1).getTime()
    out.push(times.filter((t) => t < start).length)
  }
  out.push(times.filter((t) => t <= now.getTime()).length)
  return out
}
