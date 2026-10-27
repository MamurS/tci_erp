/** The sector and country adjustment under the grade (credit_engine 0.2.0):
 * base grade → final grade, one line per rule, and the context the engine
 * was given. Nothing for a rating computed without a risk context. The words
 * come from risk/integrationTrace.ts, which reads the engine's own trace. */

import { useTranslation } from 'react-i18next'

import { GradeBadge } from '../../../components/ui'
import type { RatingResponse } from '../../../lib/analytics'
import { riskTrace } from '../../risk/integrationTrace'
import type { TraceLine } from '../../risk/integrationTrace'

export function RiskTraceLines({ rating }: { rating: RatingResponse }) {
  const { t } = useTranslation()
  const trace = riskTrace(rating)
  if (!trace) return null
  const say = (line: TraceLine) =>
    t(line.key, { ...line.params, ...(line.country ? { country: t(line.country.key, line.country.params) } : {}) })
  return (
    <div className="flex flex-col gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-small">
      <p className="flex flex-wrap items-center gap-2 font-medium text-slate-800">
        <span>{t('risk.trace.title')}:</span>
        {trace.changed ? (
          <span className="inline-flex items-center gap-2">
            <span className="text-slate-500">{t('risk.trace.base')}</span>
            <GradeBadge grade={trace.base} />
            <span aria-hidden className="text-slate-500">→</span>
            <span className="text-slate-500">{t('risk.trace.final')}</span>
            <GradeBadge grade={trace.final} />
          </span>
        ) : (
          <span className="inline-flex items-center gap-2">
            <GradeBadge grade={trace.final} />
            <span className="font-normal text-slate-500">{t('risk.trace.unchanged')}</span>
          </span>
        )}
      </p>
      <ul className="list-inside list-disc text-slate-700">
        {trace.lines.map((line) => (
          <li key={`${line.key}-${line.country?.key ?? ''}`}>{say(line)}</li>
        ))}
      </ul>
      <p className="text-caption text-slate-500">
        {t('risk.trace.contextLine', {
          sector: t(trace.context.sector.key, trace.context.sector.params),
          country: t(trace.context.country.key, trace.context.country.params),
        })}
      </p>
    </div>
  )
}
