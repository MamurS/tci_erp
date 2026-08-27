import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../auth/AuthContext'
import { Button } from '../ui'
import { LanguageSwitcher } from './LanguageSwitcher'

export function Header() {
  const { t } = useTranslation()
  const { session, roles, signOut } = useAuth()

  return (
    <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-2.5">
      <div className="flex-1" />
      <LanguageSwitcher />
      <div className="flex flex-col items-end leading-tight">
        <span className="text-[13px] font-semibold text-slate-800">{session?.user.email}</span>
        <span className="text-xs text-slate-400">
          {roles.length ? roles.map((r) => t(`roles.${r}`)).join(' · ') : t('roles.unassigned')}
        </span>
      </div>
      {/* Self-service password change, for everyone - not only the users
          who were forced here after provisioning. */}
      <Link
        to="/change-password"
        className="rounded-md px-2 py-1 text-[13px] font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      >
        {t('account.changePassword')}
      </Link>
      <Button variant="ghost" size="sm" onClick={() => void signOut()}>
        {t('auth.signOut')}
      </Button>
    </header>
  )
}
