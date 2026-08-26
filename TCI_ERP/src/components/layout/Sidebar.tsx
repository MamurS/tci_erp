import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../auth/AuthContext'
import { useEscalatedCount } from '../../features/limits/api'
import { navItemsForRole } from './navigation'

export function Sidebar() {
  const { t } = useTranslation()
  const { role } = useAuth()
  const items = navItemsForRole(role)
  const isSenior = role === 'admin' || role === 'senior_underwriter'
  const { data: escalatedCount } = useEscalatedCount(isSenior)

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex flex-col gap-0.5 border-b border-slate-100 px-5 py-4">
        <span className="text-base font-bold tracking-wide text-slate-900">{t('app.title')}</span>
        <span className="text-xs text-slate-400">{t('app.company')}</span>
      </div>
      <nav className="flex flex-col gap-0.5 p-2.5">
        {items.map((item) => (
          <NavLink
            key={item.key}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `rounded-md px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'bg-accent-50 font-medium text-accent-700'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`
            }
          >
            <span className="flex items-center justify-between">
              {t(`nav.${item.key}`)}
              {item.key === 'limits' && isSenior && (escalatedCount ?? 0) > 0 && (
                <span
                  className="rounded-full bg-warn-50 px-1.5 text-xs font-semibold text-warn-500"
                  title={t('limits.tabs.escalated')}
                >
                  {escalatedCount}
                </span>
              )}
            </span>
          </NavLink>
        ))}
      </nav>
    </aside>
  )
}
