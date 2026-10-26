/**
 * A simple status timeline (Prompt 30, the client portal): a few named steps
 * on a line, those passed checked, the current one marked — with its name in
 * words, never by colour alone. Steps are passed in order; `current` is the
 * index of the step the object is on.
 */

import { Check } from 'lucide-react'

export function StatusTimeline({
  steps,
  current,
  attention = false,
  label,
}: {
  steps: readonly string[]
  current: number
  /** The current step waits on the reader (their answer): amber, not blue. */
  attention?: boolean
  label: string
}) {
  return (
    <ol aria-label={label} className="flex w-full items-start" data-status-timeline>
      {steps.map((step, i) => {
        const done = i < current
        const here = i === current
        return (
          <li
            key={step}
            aria-current={here ? 'step' : undefined}
            className="relative flex min-w-0 flex-1 flex-col items-center gap-2 text-center"
          >
            {/* the line to the previous step */}
            {i > 0 && (
              <span
                aria-hidden
                className={`absolute top-3 right-1/2 left-[-50%] h-0.5 ${i <= current ? 'bg-success-500' : 'bg-slate-200'}`}
              />
            )}
            <span
              aria-hidden
              className={`relative z-[1] flex size-6 items-center justify-center rounded-full border-2 ${
                done
                  ? 'border-success-500 bg-success-500 text-white'
                  : here
                    ? attention
                      ? 'border-warning-500 bg-warning-50'
                      : 'border-accent-600 bg-accent-50'
                    : 'border-slate-300 bg-white'
              }`}
            >
              {done && <Check className="size-4" strokeWidth={3} />}
              {here && (
                <span className={`size-2 rounded-full ${attention ? 'bg-warning-500' : 'bg-accent-600'}`} />
              )}
            </span>
            <span
              className={`text-caption leading-tight ${
                here ? 'font-semibold text-slate-900' : done ? 'text-slate-700' : 'text-slate-500'
              }`}
            >
              {step}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
