/**
 * What the dashboard says, decided in one pure place: the attention signals
 * (only the ones that are not zero, worst first) and the greeting.
 */

export type SignalTone = 'neg' | 'warn' | 'info'

export interface Signal {
  key:
    | 'overduesLate'
    | 'escalatedLimits'
    | 'declarationsDisputed'
    | 'claimsAwaitingInfo'
    | 'declarationsAwaiting'
  count: number
  tone: SignalTone
  to: string
}

export interface SignalInput {
  /** null = the caller's roles do not see this queue. */
  overduesLate: number | null
  escalatedLimits: number | null
  declarationsDisputed: number | null
  claimsAwaitingInfo: number | null
  declarationsAwaiting: number | null
}

const DEFS: { key: Signal['key']; tone: SignalTone; to: string }[] = [
  { key: 'overduesLate', tone: 'neg', to: '/overdues' },
  { key: 'escalatedLimits', tone: 'neg', to: '/limits?tab=escalated' },
  { key: 'declarationsDisputed', tone: 'warn', to: '/declarations' },
  { key: 'claimsAwaitingInfo', tone: 'warn', to: '/claims' },
  { key: 'declarationsAwaiting', tone: 'info', to: '/declarations' },
]

/** Non-zero signals in severity order; an empty list means "all clear". */
export function buildSignals(input: SignalInput): Signal[] {
  return DEFS.flatMap((def) => {
    const count = input[def.key]
    return count ? [{ ...def, count }] : []
  })
}

export type DayPart = 'morning' | 'day' | 'evening'

/** Greeting by the hour in Tashkent, where the users are. */
export function dayPart(now: Date): DayPart {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Tashkent' }).format(now),
  )
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'day'
  return 'evening'
}

/** The grade scale, best first (credit_engine's A1 … D). */
export const MIX_GRADES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D'] as const

/** How many rated companies sit in each grade of the scale — every grade
 * listed, zero included, so the bars always read against the same axis.
 * A code outside the scale is not counted. */
export function gradeMix(grades: Iterable<string>): { grade: (typeof MIX_GRADES)[number]; count: number }[] {
  const counts = new Map<string, number>(MIX_GRADES.map((g) => [g, 0]))
  for (const raw of grades) {
    const g = raw.trim().toUpperCase()
    const key = counts.has(g) ? g : g.startsWith('D') ? 'D' : null
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return MIX_GRADES.map((grade) => ({ grade, count: counts.get(grade) ?? 0 }))
}
