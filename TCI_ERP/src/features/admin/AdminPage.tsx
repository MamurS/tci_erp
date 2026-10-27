/** Admin section (Phase 3b): users & their department roles, and the 2D
 * underwriting authority matrix per user — with the auto-decision (ADT)
 * switch above it (0061). Admin-only by route guard AND
 * by RLS. */

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { LinkButton, PageHeader, Tabs } from '../../components/ui'
import { AuthoritiesTab } from './AuthoritiesTab'
import { AutoDecisionSettingsCard } from './AutoDecisionSettingsCard'
import { CreditAnalysisModeCard } from './CreditAnalysisModeCard'
import { RatingWeightsCard } from './RatingWeightsCard'
import { AuthorityLevelsCard } from './AuthorityLevelsCard'
import { RiskTab } from './risk/RiskTab'
import { SecurityTab } from './SecurityTab'
import { UsersRolesTab } from './UsersRolesTab'
import { useAdminUsers } from './api'

type TabKey = 'users' | 'authorities' | 'risk' | 'security'

export function AdminPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedUserId, setSelectedUserId] = useState('')
  const { data: users } = useAdminUsers()

  const requested = searchParams.get('tab')
  const activeTab: TabKey =
    requested === 'authorities' || requested === 'risk' || requested === 'security' ? requested : 'users'
  const selectedUser = users?.find((u) => u.user_id === selectedUserId) ?? null

  return (
    <div>
      <PageHeader
        title={t('nav.admin')}
        subtitle={t('admin.subtitle')}
        actions={
          <LinkButton variant="secondary" to="/admin/tokens">
            {t('tokens.title')}
          </LinkButton>
        }
      />

      <Tabs
        tabs={[
          { key: 'users', label: t('admin.tabs.users') },
          { key: 'authorities', label: t('admin.tabs.authorities') },
          { key: 'risk', label: t('admin.tabs.risk') },
          { key: 'security', label: t('admin.tabs.security') },
        ]}
        active={activeTab}
        onChange={(key) => setSearchParams({ tab: key }, { replace: true })}
      />

      <div className="mt-5">
        {activeTab === 'users' && (
          <UsersRolesTab
            selectedUserId={selectedUserId}
            onSelectUser={(id) => {
              setSelectedUserId(id)
              setSearchParams({ tab: 'authorities' }, { replace: true })
            }}
          />
        )}
        {activeTab === 'authorities' && (
          <div className="flex flex-col gap-5">
            {/* Auto decisions (0061) are bounded by the same authority: an
                ADT is never set above its setter's band authority. */}
            <AutoDecisionSettingsCard />
            {/* Who rates and who decides (0069). */}
            <CreditAnalysisModeCard />
            {/* The rating scorecard's default pillar weights (0079). */}
            <RatingWeightsCard />
            {/* Ranks 1–5 and the committee (0071). */}
            <AuthorityLevelsCard />
            <AuthoritiesTab user={selectedUser} />
          </div>
        )}
        {/* OECD list, sanctions, cover matrix, risk settings (0085). */}
        {activeTab === 'risk' && <RiskTab />}
        {activeTab === 'security' && <SecurityTab />}
      </div>
    </div>
  )
}
