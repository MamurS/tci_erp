/** How a colleague is named on screen: their full name, else their e-mail. */
import type { StaffMember } from './types'

export function staffName(directory: Map<string, StaffMember> | undefined, userId: string | null): string {
  if (!userId) return '—'
  const member = directory?.get(userId)
  return member?.full_name?.trim() || member?.email || '—'
}

/** The information managers a request can be handed to, by name. */
export function informationManagers(directory: Map<string, StaffMember> | undefined): StaffMember[] {
  return [...(directory?.values() ?? [])]
    .filter((m) => m.roles.includes('information_manager'))
    .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email))
}
