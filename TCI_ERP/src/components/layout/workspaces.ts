/**
 * Role workspaces («рабочие пространства»): how the sidebar groups the
 * screens. Each department role has its own workspace; a person sees the
 * workspaces of the roles they hold and switches between them at the top of
 * the sidebar. The shared tools — dashboard, agenda, the company registry —
 * are in every workspace.
 *
 * Since 0063 a workspace IS a role: the person ACTS in the role of the active
 * workspace (tci.set_acting_role), and the database answers every gate for
 * that role only. Switching the workspace switches the acting role; opening a
 * page never switches it silently. What the acting role may OPEN is still
 * navigation.ts (the route guard) and, behind it, the database.
 */

import type { UserRole } from '../../lib/roles'
import { navItemsForRoles } from './navigation'
import type { NavItem } from './navigation'

export type WorkspaceKey = 'commercial' | 'credit' | 'analysis' | 'sales' | 'claims' | 'data' | 'admin'

export interface Workspace {
  key: WorkspaceKey
  /** The role a person acts in while this workspace is active. */
  role: UserRole
  /** Navigation keys in display order; the first allowed one is its home. */
  items: readonly string[]
}

/** In every workspace, above its own tools. Sanctions (0091): every role
 * checks a name and reads the matches. */
export const COMMON_ITEMS: readonly string[] = ['dashboard', 'agenda', 'entities', 'sanctions']

export const WORKSPACES: readonly Workspace[] = [
  {
    key: 'commercial',
    role: 'commercial_underwriter',
    items: ['policies', 'requests', 'limits', 'declarations', 'overdues', 'claims'],
  },
  {
    key: 'credit',
    role: 'credit_underwriter',
    items: ['limits', 'sectors', 'requests', 'overdues', 'declarations', 'claims'],
  },
  // «Кредитный анализ» (0069): rating buyers and confirming ratings — the
  // analysis views of «Кредитные лимиты», never the decision queue.
  // «Сектора» (0085): sector grades and country risk, beside the limits.
  { key: 'analysis', role: 'credit_analyst', items: ['limits', 'sectors'] },
  {
    key: 'sales',
    role: 'sales',
    items: ['requests', 'policies', 'limits', 'declarations', 'overdues'],
  },
  { key: 'claims', role: 'claims', items: ['claims', 'overdues'] },
  { key: 'data', role: 'information_manager', items: ['data'] },
  // Admin is a technical role since 0063 — it decides nothing — but still
  // opens the business registers to look after the data, read-only there.
  {
    key: 'admin',
    role: 'admin',
    items: ['admin', 'policies', 'requests', 'limits', 'sectors', 'declarations', 'overdues', 'claims', 'data'],
  },
]

export const WORKSPACE_KEY = 'tci-erp-workspace'

/** Remember the workspace chosen in this browser (a convenience: the acting
 * role at the next sign-in starts from it). */
export function rememberWorkspace(key: WorkspaceKey): void {
  try {
    window.localStorage.setItem(WORKSPACE_KEY, key)
  } catch {
    // a per-browser convenience; nothing to do when storage is blocked
  }
}

/** The workspaces a person can switch between — one per role held — in
 * display order. Admin no longer opens every workspace: it is a technical
 * role with a workspace of its own. */
export function availableWorkspaces(heldRoles: readonly UserRole[]): readonly Workspace[] {
  return WORKSPACES.filter((w) => heldRoles.includes(w.role))
}

/** The workspace of an acting role (null for a client, or no role). */
export function workspaceForRole(role: UserRole | null): Workspace | null {
  return WORKSPACES.find((w) => w.role === role) ?? null
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

/**
 * The role to act in when a session starts and the server has none for it:
 * the remembered workspace's role while it is still held, otherwise the first
 * workspace's, otherwise the only role (a client). Null without a role.
 */
export function initialActingRole(
  heldRoles: readonly UserRole[],
  storedWorkspace: string | null | undefined,
): UserRole | null {
  const available = availableWorkspaces(heldRoles)
  const remembered = available.find((w) => w.key === storedWorkspace)
  return (remembered ?? available[0])?.role ?? heldRoles[0] ?? null
}
