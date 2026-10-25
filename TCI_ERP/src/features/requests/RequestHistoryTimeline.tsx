/** Immutable transition history of a submission (tci.insurance_request_history),
 * newest first. */

import { formatMoment } from '../../lib/format'
import { useTranslation } from 'react-i18next'

import { Badge, Card, Spinner, SectionTitle } from '../../components/ui'
import { useRequestHistory } from './api'
import { statusTone } from './machine'

export function RequestHistoryTimeline({
  requestId,
  notes,
}: {
  requestId: string
  notes: string | null
}) {
  const { t, i18n } = useTranslation()
  const { data: history, isLoading } = useRequestHistory(requestId)

  return (
    <Card className="p-5">
      <SectionTitle className="mb-3">{t('requests.history')}</SectionTitle>

      {notes && (
        <p className="mb-3 rounded-md bg-slate-50 px-3 py-2 text-[0.8125rem] text-slate-600">
          {notes}
        </p>
      )}

      {isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : !history?.length ? (
        <p className="text-[0.8125rem] text-slate-400">{t('requests.noHistory')}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {history.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-l-2 border-slate-200 pl-3 text-[0.8125rem]"
            >
              <Badge tone={statusTone(row.to_status)}>
                {t(`requests.statuses.${row.to_status}`)}
              </Badge>
              <span className="text-slate-400">
                {t('requests.fromStatus', {
                  status: t(`requests.statuses.${row.from_status}`),
                })}
              </span>
              <span className="ml-auto text-xs text-slate-400">
                {formatMoment(row.changed_at, i18n.language)}
              </span>
              {row.comment && <p className="w-full text-slate-600">{row.comment}</p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
