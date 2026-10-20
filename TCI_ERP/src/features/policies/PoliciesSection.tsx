/**
 * «Полисы» — the commercial underwriter's section: the policy registry, the
 * contracts made from policies and submissions, and the wording templates
 * those contracts come from, as three views of one section (?view=). The
 * contract views load lazily: the registry never downloads the .docx engine.
 */

import { lazy } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Tabs } from '../../components/ui'
import { PoliciesPage } from './PoliciesPage'
import { POLICY_VIEWS, parsePolicyView } from './views'
import type { PolicyView } from './views'

const ContractsPage = lazy(() => import('../wording').then((m) => ({ default: m.ContractsPage })))
const WordingPage = lazy(() => import('../wording').then((m) => ({ default: m.WordingPage })))

export function PoliciesSection() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const view = parsePolicyView(params.get('view'))

  const select = (next: PolicyView) =>
    setParams(
      (current) => {
        const out = new URLSearchParams(current)
        if (next === 'registry') out.delete('view')
        else out.set('view', next)
        return out
      },
      { replace: true },
    )

  const tabs = (
    <div className="mb-5">
      <Tabs
        tabs={POLICY_VIEWS.map((key) => ({ key, label: t(`policies.views.${key}`) }))}
        active={view}
        onChange={(key) => select(key as PolicyView)}
      />
    </div>
  )

  if (view === 'contracts') return <ContractsPage sectionTabs={tabs} />
  if (view === 'templates') return <WordingPage sectionTabs={tabs} />
  return <PoliciesPage sectionTabs={tabs} />
}
