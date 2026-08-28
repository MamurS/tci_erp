/** Every transition the claim went through, with who made it and why.
 * Append-only in the database; read-only here. */

import { useTranslation } from 'react-i18next'

import { Badge, Card, EmptyState, Spinner } from '../../components/ui'
import { formatMoment } from '../../lib/format'
import { CLAIM_STATUS_TONE } from './ClaimsPage'
import { useClaimHistory } from './api'

export function ClaimHistoryTab({ claimId }: { claimId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data, isLoading } = useClaimHistory(claimId)

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!data || data.length === 0) {
    return <EmptyState title={t('claims.history.emptyTitle')} hint={t('claims.history.emptyHint')} />
  }

  return (
    <Card>
      <ol className="space-y-4">
        {data.map((row) => (
          <li key={row.id} className="flex gap-3 border-b border-slate-100 pb-4 last:border-0 last:pb-0">
            <div className="min-w-40 text-[13px] text-slate-500">
              {formatMoment(row.changed_at, locale)}
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={CLAIM_STATUS_TONE[row.from_status]}>
                  {t(`claims.statuses.${row.from_status}`)}
                </Badge>
                <span className="text-slate-400">→</span>
                <Badge tone={CLAIM_STATUS_TONE[row.to_status]}>
                  {t(`claims.statuses.${row.to_status}`)}
                </Badge>
              </div>
              {row.comment && <p className="mt-1 text-[13px] text-slate-700">{row.comment}</p>}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  )
}
