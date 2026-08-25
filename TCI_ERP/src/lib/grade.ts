/** Single source of truth for grade -> semantic tone (DESIGN.md palette). */

export type GradeTone = 'pos' | 'accent' | 'warn' | 'neg'

export function gradeTone(grade: string): GradeTone {
  if (grade.startsWith('A')) return 'pos'
  if (grade.startsWith('B')) return 'accent'
  if (grade.startsWith('C')) return 'warn'
  return 'neg'
}
