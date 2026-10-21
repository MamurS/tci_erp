/** Every transition the claim went through, with who made it and why.
 * Append-only in the database; read-only here. */

import { useTranslation } from 'react-i18next'

import { Badge, Card, EmptyState, Spinner } from '../../components/ui'
import { formatMoment } from '../../lib/format'
import { CLAIM_STATUS_TONE } from './status'
import { useClaimHistory } from './api'

export function ClaimHistoryTab({ claimId }: { claimId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data, isLoading } = useClaimHistory(claimId)

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!data || data.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState title={t('claims.history.emptyTitle')} hint={t('claims.history.emptyHint')} />
      </Card>
    )
  }

  return (
    <Card className="p-5">
      <ol>
        {data.map((row) => (
          <li
            key={row.id}
            className="flex flex-col gap-1.5 border-b border-slate-100 py-3.5 first:pt-0 last:border-0 last:pb-0 sm:flex-row sm:gap-6"
          >
            <div className="w-44 shrink-0 pt-0.5 text-[13px] whitespace-nowrap text-slate-500 tabular-nums">
              {formatMoment(row.changed_at, locale)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={CLAIM_STATUS_TONE[row.from_status]}>
                  {t(`claims.statuses.${row.from_status}`)}
                </Badge>
                <span className="text-slate-400">→</span>
                <Badge tone={CLAIM_STATUS_TONE[row.to_status]}>
                  {t(`claims.statuses.${row.to_status}`)}
                </Badge>
              </div>
              {row.comment && (
                <p className="mt-2 border-l-2 border-slate-200 pl-3 text-[13px] leading-relaxed text-slate-600">
                  {row.comment}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}
