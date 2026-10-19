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
