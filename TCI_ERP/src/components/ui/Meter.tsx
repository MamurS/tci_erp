/**
 * A meter: one figure against a cap, as a bar with words.
 *
 * Used where a decision is measured against a limit — the decider's
 * authority, a group's limit. The label says what is measured, the figure
 * on the right says how much of what, and the note says what it means; the
 * colour repeats the note (ok / near / over), never replaces it. An optional
 * `base` draws what was already there in neutral, so the part THIS decision
 * adds stands out in the tone colour.
 */

import type { ReactNode } from 'react'

import { meterState } from './meter'
import type { MeterTone } from './meter'

const FILL: Record<MeterTone, string> = {
  ok: 'bg-success-500',
  near: 'bg-warning-400',
  over: 'bg-danger-500',
  unknown: 'bg-slate-300',
}

const NOTE: Record<MeterTone, string> = {
  ok: 'text-slate-600',
  near: 'text-warning-700',
  over: 'text-danger-700',
  unknown: 'text-slate-600',
}

export interface MeterProps {
  label: ReactNode
  /** What is measured, in the cap's unit. */
  value: number | null
  /** The cap; null when it cannot be known (no rate, no limit). */
  cap: number | null
  /** What was already used before this decision (same unit), drawn neutral. */
  base?: number | null
  /** «150,000 of 2,000,000 UZS» — the figures in words. */
  figure?: ReactNode
  /** What the reading means, in words (colour is never alone). */
  note?: ReactNode
  /** A tone decided elsewhere (e.g. the database's own comparison). */
  tone?: MeterTone
}

export function Meter({ label, value, cap, base = null, figure, note, tone }: MeterProps) {
  const state = meterState(value, cap)
  const reading = tone ?? state.tone
  const baseFill =
    base !== null && cap !== null && cap > 0 ? Math.max(0, Math.min(state.fill, base / cap)) : 0
  return (
    <div className="flex flex-col gap-2" data-meter={reading}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-small font-medium text-slate-700">{label}</span>
        {figure && <span className="num text-small text-slate-600">{figure}</span>}
      </div>
      <div
        className="relative h-2 overflow-hidden rounded-full bg-slate-100"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={cap ?? undefined}
        aria-valuenow={value ?? undefined}
      >
        <div
          className={`absolute inset-y-0 left-0 rounded-full ${FILL[reading]}`}
          style={{ width: `${state.fill * 100}%` }}
        />
        {baseFill > 0 && (
          <div
            className="absolute inset-y-0 left-0 rounded-l-full bg-slate-400"
            style={{ width: `${baseFill * 100}%` }}
          />
        )}
      </div>
      {note && <p className={`text-caption ${NOTE[reading]}`}>{note}</p>}
    </div>
  )
}
