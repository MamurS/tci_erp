import { useTranslation } from 'react-i18next'
import { useAuth } from '../../auth/AuthContext'
import { LanguageSwitcher } from './LanguageSwitcher'

export function Header() {
  const { t } = useTranslation()
  const { session, role, signOut } = useAuth()

  return (
    <header className="header">
      <div className="header-spacer" />
      <LanguageSwitcher />
      <div className="header-user">
        <span className="header-email">{session?.user.email}</span>
        <span className="header-role">{role ? t(`roles.${role}`) : t('roles.unassigned')}</span>
      </div>
      <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
        {t('auth.signOut')}
      </button>
    </header>
  )
}
