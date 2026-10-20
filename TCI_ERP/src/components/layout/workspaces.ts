/**
 * Role workspaces («рабочие пространства»): how the sidebar groups the
 * screens. Each department role has its own set of tools; a person sees the
 * workspaces of the roles they hold (an admin sees all of them) and switches
 * between them at the top of the sidebar. The shared tools — dashboard,
 * agenda, the company registry — are in every workspace.
 *
 * This is presentation only. What a person may OPEN is decided by
 * navigation.ts (the route guard) and, behind it, by the database; a screen
 * from another workspace is never hidden from someone allowed to use it —
 * opening it switches to a workspace that contains it.
 */

import type { UserRole } from '../../lib/roles'
import { matchNavItem, navItemsForRoles } from './navigation'
import type { NavItem } from './navigation'

export type WorkspaceKey = 'commercial' | 'credit' | 'sales' | 'claims' | 'admin'

export interface Workspace {
  key: WorkspaceKey
  /** Holding ANY of these roles grants the workspace (admin holds all). */
  roles: readonly UserRole[]
  /** Navigation keys in display order; the first allowed one is its home. */
  items: readonly string[]
}

/** In every workspace, above its own tools. */
export const COMMON_ITEMS: readonly string[] = ['dashboard', 'agenda', 'entities']

export const WORKSPACES: readonly Workspace[] = [
  {
    key: 'commercial',
    roles: ['commercial_underwriter'],
    items: ['policyPortfolio', 'requests', 'policies', 'declarations', 'limits', 'overdues', 'claims'],
  },
  {
    key: 'credit',
    roles: ['credit_underwriter'],
    items: ['creditPortfolio', 'limits', 'requests', 'overdues', 'declarations', 'claims'],
  },
  {
    key: 'sales',
    roles: ['sales'],
    items: ['requests', 'policies', 'limits', 'declarations', 'overdues'],
  },
  { key: 'claims', roles: ['claims'], items: ['claims', 'overdues'] },
  { key: 'admin', roles: ['admin'], items: ['admin', 'policies'] },
]

export const WORKSPACE_KEY = 'tci-erp-workspace'

/** The workspaces a person can switch between, in display order. */
export function availableWorkspaces(roles: readonly UserRole[]): readonly Workspace[] {
  if (roles.includes('admin')) return WORKSPACES
  return WORKSPACES.filter((w) => w.roles.some((r) => roles.includes(r)))
}

/** The shared items and the workspace's own, each limited to what the roles may open. */
export function workspaceNav(
  roles: readonly UserRole[],
  workspace: Workspace | null,
): { common: readonly NavItem[]; own: readonly NavItem[] } {
  const allowed = navItemsForRoles(roles)
  const byKey = new Map(allowed.map((i) => [i.key, i]))
  const pick = (keys: readonly string[]) =>
    keys.map((k) => byKey.get(k)).filter((i): i is NavItem => i !== undefined)
  return { common: pick(COMMON_ITEMS), own: workspace ? pick(workspace.items) : [] }
}

/** Where switching to a workspace lands: its first tool the roles may open. */
export function workspaceHome(roles: readonly UserRole[], workspace: Workspace): string {
  return workspaceNav(roles, workspace).own[0]?.path ?? '/'
}

function contains(workspace: Workspace, pathname: string): boolean {
  const item = matchNavItem(pathname)
  return !item || COMMON_ITEMS.includes(item.key) || workspace.items.includes(item.key)
}

/**
 * The workspace to show: the remembered one while it contains the current
 * page, otherwise the first available workspace that does (opening a screen
 * from elsewhere — a link, the palette — moves there), otherwise the
 * remembered one, otherwise the first. NULL for someone with no workspace.
 */
export function resolveWorkspace(
  roles: readonly UserRole[],
  stored: string | null | undefined,
  pathname: string,
): WorkspaceKey | null {
  const available = availableWorkspaces(roles)
  if (!available.length) return null
  const current = available.find((w) => w.key === stored)
  if (current && contains(current, pathname)) return current.key
  const owner = available.find((w) => contains(w, pathname))
  return (owner ?? current ?? available[0]).key
}
