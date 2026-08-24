import { useTranslation } from 'react-i18next'
import { useAuth } from '../../auth/AuthContext'
import { Button } from '../ui'
import { LanguageSwitcher } from './LanguageSwitcher'

export function Header() {
  const { t } = useTranslation()
  const { session, role, signOut } = useAuth()

  return (
    <header className="flex items-center gap-4 border-b border-slate-200 bg-white px-6 py-2.5">
      <div className="flex-1" />
      <LanguageSwitcher />
      <div className="flex flex-col items-end leading-tight">
        <span className="text-[13px] font-semibold text-slate-800">{session?.user.email}</span>
        <span className="text-xs text-slate-400">
          {role ? t(`roles.${role}`) : t('roles.unassigned')}
        </span>
      </div>
      <Button variant="ghost" size="sm" onClick={() => void signOut()}>
        {t('auth.signOut')}
      </Button>
    </header>
  )
}
