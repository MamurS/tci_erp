/**
 * The portal's frame. Same design system as the staff app - a policyholder
 * should not feel handed off to a different product - but a deliberately
 * plainer one: four destinations, no badges, no queues, no counts. Nothing
 * here hints at the internal workflow behind it.
 */

import { NavLink, Outlet } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import { Button } from '../../components/ui'
import { LanguageSwitcher } from '../../components/layout/LanguageSwitcher'
import { PORTAL_NAV_ITEMS } from './navigation'
import { useMyEntity } from './api'

export function PortalShell() {
  const { t } = useTranslation()
  const { session, signOut } = useAuth()
  const { data: entity } = useMyEntity()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex flex-col leading-tight">
          <span className="text-base font-bold tracking-wide text-slate-900">
            {t('app.title')}
          </span>
          <span className="text-xs text-slate-400">{t('portal.title')}</span>
        </div>

        <nav className="flex flex-1 flex-wrap gap-1">
          {PORTAL_NAV_ITEMS.map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              end={item.path === '/portal'}
              className={({ isActive }) =>
                `rounded-md px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-accent-50 font-medium text-accent-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`
              }
            >
              {t(`portal.nav.${item.key}`)}
            </NavLink>
          ))}
        </nav>

        <LanguageSwitcher />
        <div className="flex flex-col items-end leading-tight">
          {/* The company, not the role: a portal user has exactly one role
              and being told so every page is noise. */}
          <span className="text-[13px] font-semibold text-slate-800">
            {entity?.name ?? session?.user.email}
          </span>
          {entity && <span className="text-xs text-slate-400">{session?.user.email}</span>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          {t('auth.signOut')}
        </Button>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 p-6">
        <Outlet />
      </main>
    </div>
  )
}
