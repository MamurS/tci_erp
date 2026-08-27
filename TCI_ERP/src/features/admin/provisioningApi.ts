/** TanStack Query bindings for the provisioning service. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import {
  createUser,
  provisioningAvailable,
  resetUserPassword,
  setUserDisabled,
} from '../../lib/provisioning'
import type { CreateUserInput, ProvisionedUser } from '../../lib/provisioning'

/** Whether the provisioning service is up AND holds its key. Cached for a
 * minute: a screen full of buttons should not probe it repeatedly. */
export function useProvisioningAvailable() {
  return useQuery({
    queryKey: ['provisioning', 'available'],
    queryFn: provisioningAvailable,
    staleTime: 60_000,
    retry: false,
  })
}

function invalidateDirectories(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
  void queryClient.invalidateQueries({ queryKey: ['entity-client-users'] })
}

export function useCreateUser() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateUserInput): Promise<ProvisionedUser> => createUser(input),
    onSuccess: () => invalidateDirectories(queryClient),
  })
}

export function useResetUserPassword() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: string): Promise<ProvisionedUser> => resetUserPassword(userId),
    onSuccess: () => invalidateDirectories(queryClient),
  })
}

export function useSetUserDisabled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { userId: string; disabled: boolean }) =>
      setUserDisabled(input.userId, input.disabled),
    onSuccess: () => invalidateDirectories(queryClient),
  })
}

export interface EntityClientUser {
  entity_id: string
  user_id: string
  email: string
  full_name: string | null
  last_sign_in_at: string | null
  created_at: string
  must_change_password: boolean
  disabled: boolean
}

/** Portal users of one company (tci.v_entity_client_users, migration 0022).
 * Returns nothing unless the caller is admin/sales/commercial. */
export function useEntityClientUsers(entityId: string) {
  return useQuery({
    queryKey: ['entity-client-users', entityId],
    enabled: Boolean(entityId),
    queryFn: async (): Promise<EntityClientUser[]> => {
      const { data, error } = await tci()
        .from('v_entity_client_users')
        .select('*')
        .eq('entity_id', entityId)
        .order('email')
      if (error) throw error
      return (data ?? []) as unknown as EntityClientUser[]
    },
  })
}
