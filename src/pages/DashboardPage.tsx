import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'

export function DashboardPage() {
  const { t } = useTranslation()
  const { session, role } = useAuth()

  return (
    <div className="page">
      <h1 className="page-title">{t('nav.dashboard')}</h1>
      <div className="stub-card">
        <p className="stub-title">{t('dashboard.welcome', { email: session?.user.email })}</p>
        <p className="stub-hint">
          {t('dashboard.roleLabel')}: {role ? t(`roles.${role}`) : t('roles.unassigned')}
        </p>
      </div>
    </div>
  )
}
