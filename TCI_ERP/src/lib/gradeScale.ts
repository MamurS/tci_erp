/** Grade scale data: zone boundaries come from the analytics service
 * (GET /grade-scale, single source of truth in credit_engine) — never
 * hardcoded here. Pure zone math lives here for testability. */

import { useQuery } from '@tanstack/react-query'

const ANALYTICS_URL: string =
  import.meta.env.VITE_ANALYTICS_API_URL ?? 'http://localhost:8000'

export interface GradeBand {
  code: string
  label_key: string
  lower: number
  upper: number
  risk_coefficient: number
}

export function useGradeScale() {
  return useQuery({
    queryKey: ['grade-scale'],
    staleTime: Infinity,
    retry: 1,
    queryFn: async (): Promise<GradeBand[]> => {
      const response = await fetch(`${ANALYTICS_URL}/grade-scale`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return (await response.json()) as GradeBand[]
    },
  })
}

export interface ZoneSegment {
  band: GradeBand
  /** Left offset and width as percentages of the full scale. */
  leftPct: number
  widthPct: number
}

/** Convert bands into renderable segments (percent of the 0-100 scale). */
export function zoneSegments(bands: GradeBand[]): ZoneSegment[] {
  return bands.map((band) => ({
    band,
    leftPct: band.lower,
    widthPct: band.upper - band.lower,
  }))
}

/** Marker position for a score, clamped to the scale. */
export function scorePosition(score: number): number {
  return Math.min(100, Math.max(0, score))
}

/** Band a score falls into (upper bound inclusive, like the engine). */
export function bandForScore(bands: GradeBand[], score: number): GradeBand | null {
  return bands.find((b) => score <= b.upper) ?? bands[bands.length - 1] ?? null
}

export interface GradeChange {
  scoreDelta: number
  gradeSteps: number
  /** Lower score is better on this scale. */
  improved: boolean
}

/** Change vs a previous assessment (null when equal). */
export function gradeChange(
  bands: GradeBand[],
  current: { score: number; grade: string },
  previous: { score: number; grade: string },
): GradeChange | null {
  const scoreDelta = current.score - previous.score
  const index = (grade: string) => bands.findIndex((b) => b.code === grade)
  const gradeSteps = index(current.grade) - index(previous.grade)
  if (Math.abs(scoreDelta) < 0.05 && gradeSteps === 0) return null
  return { scoreDelta, gradeSteps, improved: scoreDelta < 0 }
}
