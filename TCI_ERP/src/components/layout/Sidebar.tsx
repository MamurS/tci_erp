/**
 * The navigation panel, grouped by line of work. Like Claude's, it is either
 * there or gone: docked beside the content, or hidden entirely. While hidden
 * it floats out as a card when the pointer rests on the toggle in the top-left
 * corner (the peek), and clicking that toggle docks it again — the toggle sits
 * in the same corner in both states. On small screens it is a drawer.
 */

import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { PanelLeftClose } from 'lucide-react'

import { useAuth } from '../../auth/AuthContext'
import { hasRole, isStaff } from '../../lib/roles'
import { useEscalatedCount } from '../../features/limits/api'
import { useAgendaTasks } from '../../features/agenda/api'
import { agendaCounts } from '../../features/agenda/catalogue'
import { BrandMark } from '../ui/BrandMark'
import { NAV_GROUPS, navItemsForRoles } from './navigation'
import { navIcon } from './navIcons'

interface SidebarProps {
  /**
   * docked: in the page flow; peek: the floating card shown while the pointer
   * rests on the header toggle (that toggle docks it, so the card has none);
   * drawer: the small-screen overlay.
   */
  variant: 'docked' | 'peek' | 'drawer'
  /** Hide (docked) / dismiss (drawer). */
  onClose: () => void
  /** Called after a destination is chosen (closes a drawer). */
  onNavigate?: () => void
}

export function Sidebar({ variant, onClose, onNavigate }: SidebarProps) {
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
      className="flex h-full w-64 flex-col bg-gradient-to-b from-accent-700 via-accent-800 to-accent-900 text-white"
      aria-label={t('nav.title')}
    >
      <div
        className={`flex h-16 shrink-0 items-center gap-2 border-b border-white/10 pr-5 ${
          variant === 'peek' ? 'pl-5' : 'pl-3 sm:pl-5'
        }`}
      >
        {/* The toggle lives in the top-left corner, exactly where the header
            shows it while the panel is hidden. */}
        {variant !== 'peek' && (
          <button
            type="button"
            onClick={onClose}
            className="flex size-9 shrink-0 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            title={`${t('nav.hide')} (Ctrl B)`}
            aria-label={t('nav.hide')}
          >
            <PanelLeftClose className="size-5" />
          </button>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <BrandMark size="sm" inverse />
          {/* Beside the toggle there is no room for the line of business; it
              moves to the footer there. */}
          {variant === 'peek' && (
            <span className="mt-1 text-[10px] leading-tight font-medium tracking-[0.08em] text-white/45 uppercase">
              {t('app.company')}
            </span>
          )}
        </div>
      </div>

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => {
          const groupItems = items.filter((item) => item.group === group)
          if (!groupItems.length) return null
          return (
            <div key={group} className="mb-5 last:mb-0">
              <div className="mb-1.5 px-3 text-[10.5px] font-semibold tracking-[0.16em] text-white/40 uppercase">
                {t(`nav.groups.${group}`)}
              </div>
              <div className="flex flex-col gap-0.5">
                {groupItems.map((item) => {
                  const Icon = navIcon(item.key)
                  const showEscalated =
                    item.key === 'limits' && canDecide && (escalatedCount ?? 0) > 0
                  const showAgenda = item.key === 'agenda' && agenda.open > 0
                  return (
                    <NavLink
                      key={item.key}
                      to={item.path}
                      end={item.path === '/'}
                      onClick={onNavigate}
                      className={({ isActive }) =>
                        `group relative flex items-center gap-3 rounded-md px-3 py-2 text-[13.5px] transition-colors ${
                          isActive
                            ? 'bg-white/12 font-semibold text-white before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-[3px] before:rounded-r before:bg-accent-400'
                            : 'text-white/70 hover:bg-white/6 hover:text-white'
                        }`
                      }
                    >
                      <Icon className="size-[18px] shrink-0" strokeWidth={1.8} />
                      <span className="flex-1 truncate">{t(`nav.${item.key}`)}</span>
                      {showEscalated && (
                        <span
                          className="rounded-full bg-brand-amber px-1.5 text-[11px] font-bold text-accent-900"
                          title={t('limits.tabs.escalated')}
                        >
                          {escalatedCount}
                        </span>
                      )}
                      {/* Overdue gets its own tone: an overdue count is a
                          different statement from a busy one. */}
                      {showAgenda && (
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
                    </NavLink>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      <div className="shrink-0 border-t border-white/10 px-5 py-3 text-[11px] text-white/35">
        {variant !== 'peek' && (
          <div className="mb-1 text-[10px] font-medium tracking-[0.08em] text-white/45 uppercase">
            {t('app.company')}
          </div>
        )}
        {t('nav.shortcutHint')}
      </div>
    </aside>
  )
}
