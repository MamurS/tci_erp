/** Admin data access: users, their roles, and the authority matrix.
 * All writes are additionally gated by RLS (admin-only policies). */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import { isUserRole } from '../../lib/roles'
import type { AuthorityScope, GradeBand, UserRole } from '../../lib/roles'
import type { AuthorityGrant } from '../limits/types'

const KEYS = {
  users: ['admin', 'users'] as const,
  grants: (userId: string) => ['admin', 'grants', userId] as const,
}

export interface AdminUser {
  user_id: string
  email: string
  last_sign_in_at: string | null
  created_at: string
  roles: UserRole[]
}

/** Users with their roles. auth.users is not exposed through PostgREST, so
 * the list is built from tci.user_roles joined to the admin-only view of
 * emails (tci.v_admin_users, migration 0018). */
export function useAdminUsers() {
  return useQuery({
    queryKey: KEYS.users,
    queryFn: async (): Promise<AdminUser[]> => {
      const { data, error } = await tci()
        .from('v_admin_users')
        .select('*')
        .order('email')
      if (error) throw error
      return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
        user_id: String(row.user_id),
        email: String(row.email ?? ''),
        last_sign_in_at: (row.last_sign_in_at as string | null) ?? null,
        created_at: String(row.created_at ?? ''),
        roles: ((row.roles as unknown[]) ?? []).filter(isUserRole),
      }))
    },
  })
}

export function useSetUserRoles() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { userId: string; roles: UserRole[] }): Promise<void> => {
      // Replace the whole set: delete what is gone, insert what is new.
      const { data: current, error: readError } = await tci()
        .from('user_roles')
        .select('role')
        .eq('user_id', input.userId)
      if (readError) throw readError
      const have = ((current ?? []) as { role: string }[]).map((r) => r.role)
      const toRemove = have.filter((r) => !(input.roles as string[]).includes(r))
      const toAdd = input.roles.filter((r) => !have.includes(r))

      if (toRemove.length) {
        const { error } = await tci()
          .from('user_roles')
          .delete()
          .eq('user_id', input.userId)
          .in('role', toRemove)
        if (error) throw error
      }
      if (toAdd.length) {
        const { error } = await tci()
          .from('user_roles')
          .insert(toAdd.map((role) => ({ user_id: input.userId, role })))
        if (error) throw error
      }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEYS.users }),
  })
}

// ---------------------------------------------------------------------------
// Authority matrix
// ---------------------------------------------------------------------------

export function useAuthorityGrants(userId: string) {
  return useQuery({
    queryKey: KEYS.grants(userId),
    enabled: Boolean(userId),
    queryFn: async (): Promise<AuthorityGrant[]> => {
      const { data, error } = await tci()
        .from('authority_grants')
        .select('*')
        .eq('user_id', userId)
        .order('grade_band')
      if (error) throw error
      return (data ?? []) as unknown as AuthorityGrant[]
    },
  })
}

export interface GrantInput {
  user_id: string
  applies_to: AuthorityScope
  grade_band: GradeBand
  max_amount: number
  currency_code: string
  valid_from: string
  valid_to: string | null
}

export function useSaveGrant() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: GrantInput & { id?: string }): Promise<void> => {
      const { id, ...row } = input
      const { error } = id
        ? await tci().from('authority_grants').update(row).eq('id', id)
        : await tci().from('authority_grants').insert(row)
      if (error) throw error
    },
    onSuccess: (_data, variables) =>
      void queryClient.invalidateQueries({ queryKey: KEYS.grants(variables.user_id) }),
  })
}

export function useDeleteGrant(userId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await tci().from('authority_grants').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEYS.grants(userId) }),
  })
}
