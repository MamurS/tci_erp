import {
  AlarmClock,
  BriefcaseBusiness,
  Building2,
  ClipboardList,
  FileText,
  FileWarning,
  Gauge,
  Handshake,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShieldCheck,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** One icon per navigation key — the sidebar, the header and the palette. */
export const NAV_ICONS: Record<string, LucideIcon> = {
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

export function navIcon(key: string): LucideIcon {
  return NAV_ICONS[key] ?? LayoutDashboard
}

/** One icon per role workspace — the switcher at the top of the sidebar. */
export const WORKSPACE_ICONS: Record<string, LucideIcon> = {
  commercial: BriefcaseBusiness,
  credit: Gauge,
  sales: Handshake,
  claims: FileWarning,
  admin: Settings,
}

export function workspaceIcon(key: string): LucideIcon {
  return WORKSPACE_ICONS[key] ?? LayoutDashboard
}
