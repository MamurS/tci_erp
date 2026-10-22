/** Admin data access: users, their roles, and the authority matrix.
 * All writes are additionally gated by RLS (admin-only policies). */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { optimistic, patch, rowInList, rowOutOfList } from '../../lib/optimistic'
import { tci } from '../../lib/supabase'
import { isUserRole, USER_ROLES } from '../../lib/roles'
import type { AuthorityScope, GradeBand, UserRole } from '../../lib/roles'
import type { AuthorityGrant } from '../limits/types'

const KEYS = {
  users: ['admin', 'users'] as const,
  managers: ['admin', 'managers'] as const,
  grants: (userId: string) => ['admin', 'grants', userId] as const,
}

export interface AdminUser {
  user_id: string
  email: string
  last_sign_in_at: string | null
  created_at: string
  roles: UserRole[]
  // Provisioning state (migration 0022)
  full_name: string | null
  must_change_password: boolean
  disabled: boolean
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
        full_name: (row.full_name as string | null) ?? null,
        must_change_password: row.must_change_password === true,
        disabled: row.disabled === true,
      }))
    },
  })
}

/** The user with exactly these roles, in the canonical order. */
export function withRoles(user: AdminUser, roles: readonly UserRole[]): AdminUser {
  return { ...user, roles: USER_ROLES.filter((role) => roles.includes(role)) }
}

export function useSetUserRoles() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['admin', 'roles'],
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
    // The chips repaint at once; a refusal restores them.
    ...optimistic<{ userId: string; roles: UserRole[] }, void>(queryClient, {
      patches: () => [
        rowInList<AdminUser, { userId: string; roles: UserRole[] }>(
          KEYS.users,
          (v) => v.userId,
          (user, v) => withRoles(user, v.roles),
          (user) => user.user_id,
        ),
      ],
    }),
  })
}

// ---------------------------------------------------------------------------
// Direct managers (0060): offered first as the validator of a person's limit
// decisions. Set by admin through tci.set_user_manager only.
// ---------------------------------------------------------------------------

/** Everyone's direct manager: user id -> manager id (absent = none). */
export function useUserManagers() {
  return useQuery({
    queryKey: KEYS.managers,
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await tci().rpc('user_managers')
      if (error) throw error
      const out: Record<string, string> = {}
      for (const row of (data ?? []) as { user_id: string; manager_id: string | null }[]) {
        if (row.manager_id) out[row.user_id] = row.manager_id
      }
      return out
    },
  })
}

/** With `manager` as `user`'s manager (null clears it). Pure; the patch. */
export function withManager(
  managers: Record<string, string>,
  user: string,
  manager: string | null,
): Record<string, string> {
  const next = { ...managers }
  if (manager) next[user] = manager
  else delete next[user]
  return next
}

/** Certain once the function accepts it (admin only; never oneself; staff
 * only — refused by name otherwise), so the column repaints at once. */
export function useSetUserManager() {
  const queryClient = useQueryClient()
  type Vars = { userId: string; managerId: string | null }
  return useMutation({
    mutationKey: ['admin', 'manager'],
    mutationFn: async (input: Vars): Promise<void> => {
      const { error } = await tci().rpc('set_user_manager', {
        p_user: input.userId,
        p_manager: input.managerId,
      })
      if (error) throw error
    },
    ...optimistic<Vars, void>(queryClient, {
      patches: () => [
        patch<Record<string, string>, Vars>(KEYS.managers, (old, v) => withManager(old, v.userId, v.managerId), {
          exact: true,
        }),
      ],
      // the validator picker lists the manager first
      invalidate: () => [['limit-validations']],
    }),
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
    mutationKey: ['admin', 'delete-grant'],
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await tci().from('authority_grants').delete().eq('id', id)
      if (error) throw error
    },
    // The grant leaves the matrix at once; a refusal brings it back.
    ...optimistic<string, void>(queryClient, {
      patches: () => [rowOutOfList<AuthorityGrant, string>(KEYS.grants(userId), (id) => id)],
    }),
  })
}
