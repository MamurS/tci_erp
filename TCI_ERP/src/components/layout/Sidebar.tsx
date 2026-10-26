/**
 * The navigation panel: the role-workspace switcher, the shared tools, then
 * the current workspace's own tools (workspaces.ts). As in the Claude app it
 * is either there or gone, never animated. Its top row reads
 * [toggle] [TCI ERP]: on a desktop the toggle is NOT part of the panel — it
 * lives in a fixed layer above it (AppShell) so it never moves — and the row
 * keeps a blank of the toggle's exact size where it sits. Pinned, the panel
 * is in the page flow; peeking, the same panel floats over the content. On
 * small screens it is a drawer carrying its own toggle in that same spot.
 */

import { NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import { hasRole, isStaff } from '../../lib/roles'
import { useEscalatedCount } from '../../features/limits/api'
import { useAgendaTasks } from '../../features/agenda/api'
import { agendaCounts } from '../../features/agenda/catalogue'
import { BrandMark } from '../ui/BrandMark'
import { Count } from '../ui'
import type { NavItem } from './navigation'
import { navIcon } from './navIcons'
import { SidebarToggle } from './SidebarToggle'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { availableWorkspaces, workspaceNav } from './workspaces'
import type { WorkspaceKey } from './workspaces'

interface SidebarProps {
  /**
   * docked: pinned, in the page flow; peek: the same panel over the content
   * while a hidden panel is hovered; drawer: the small-screen overlay.
   */
  variant: 'docked' | 'peek' | 'drawer'
  /** id the fixed toggle points at (aria-controls). */
  id?: string
  /** The drawer's own toggle: dismisses it. */
  onToggle?: () => void
  /** Called after a destination is chosen (closes a drawer). */
  onNavigate?: () => void
  /** The role workspace shown (null: the person has none — shared tools only). */
  workspace: WorkspaceKey | null
  onSwitchWorkspace: (key: WorkspaceKey) => void
}

export function Sidebar({
  variant,
  id,
  onToggle,
  onNavigate,
  workspace,
  onSwitchWorkspace,
}: SidebarProps) {
  const { t } = useTranslation()
  const { roles, heldRoles } = useAuth()
  const workspaces = availableWorkspaces(heldRoles)
  const current = workspaces.find((w) => w.key === workspace) ?? null
  const { common, own } = workspaceNav(roles, current)
  // Anyone who may decide sees the escalated queue size.
  const canDecide = hasRole(roles, 'credit_underwriter')
  const { data: escalatedCount } = useEscalatedCount(canDecide)
  // Exactly the query /agenda uses — one key, one queryFn, so the badge and
  // the board can never disagree.
  const { data: agendaTasks } = useAgendaTasks({ enabled: isStaff(roles) })
  const agenda = agendaCounts(agendaTasks ?? [], new Date())

  const renderItem = (item: NavItem) => {
    const Icon = navIcon(item.key)
    const showEscalated = item.key === 'limits' && canDecide && (escalatedCount ?? 0) > 0
    const showAgenda = item.key === 'agenda' && agenda.open > 0
    return (
      <NavLink
        key={item.key}
        to={item.path}
        end={item.path === '/'}
        onClick={onNavigate}
        className={({ isActive }) =>
          `group relative flex items-center gap-3 rounded-md px-3 py-2 text-[0.8438rem] transition-colors ${
            isActive
              ? 'bg-white/12 font-semibold text-white before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-[3px] before:rounded-r before:bg-accent-400'
              : 'text-white/70 hover:bg-white/6 hover:text-white'
          }`
        }
      >
        <Icon className="size-[1.125rem] shrink-0" strokeWidth={1.8} />
        <span className="flex-1 truncate">{t(`nav.${item.key}`)}</span>
        {showEscalated && (
          <Count value={escalatedCount} digits={1} className="bg-brand-amber text-accent-900" title={t('limits.tabs.escalated')} />
        )}
        {/* Overdue gets its own tone: an overdue count is a different
            statement from a busy one. */}
        {showAgenda && (
          <span className="flex items-center gap-1">
            {agenda.overdue > 0 && (
              <Count value={agenda.overdue} digits={1} className="bg-neg-500 text-white" title={t('agenda.groups.overdue')} />
            )}
            <Count value={agenda.open} digits={1} className="bg-white/15 text-white" title={t('agenda.openCount')} />
          </span>
        )}
      </NavLink>
    )
  }

  return (
    <aside
      id={id}
      className="flex h-full w-64 flex-col bg-gradient-to-b from-accent-700 via-accent-800 to-accent-900 text-white"
      aria-label={t('nav.title')}
    >
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-white/10 pr-3 pl-5">
        {variant === 'drawer' && onToggle ? (
          <SidebarToggle action="hide" tone="inverse" expanded controls={id ?? ''} onClick={onToggle} />
        ) : (
          // The fixed toggle of AppShell sits exactly here (20px in, centred).
          <span aria-hidden className="size-9 shrink-0" />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <BrandMark size="sm" inverse />
        </div>
      </div>

      {current && (
        <div className="shrink-0 border-b border-white/10 px-3 py-2.5">
          <WorkspaceSwitcher workspaces={workspaces} current={current.key} onSwitch={onSwitchWorkspace} />
        </div>
      )}

      <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 py-4">
        {[
          { key: 'common', title: t('nav.groups.common'), items: common },
          ...(current
            ? [{ key: current.key, title: t(`nav.workspaces.${current.key}.name`), items: own }]
            : []),
        ]
          .filter((section) => section.items.length > 0)
          .map((section) => (
            <div key={section.key} className="mb-5 last:mb-0">
              <div className="mb-1.5 px-3 text-[0.6562rem] font-semibold tracking-[0.16em] text-white/40 uppercase">
                {section.title}
              </div>
              <div className="flex flex-col gap-0.5">{section.items.map(renderItem)}</div>
            </div>
          ))}
      </nav>

      <div className="shrink-0 border-t border-white/10 px-5 py-3 text-[0.6875rem] text-white/35">
        <div className="mb-1 text-[0.625rem] font-medium tracking-[0.08em] text-white/45 uppercase">
          {t('app.company')}
        </div>
        {t('nav.shortcutHint')}
      </div>
    </aside>
  )
}
