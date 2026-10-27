/** Who did it, by name: admin reads every user (tci.v_admin_users). */

import { useMemo } from 'react'

import { useAdminUsers } from '../api'
import type { AdminUser } from '../api'

export function personLabel(user: Pick<AdminUser, 'full_name' | 'email'>): string {
  return user.full_name?.trim() || user.email
}

export function usePersonName(): (id: string | null | undefined) => string {
  const { data: users } = useAdminUsers()
  return useMemo(() => {
    const byId = new Map((users ?? []).map((u) => [u.user_id, personLabel(u)]))
    return (id) => (id ? (byId.get(id) ?? '—') : '—')
  }, [users])
}
