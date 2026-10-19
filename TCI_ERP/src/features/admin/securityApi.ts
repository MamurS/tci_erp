/** Admin security surface (migration 0044): events, lockouts, sessions,
 * per-user state, alerts. Every read is an admin-gated SECURITY DEFINER
 * view; every write an admin-gated function. A non-admin gets empty lists
 * and 42501, never data. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'

const KEYS = {
  events: ['admin', 'security', 'events'] as const,
  lockouts: ['admin', 'security', 'lockouts'] as const,
  sessions: ['admin', 'security', 'sessions'] as const,
  users: ['admin', 'security', 'users'] as const,
  alerts: ['admin', 'security', 'alerts'] as const,
  policy: ['admin', 'security', 'policy'] as const,
}

export interface AuthEventRow {
  id: number
  at: string
  event_type: string
  user_id: string | null
  email: string | null
  actor_user_id: string | null
  actor_email: string | null
  ip_known: boolean
  details: Record<string, unknown>
}

export interface LockoutRow {
  user_id: string
  email: string | null
  locked_at: string
  locked_until: string
  failures: number
  cleared_at: string | null
  cleared_by_email: string | null
  active: boolean
  /** failures: wrong passwords (ends by itself); bypass: a correct password
   * arrived without the sign-in form — reset the password, then unlock. */
  reason?: 'failures' | 'bypass'
}

export interface SessionRow {
  id: string
  user_id: string
  email: string
  created_at: string | null
  updated_at: string | null
  refreshed_at: string | null
  aal: string | null
  user_agent: string | null
  ip_network: string | null
  not_after: string | null
  is_current: boolean
}

export interface UserSecurityRow {
  user_id: string
  email: string
  mfa_factors: number
  sessions: number
  locked: boolean
  locked_until: string | null
  last_failure_at: string | null
  failures_in_window: number
  last_success_at: string | null
}

export interface SecurityAlert {
  alert: 'lockout_burst' | 'failed_login_spike' | 'admin_role_granted' | string
  severity: 'high' | 'medium' | string
  n: number
  since: string | null
}

export interface AuthPolicy {
  lockout_max_failures: number
  lockout_window_minutes: number
  lockout_duration_minutes: number
  mfa_required_for_admin: boolean
  mfa_staff_enforced_from: string | null
  auth_events_retention_days: number
  /** Migration 0046 (absent on an older backend). */
  login_gate_enforced?: boolean
  login_free_attempts?: number
  login_base_lock_seconds?: number
  login_max_lock_seconds?: number
}

export function useAuthPolicy() {
  return useQuery({
    queryKey: KEYS.policy,
    queryFn: async (): Promise<AuthPolicy> => {
      const { data, error } = await tci().rpc('auth_policy')
      if (error) throw error
      return data as AuthPolicy
    },
    staleTime: 60_000,
  })
}

export function useSecurityAlerts() {
  return useQuery({
    queryKey: KEYS.alerts,
    queryFn: async (): Promise<SecurityAlert[]> => {
      const { data, error } = await tci().from('v_admin_security_alerts').select('*')
      if (error) throw error
      return (data ?? []) as SecurityAlert[]
    },
  })
}

export function useAuthEvents(limit = 200) {
  return useQuery({
    queryKey: [...KEYS.events, limit],
    queryFn: async (): Promise<AuthEventRow[]> => {
      // Retention is applied on read, the Agenda way: no cron anywhere.
      const { error: pruneError } = await tci().rpc('prune_auth_data')
      if (pruneError && pruneError.code !== '42501') console.error('prune_auth_data failed', pruneError)
      const { data, error } = await tci()
        .from('v_admin_auth_events')
        .select('*')
        .order('at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return (data ?? []) as AuthEventRow[]
    },
  })
}

export function useLockouts() {
  return useQuery({
    queryKey: KEYS.lockouts,
    queryFn: async (): Promise<LockoutRow[]> => {
      const { data, error } = await tci()
        .from('v_admin_lockouts')
        .select('*')
        .order('locked_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data ?? []) as LockoutRow[]
    },
  })
}

export function useAdminSessions() {
  return useQuery({
    queryKey: KEYS.sessions,
    queryFn: async (): Promise<SessionRow[]> => {
      const { data, error } = await tci()
        .from('v_admin_sessions')
        .select('*')
        .order('updated_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as SessionRow[]
    },
  })
}

export function useUserSecurity() {
  return useQuery({
    queryKey: KEYS.users,
    queryFn: async (): Promise<UserSecurityRow[]> => {
      const { data, error } = await tci().from('v_admin_user_security').select('*').order('email')
      if (error) throw error
      return (data ?? []) as UserSecurityRow[]
    },
  })
}

function useInvalidateSecurity() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ['admin', 'security'] })
}

export function useUnlockAccount() {
  const invalidate = useInvalidateSecurity()
  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await tci().rpc('unlock_account', { p_user_id: userId })
      if (error) throw error
    },
    onSuccess: () => void invalidate(),
  })
}

export function useRevokeSessions() {
  const invalidate = useInvalidateSecurity()
  return useMutation({
    mutationFn: async (input: { userId: string; keepCurrent: boolean }): Promise<number> => {
      const { data, error } = await tci().rpc('revoke_user_sessions', {
        p_user_id: input.userId,
        p_keep_current: input.keepCurrent,
      })
      if (error) throw error
      return Number(data ?? 0)
    },
    onSuccess: () => void invalidate(),
  })
}

/** Switch the sign-in gate's enforcement (tci.set_login_gate_enforced). */
export function useSetLoginGateEnforced() {
  const invalidate = useInvalidateSecurity()
  return useMutation({
    mutationFn: async (enforced: boolean) => {
      const { error } = await tci().rpc('set_login_gate_enforced', { p_enforced: enforced })
      if (error) throw error
    },
    onSuccess: () => void invalidate(),
  })
}
