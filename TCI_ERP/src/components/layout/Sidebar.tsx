/**
 * Navy navigation rail, grouped by line of work. Collapses to icons; the
 * choice is remembered per browser (a convenience, so storage failures are
 * ignored and the rail simply opens expanded).
 */

import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlarmClock,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  ClipboardList,
  FileText,
  FileWarning,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { useAuth } from '../../auth/AuthContext'
import { hasRole, isStaff } from '../../lib/roles'
import { useEscalatedCount } from '../../features/limits/api'
import { useAgendaTasks } from '../../features/agenda/api'
import { agendaCounts } from '../../features/agenda/catalogue'
import { BrandMark } from '../ui/BrandMark'
import { NAV_GROUPS, navItemsForRoles } from './navigation'

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  agenda: ListChecks,
  entities: Building2,
  requests: Inbox,
  limits: ShieldCheck,
  policies: FileText,
  declarations: ClipboardList,
  overdues: AlarmClock,
  claims: FileWarning,
  admin: Settings,
}

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { t } = useTranslation()
  const { roles } = useAuth()
  const items = navItemsForRoles(roles)
  // Anyone who may decide sees the escalated queue size.
  const canDecide = hasRole(roles, 'admin', 'credit_underwriter')
  const { data: escalatedCount } = useEscalatedCount(canDecide)
  // Exactly the query /agenda uses — one key, one queryFn, so the badge and
  // the board can never disagree.
  const { data: agendaTasks } = useAgendaTasks({ enabled: isStaff(roles) })
  const agenda = agendaCounts(agendaTasks ?? [], new Date())

  return (
    <aside
      className={`sticky top-0 flex h-screen shrink-0 flex-col bg-gradient-to-b from-accent-700 via-accent-800 to-accent-900 text-white transition-[width] duration-200 ${
        collapsed ? 'w-[68px]' : 'w-64'
      }`}
    >
      <div className={`flex h-16 items-center border-b border-white/10 ${collapsed ? 'justify-center px-2' : 'px-5'}`}>
        {collapsed ? (
          <span className="font-display text-[22px] leading-none font-bold">
            <span className="text-accent-400">M</span>
          </span>
        ) : (
          <div className="flex flex-col">
            <BrandMark size="sm" inverse />
            <span className="mt-1 text-[10.5px] font-medium tracking-[0.18em] text-white/50 uppercase">
              {t('app.title')}
            </span>
          </div>
        )}
      </div>

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.group === group)
          if (!groupItems.length) return null
          return (
            <div key={group} className="mb-5 last:mb-0">
              {!collapsed && (
                <div className="mb-1.5 px-3 text-[10.5px] font-semibold tracking-[0.16em] text-white/40 uppercase">
                  {t(`nav.groups.${group}`)}
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {groupItems.map((item) => {
                  const Icon = ICONS[item.key] ?? LayoutDashboard
                  const showEscalated = item.key === 'limits' && canDecide && (escalatedCount ?? 0) > 0
                  const showAgenda = item.key === 'agenda' && agenda.open > 0
                  return (
                    <NavLink
                      key={item.key}
                      to={item.path}
                      end={item.path === '/'}
                      title={collapsed ? t(`nav.${item.key}`) : undefined}
                      className={({ isActive }) =>
                        `group relative flex items-center gap-3 rounded-md py-2 text-[13.5px] transition-colors ${
                          collapsed ? 'justify-center px-0' : 'px-3'
                        } ${
                          isActive
                            ? 'bg-white/12 font-semibold text-white before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-[3px] before:rounded-r before:bg-accent-400'
                            : 'text-white/70 hover:bg-white/6 hover:text-white'
                        }`
                      }
                    >
                      <Icon className="size-[18px] shrink-0" strokeWidth={1.8} />
                      {!collapsed && <span className="flex-1 truncate">{t(`nav.${item.key}`)}</span>}
                      {!collapsed && showEscalated && (
                        <span
                          className="rounded-full bg-brand-amber px-1.5 text-[11px] font-bold text-accent-900"
                          title={t('limits.tabs.escalated')}
                        >
                          {escalatedCount}
                        </span>
                      )}
                      {/* Overdue gets its own tone: an overdue count is a
                          different statement from a busy one. */}
                      {!collapsed && showAgenda && (
                        <span className="flex items-center gap-1">
                          {agenda.overdue > 0 && (
                            <span
                              className="rounded-full bg-neg-500 px-1.5 text-[11px] font-bold text-white"
                              title={t('agenda.groups.overdue')}
                            >
                              {agenda.overdue}
                            </span>
                          )}
                          <span
                            className="rounded-full bg-white/15 px-1.5 text-[11px] font-semibold text-white"
                            title={t('agenda.openCount')}
                          >
                            {agenda.open}
                          </span>
                        </span>
                      )}
                      {collapsed && (showEscalated || (showAgenda && agenda.overdue > 0)) && (
                        <span className="absolute top-1 right-2 size-2 rounded-full bg-brand-orange" />
                      )}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      <button
        type="button"
        onClick={onToggle}
        className={`flex h-11 items-center gap-2 border-t border-white/10 text-[12px] text-white/55 transition-colors hover:bg-white/5 hover:text-white ${
          collapsed ? 'justify-center' : 'px-5'
        }`}
        aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
      >
        {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
        {!collapsed && t('nav.collapse')}
      </button>
    </aside>
  )
}
