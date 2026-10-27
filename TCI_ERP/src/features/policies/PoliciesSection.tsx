/**
 * «Полисы» — the commercial underwriter's section: the portfolio overview,
 * the policy registry, the contracts made from policies and submissions, and
 * the wording templates those contracts come from, as views of one section
 * (?view=). The contract views load lazily: the registry never downloads the
 * .docx engine.
 */

import { lazy } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { SectionPage } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { PolicyBookFigures } from '../portfolio/BookFigures'
import { PoliciesPage } from './PoliciesPage'
import { parsePolicyView, policyViewsFor } from './views'
import type { PolicyView } from './views'

const ContractsPage = lazy(() => import('../wording').then((m) => ({ default: m.ContractsPage })))
const WordingPage = lazy(() => import('../wording').then((m) => ({ default: m.WordingPage })))
const PaymentsView = lazy(() => import('./payments/PaymentsView').then((m) => ({ default: m.PaymentsView })))
const PolicyPortfolioPage = lazy(() =>
  import('../portfolio').then((m) => ({ default: m.PolicyPortfolioPage })),
)

export function PoliciesSection() {
  const { t } = useTranslation()
  const { roles } = useAuth()
  const [params, setParams] = useSearchParams()
  const view = parsePolicyView(params.get('view'), roles)

  const select = (next: PolicyView) =>
    setParams(
      (current) => {
        const out = new URLSearchParams(current)
        out.set('view', next)
        return out
      },
      { replace: true },
    )

  const tabs = policyViewsFor(roles).map((key) => ({ key, label: t(`policies.views.${key}`) }))

  return (
    <SectionPage
      title={t('nav.policies')}
      subtitle={t('policies.sectionSubtitle')}
      tabs={tabs}
      active={view}
      onChange={(key) => select(key as PolicyView)}
      // The commercial desk's book on the band, on every view.
      figures={policyViewsFor(roles).includes('overview') ? <PolicyBookFigures /> : undefined}
    >
      {view === 'overview' ? (
        <PolicyPortfolioPage />
      ) : view === 'payments' ? (
        <PaymentsView />
      ) : view === 'contracts' ? (
        <ContractsPage />
      ) : view === 'templates' ? (
        <WordingPage />
      ) : (
        <PoliciesPage />
      )}
    </SectionPage>
  )
}
