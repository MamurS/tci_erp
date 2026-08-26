import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { Card, PageHeader } from '../components/ui'
import { usePolicies } from '../features/policies/api'
import { usePolicyholders } from '../features/policyholders/api'
import { EM_DASH } from '../lib/format'

export function DashboardPage() {
  const { t } = useTranslation()
  const { session, role } = useAuth()
  const { data: policies } = usePolicies()
  const { data: policyholders } = usePolicyholders()

  const activePolicies = policies?.filter((p) => p.status === 'active').length
  const stats: { key: string; label: string; value: number | undefined; to: string }[] = [
    {
      key: 'active-policies',
      label: t('dashboard.activePolicies'),
      value: activePolicies,
      to: '/policies',
    },
    {
      key: 'policyholders',
      label: t('dashboard.policyholders'),
      value: policyholders?.length,
      to: '/policyholders',
    },
  ]

  return (
    <div>
      <PageHeader title={t('nav.dashboard')} />
      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:max-w-xl">
        {stats.map((stat) => (
          <Link key={stat.key} to={stat.to}>
            <Card className="p-4 transition-colors hover:bg-slate-50">
              <p className="text-xs text-slate-500">{stat.label}</p>
              <p className="mt-1">
                <span className="num text-2xl font-semibold text-slate-900">
                  {stat.value ?? EM_DASH}
                </span>
              </p>
            </Card>
          </Link>
        ))}
      </div>
      <Card className="p-5">
        <p className="text-sm font-medium text-slate-800">
          {t('dashboard.welcome', { email: session?.user.email })}
        </p>
        <p className="mt-1 text-[13px] text-slate-500">
          {t('dashboard.roleLabel')}: {role ? t(`roles.${role}`) : t('roles.unassigned')}
        </p>
      </Card>
    </div>
  )
}
