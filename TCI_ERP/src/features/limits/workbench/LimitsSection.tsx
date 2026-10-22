/**
 * «Кредитные лимиты» — the credit underwriter's workbench: the portfolio
 * overview, the decision queue, the in-force register, monitoring, the rating
 * worklist, corporate groups against their caps, and the caller's own
 * authority, as views of one section (?view=). Sales and commercial
 * underwriting see the queue and the register only (views.ts).
 */

import { lazy } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { SectionPage } from '../../../components/ui'
import { useAuth } from '../../../auth/AuthContext'
import { useCreditPortfolio } from '../../portfolio/api'
import { useOverdueNotifications } from '../../overdue/api'
import { LimitsPage } from '../LimitsPage'
import { useGroupLimitStatus, useLimitQueue, useRatingWorklist } from './api'
import { REVIEW_WINDOW_DAYS, groupsAtRisk, ratingDeteriorated, reviewsDueOrOverdue } from './model'
import { isCreditDesk, limitViewsFor, parseLimitView } from './views'
import type { LimitView } from './views'

const CreditPortfolioPage = lazy(() =>
  import('../../portfolio').then((m) => ({ default: m.CreditPortfolioPage })),
)
const InForceView = lazy(() => import('./InForceView').then((m) => ({ default: m.InForceView })))
const MonitoringView = lazy(() => import('./MonitoringView').then((m) => ({ default: m.MonitoringView })))
const RatingsView = lazy(() => import('./RatingsView').then((m) => ({ default: m.RatingsView })))
const GroupsView = lazy(() => import('./GroupsView').then((m) => ({ default: m.GroupsView })))
const AutoDecisionsView = lazy(() =>
  import('./AutoDecisionsView').then((m) => ({ default: m.AutoDecisionsView })),
)
const AuthorityView = lazy(() => import('./AuthorityView').then((m) => ({ default: m.AuthorityView })))

export function LimitsSection() {
  const { t } = useTranslation()
  const { roles } = useAuth()
  const [params, setParams] = useSearchParams()
  const view = parseLimitView(params.get('view'), params.get('tab'), roles)
  const desk = isCreditDesk(roles)

  // The counts on the tabs. React Query shares these with the views.
  const queue = useLimitQueue(desk)
  const portfolio = useCreditPortfolio()
  const ratings = useRatingWorklist(desk)
  const groups = useGroupLimitStatus(desk)
  const noas = useOverdueNotifications()

  const rows = portfolio.data ?? []
  const monitoringCount = desk
    ? reviewsDueOrOverdue(rows, REVIEW_WINDOW_DAYS).length +
      ratingDeteriorated(rows).length +
      (noas.data ?? []).filter((n) => n.status === 'open').length +
      groupsAtRisk(groups.data ?? []).length
    : 0

  const counts: Partial<Record<LimitView, number>> = {
    queue: desk ? queue.data?.length : undefined,
    inforce: portfolio.data?.length,
    monitoring: desk && (portfolio.data || noas.data) ? monitoringCount : undefined,
    ratings: ratings.data?.length,
  }

  const select = (next: LimitView) =>
    setParams(
      (current) => {
        const out = new URLSearchParams()
        // the queue keeps its own sub-tab; nothing else carries over
        if (next === 'queue' && current.get('tab')) out.set('tab', current.get('tab') as string)
        out.set('view', next)
        return out
      },
      { replace: true },
    )

  const tabs = limitViewsFor(roles).map((key) => ({
    key,
    label: t(`limits.views.${key}`),
    // A counting view keeps its pill's place while it is zero or loading.
    count: key in counts ? counts[key] || null : undefined,
  }))

  const body = (() => {
    switch (view) {
      case 'overview':
        return <CreditPortfolioPage />
      case 'inforce':
        return <InForceView />
      case 'monitoring':
        return <MonitoringView />
      case 'ratings':
        return <RatingsView />
      case 'groups':
        return <GroupsView />
      case 'auto':
        return <AutoDecisionsView />
      case 'authority':
        return <AuthorityView />
      default:
        return <LimitsPage />
    }
  })()

  return (
    <SectionPage
      title={t('nav.limits')}
      subtitle={t(desk ? 'limits.sectionSubtitle' : 'limits.subtitle')}
      tabs={tabs}
      active={view}
      onChange={(key) => select(key as LimitView)}
    >
      {body}
    </SectionPage>
  )
}
