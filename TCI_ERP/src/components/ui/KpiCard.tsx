/**
 * A key figure with context (Prompt 30, phase 2): the number is the hero
 * (display face), its unit smaller beside it, the label small above; under
 * it the change against a STATED baseline (▲ 4.2 % vs last month — arrow AND
 * words, never colour alone) and a sparkline of the recent values. A card is
 * a link when it leads somewhere.
 */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { formatPercent } from '../../lib/format'
import { kpiDelta, sparklinePath } from './kpi'
import type { GoodDirection } from './kpi'

const DELTA_TONES = {
  pos: 'text-success-600',
  neg: 'text-danger-600',
  neutral: 'text-slate-500',
} as const

export interface KpiCardProps {
  label: ReactNode
  value: ReactNode
  /** Smaller and lighter beside the value («UZS», «policies»). */
  unit?: ReactNode
  /** The full figure on hover, when `value` is human-scale. */
  title?: string
  /** For the change: the current and the baseline as numbers. */
  current?: number | null
  baseline?: number | null
  /** What the baseline is («vs last month»). */
  baselineLabel?: ReactNode
  good?: GoodDirection
  /** Recent values, oldest first. */
  trend?: readonly (number | null)[]
  /** One quiet line when there is no change to show. */
  meta?: ReactNode
  to?: string
  icon?: ReactNode
  /** Anything the figure needs under it (a progress bar, a breakdown). */
  children?: ReactNode
}

export function KpiCard({
  label,
  value,
  unit,
  title,
  current = null,
  baseline = null,
  baselineLabel,
  good = 'none',
  trend,
  meta,
  to,
  icon,
  children,
}: KpiCardProps) {
  const { i18n } = useTranslation()
  const delta = kpiDelta(current, baseline, good)
  const path = trend ? sparklinePath(trend) : null
  const body = (
    <>
      <span className="flex items-start justify-between gap-2 text-caption font-medium text-slate-500">
        <span className="min-w-0">{label}</span>
        {icon && <span className="text-slate-500 [&_svg]:size-4">{icon}</span>}
      </span>
      <span className="flex items-baseline gap-2 whitespace-nowrap" title={title}>
        <span className="font-display text-headline leading-none font-bold text-accent-700 tabular-nums">
          {value}
        </span>
        {unit && <span className="text-small font-medium text-slate-500">{unit}</span>}
      </span>
      {delta && meta && <span className="text-caption text-slate-500">{meta}</span>}
      <span className="flex min-h-6 items-end justify-between gap-3">
        <span className="min-w-0 text-caption text-slate-500">
          {delta ? (
            <>
              <span className={`font-semibold tabular-nums ${DELTA_TONES[delta.tone]}`}>
                {delta.direction === 'up' ? '▲' : delta.direction === 'down' ? '▼' : '•'}{' '}
                {formatPercent(Math.abs(delta.ratio), i18n.language, 1)}
              </span>
              {baselineLabel && <> {baselineLabel}</>}
            </>
          ) : (
            meta
          )}
        </span>
        {path && (
          <svg viewBox="0 0 80 24" className="h-6 w-20 shrink-0" aria-hidden="true">
            <path
              d={path}
              fill="none"
              stroke="var(--color-data-1)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      {children}
    </>
  )
  const className =
    'flex min-w-0 flex-col gap-2 rounded-lg border border-slate-200 bg-white px-4 py-4 text-left shadow-card'
  return to ? (
    <Link
      to={to}
      data-kpi
      className={`${className} transition-colors hover:border-slate-300 focus-visible:outline-2 focus-visible:outline-sky-500`}
    >
      {body}
    </Link>
  ) : (
    <div data-kpi className={className}>
      {body}
    </div>
  )
}
