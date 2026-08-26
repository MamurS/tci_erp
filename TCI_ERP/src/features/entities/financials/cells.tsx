/** Shared numeric display cells implementing DESIGN.md financial rules. */

import { useTranslation } from 'react-i18next'

import { EM_DASH, formatAmount, formatPercent } from '../../../lib/format'
import type { LineDirection } from './lines'

export function AmountCell({ value }: { value: number | null }) {
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  if (value === null) return <span className="num block text-slate-400">{EM_DASH}</span>
  return (
    <span className={`num block ${value < 0 ? 'text-neg-500' : ''}`}>
      {formatAmount(value, locale)}
    </span>
  )
}

export function ShareCell({ value }: { value: number | null }) {
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  return (
    <span className="num block text-slate-400">
      {value === null ? EM_DASH : formatPercent(value, locale)}
    </span>
  )
}

/**
 * Δ% with ▲/▼ and direction-aware coloring: green = improvement.
 * For up_bad lines (expenses, debt) an increase renders red.
 */
export function DeltaCell({
  value,
  direction,
}: {
  value: number | null
  direction: LineDirection
}) {
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  if (value === null) return <span className="num block text-slate-400">{EM_DASH}</span>

  const up = value > 0
  const arrow = up ? '▲' : '▼'
  const improvement = direction === 'up_good' ? up : !up
  const tone = Math.abs(value) < 0.0005 ? 'text-slate-400' : improvement ? 'text-pos-500' : 'text-neg-500'
  return (
    <span className={`num block ${tone}`}>
      <span aria-hidden="true" className="mr-0.5 text-[9px] align-[1px]">
        {arrow}
      </span>
      {formatPercent(Math.abs(value), locale)}
    </span>
  )
}

