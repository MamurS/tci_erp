/** The grades of the rating scale, best first — for choosing a grade by hand
 * (a manual rating, another grade at confirmation, a group rating).
 *
 * The scale's single source of truth is credit_engine's GRADE_BANDS, served
 * by the analytics service (GET /grade-scale, `useGradeScale`). While the
 * service is not hosted the screens still need the list, so it is mirrored
 * here and contract-tested against the engine's own table: a grade added or
 * renamed there fails `gradeCatalogue.test.ts` until this follows. The
 * served scale wins whenever it answers. Zone boundaries and families stay
 * the service's (never hardcoded). */

import type { GradeBand } from './gradeScale'

export const GRADE_CODES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D'] as const
export type GradeCode = (typeof GRADE_CODES)[number]

export function isGradeCode(value: string): value is GradeCode {
  return (GRADE_CODES as readonly string[]).includes(value)
}

/** The grades to offer: the served scale when it answers, else the mirror. */
export function gradeCodes(bands: GradeBand[] | undefined): string[] {
  return bands?.length ? bands.map((b) => b.code) : [...GRADE_CODES]
}
