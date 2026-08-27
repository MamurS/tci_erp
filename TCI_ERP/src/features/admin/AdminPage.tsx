/** Admin section (Phase 3b): users & their department roles, and the 2D
 * underwriting authority matrix per user. Admin-only by route guard AND
 * by RLS. */

import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { PageHeader, Tabs } from '../../components/ui'
import { AuthoritiesTab } from './AuthoritiesTab'
import { UsersRolesTab } from './UsersRolesTab'
import { useAdminUsers } from './api'

type TabKey = 'users' | 'authorities'

export function AdminPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedUserId, setSelectedUserId] = useState('')
  const { data: users } = useAdminUsers()

  const requested = searchParams.get('tab')
  const activeTab: TabKey = requested === 'authorities' ? 'authorities' : 'users'
  const selectedUser = users?.find((u) => u.user_id === selectedUserId) ?? null

  return (
    <div>
      <PageHeader title={t('nav.admin')} subtitle={t('admin.subtitle')} />

      <Tabs
        tabs={[
          { key: 'users', label: t('admin.tabs.users') },
          { key: 'authorities', label: t('admin.tabs.authorities') },
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
        {activeTab === 'authorities' && <AuthoritiesTab user={selectedUser} />}
      </div>
    </div>
  )
}
