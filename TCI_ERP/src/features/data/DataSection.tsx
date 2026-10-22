/**
 * «Управление данными» — the information manager's desk: requests for
 * companies and statements routed to them, the companies whose data has gone
 * stale, and the buyers clients proposed from the portal.
 */

import { lazy } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { SectionPage } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { useDataFreshness, useEntityRequests, usePendingProposalCount } from './api'
import { isOpen } from './requests'
import { DATA_VIEWS, parseDataView } from './views'
import type { DataView } from './views'

const QueueView = lazy(() => import('./QueueView').then((m) => ({ default: m.QueueView })))
const FreshnessView = lazy(() => import('./FreshnessView').then((m) => ({ default: m.FreshnessView })))
const ProposalsView = lazy(() =>
  import('../limits/BuyerProposalsSection').then((m) => ({ default: m.BuyerProposalsSection })),
)

export function DataSection() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const [params, setParams] = useSearchParams()
  const view = parseDataView(params.get('view'))
  const me = session?.user.id

  const requests = useEntityRequests()
  const freshness = useDataFreshness()
  const proposals = usePendingProposalCount()

  const counts: Record<DataView, number | undefined> = {
    queue: requests.data?.filter((r) => isOpen(r.status) && r.assigned_to === me).length,
    freshness: freshness.data?.length,
    proposals: proposals.data?.length,
  }

  return (
    <SectionPage
      title={t('nav.data')}
      subtitle={t('data.sectionSubtitle')}
      tabs={DATA_VIEWS.map((key) => ({ key, label: t(`data.views.${key}`), count: counts[key] || undefined }))}
      active={view}
      onChange={(next) => setParams({ view: next }, { replace: true })}
    >
      {view === 'queue' && <QueueView />}
      {view === 'freshness' && <FreshnessView />}
      {view === 'proposals' && <ProposalsView />}
    </SectionPage>
  )
}
