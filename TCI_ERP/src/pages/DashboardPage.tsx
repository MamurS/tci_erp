import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { Card, PageHeader } from '../components/ui'

export function DashboardPage() {
  const { t } = useTranslation()
  const { session, role } = useAuth()

  return (
    <div>
      <PageHeader title={t('nav.dashboard')} />
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
