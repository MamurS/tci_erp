import {
  AlarmClock,
  Building2,
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
