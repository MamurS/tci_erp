/**
 * Requested → decided, as bars on one scale (Prompt 30, the decision page).
 *
 * Each figure the underwriter weighs is a bar of its own length against the
 * largest of them: what the policyholder asked for, what the engine
 * recommends, the limit in force today, and the decision being made (or the
 * one that was made). The amounts are written beside the bars in full, so
 * nothing depends on reading a length or a colour. A declined decision is a
 * labelled empty row, never a zero-length bar that looks like a missing one.
 */

import { useTranslation } from 'react-i18next'

import { scaleFigures } from '../../components/ui'
import { EM_DASH, formatAmount } from '../../lib/format'

export interface DecisionBarProps {
  currency: string
  requested: number
  /** The engine's recommended limit in the request's currency (null: none, or no rate). */
  recommended: number | null
  /** The limit in force on this scope today, same currency (null: none). */
  current: number | null
  /** The decision: being typed (live) or taken. `declined` draws no bar. */
  decision: { amount: number | null; outcome: 'approved' | 'partial' | 'declined' | null; live: boolean } | null
}

type RowKey = 'requested' | 'recommended' | 'current' | 'decision'

const BAR: Record<RowKey, string> = {
  requested: 'bg-slate-300',
  recommended: 'border-2 border-dashed border-sky-500 bg-sky-50',
  current: 'bg-slate-500',
  decision: 'bg-accent-600',
}

export function DecisionBar({ currency, requested, recommended, current, decision }: DecisionBarProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const declined = decision?.outcome === 'declined'
  const decided = declined ? null : (decision?.amount ?? null)
  const { share } = scaleFigures<RowKey>({
    requested,
    recommended,
    current,
    decision: decided,
  })
  const rows: { key: RowKey; label: string; value: number | null; note?: string }[] = [
    { key: 'requested', label: t('limits.bar.requested'), value: requested },
    { key: 'recommended', label: t('limits.bar.recommended'), value: recommended },
    ...(current !== null ? [{ key: 'current' as const, label: t('limits.bar.current'), value: current }] : []),
    ...(decision
      ? [
          {
            key: 'decision' as const,
            label: decision.live ? t('limits.bar.thisDecision') : t('limits.bar.decided'),
            value: decided,
            note: declined
              ? t('limits.outcomes.declined')
              : decided !== null && requested > 0
                ? t('limits.bar.ofRequested', { pct: formatAmount((decided / requested) * 100, locale, 0) })
                : undefined,
          },
        ]
      : []),
  ]
  return (
    <div
      className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3"
      data-decision-bar
    >
      {rows.map((row) => {
        const width = share[row.key]
        return (
          <div key={row.key} className="contents">
            <span className="flex flex-col">
              <span
                className={`text-small ${row.key === 'decision' ? 'font-semibold text-slate-900' : 'text-slate-600'}`}
              >
                {row.label}
              </span>
              {row.value !== null && row.note && (
                <span className="text-caption text-slate-500">{row.note}</span>
              )}
            </span>
            <div className="h-3 rounded-full bg-slate-100">
              {width !== null && (
                <div
                  className={`h-3 rounded-full ${BAR[row.key]}`}
                  style={{ width: `${Math.max(width * 100, 1)}%` }}
                />
              )}
            </div>
            <span
              className={`num text-right text-small whitespace-nowrap ${row.key === 'decision' ? 'font-semibold text-slate-900' : 'text-slate-700'}`}
            >
              {row.value === null ? (row.note ?? EM_DASH) : `${formatAmount(row.value, locale)} ${currency}`}
            </span>
          </div>
        )
      })}
    </div>
  )
}
