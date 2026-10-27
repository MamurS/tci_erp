import { useTranslation } from 'react-i18next'

import { Badge } from '../../components/ui'
import type { SectorRow } from '../risk/api'

/** What needs attention on a sector: amber for a stale or overdue review, the
 * plain badge for one waiting for a second analyst, nothing when in order. */
export function SectorStateBadges({ row }: { row: Pick<SectorRow, 'stale' | 'overdue' | 'pending' | 'grade'> }) {
  const { t } = useTranslation()
  const marks = [
    row.overdue && <Badge key="overdue" tone="warn">{t('risk.sectors.state.overdue')}</Badge>,
    row.stale && <Badge key="stale" tone="warn">{t('risk.sectors.state.stale')}</Badge>,
    row.pending && <Badge key="pending" tone="accent">{t('risk.sectors.state.pending')}</Badge>,
  ].filter(Boolean)
  if (!marks.length) return <span className="text-slate-500">—</span>
  return <span className="flex flex-wrap gap-1">{marks}</span>
}
