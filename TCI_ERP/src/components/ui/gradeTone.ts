/** The badge classes of a grade: pastel by default — its tint, its deep ink
 * and its hairline from the grade scale (tokens `grade-a1-tint` /
 * `grade-a1-deep` / `grade-a1-line` …) — or, with white text on coloured
 * badges (0089, a person's choice), the ink as the fill behind white. Literal class
 * names, so Tailwind generates them. */
const GRADE_BADGE: Record<string, string> = {
  A1: 'bg-grade-a1-tint text-grade-a1-deep ring-grade-a1-line in-data-[badge-ink=white]:bg-grade-a1-ink in-data-[badge-ink=white]:text-white in-data-[badge-ink=white]:ring-grade-a1-ink',
  A2: 'bg-grade-a2-tint text-grade-a2-deep ring-grade-a2-line in-data-[badge-ink=white]:bg-grade-a2-ink in-data-[badge-ink=white]:text-white in-data-[badge-ink=white]:ring-grade-a2-ink',
  B1: 'bg-grade-b1-tint text-grade-b1-deep ring-grade-b1-line in-data-[badge-ink=white]:bg-grade-b1-ink in-data-[badge-ink=white]:text-white in-data-[badge-ink=white]:ring-grade-b1-ink',
  B2: 'bg-grade-b2-tint text-grade-b2-deep ring-grade-b2-line in-data-[badge-ink=white]:bg-grade-b2-ink in-data-[badge-ink=white]:text-white in-data-[badge-ink=white]:ring-grade-b2-ink',
  C1: 'bg-grade-c1-tint text-grade-c1-deep ring-grade-c1-line in-data-[badge-ink=white]:bg-grade-c1-ink in-data-[badge-ink=white]:text-white in-data-[badge-ink=white]:ring-grade-c1-ink',
  C2: 'bg-grade-c2-tint text-grade-c2-deep ring-grade-c2-line in-data-[badge-ink=white]:bg-grade-c2-ink in-data-[badge-ink=white]:text-white in-data-[badge-ink=white]:ring-grade-c2-ink',
  D: 'bg-grade-d-tint text-grade-d-deep ring-grade-d-line in-data-[badge-ink=white]:bg-grade-d-ink in-data-[badge-ink=white]:text-white in-data-[badge-ink=white]:ring-grade-d-ink',
}

/** The solid of a grade, for bars, dots and chart marks. */
const GRADE_SOLID: Record<string, string> = {
  A1: 'bg-grade-a1',
  A2: 'bg-grade-a2',
  B1: 'bg-grade-b1',
  B2: 'bg-grade-b2',
  C1: 'bg-grade-c1',
  C2: 'bg-grade-c2',
  D: 'bg-grade-d',
}

/** The scale's grade a code belongs to: A1 … D, or a family letter's first
 * grade for a bare «A» … «C». */
export function gradeKey(grade: string): string | null {
  const g = grade.trim().toUpperCase()
  if (g in GRADE_BADGE) return g
  if (/^[ABC]$/.test(g)) return `${g}1`
  return g.startsWith('D') ? 'D' : null
}

export function gradeBadgeTone(grade: string): string {
  const key = gradeKey(grade)
  return key ? GRADE_BADGE[key] : 'bg-slate-100 text-slate-700'
}

export function gradeSolid(grade: string): string {
  const key = gradeKey(grade)
  return key ? GRADE_SOLID[key] : 'bg-slate-400'
}
