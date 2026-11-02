/** Demo data (0096–0097): the person's demo mode, and admin's load / unload. */

import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../../auth/AuthContext'
import { tci } from '../../lib/supabase'
import type { DemoCounts, DemoState, DemoUnloadResult } from './model'

const stateKey = (userId: string) => ['demo-state', userId] as const
const COUNTS_KEY = ['demo-counts'] as const

/** Other tabs of this browser share the session: a switch in one is followed. */
export const DEMO_MODE_STORAGE_KEY = 'tci-erp-demo-mode'

/**
 * The person's own demo state. Its own query: a database without 0096 answers
 * an error and the app simply has no demo mode (null).
 */
export function useDemoState() {
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  return useQuery({
    queryKey: stateKey(userId ?? ''),
    enabled: Boolean(userId),
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<DemoState | null> => {
      const { data, error } = await tci()
        .from('user_profiles')
        .select('ui_demo_mode, is_demo_user')
        .eq('user_id', userId!)
        .maybeSingle()
      if (error) return null
      const row = data as { ui_demo_mode: boolean; is_demo_user: boolean } | null
      return row ? { demoMode: row.ui_demo_mode, isDemoUser: row.is_demo_user } : null
    },
  })
}

/** Follows a switch made in another tab. Mounted once in each shell. */
export function useDemoModeTabSync() {
  const queryClient = useQueryClient()
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== DEMO_MODE_STORAGE_KEY) return
      void queryClient.resetQueries()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [queryClient])
}

/**
 * Switches the person between the real and the demo world. Everything fetched
 * in the other world is dropped: nothing of one world may stay on screen.
 */
export function useSetDemoMode() {
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['demo-mode', 'save'],
    mutationFn: async (on: boolean) => {
      if (!userId) return
      const { error } = await tci()
        .from('user_profiles')
        .update({ ui_demo_mode: on })
        .eq('user_id', userId)
      if (error) throw error
    },
    onSuccess: async (_data, on) => {
      try {
        window.localStorage.setItem(DEMO_MODE_STORAGE_KEY, `${on ? 'demo' : 'real'}:${Date.now()}`)
      } catch {
        // storage blocked: other tabs follow on their next load
      }
      await queryClient.resetQueries()
    },
  })
}

// ---------------------------------------------------------------------------
// Admin › Demo data
// ---------------------------------------------------------------------------

export function useDemoCounts() {
  return useQuery({
    queryKey: COUNTS_KEY,
    queryFn: async (): Promise<DemoCounts> => {
      const { data, error } = await tci().rpc('demo_data_counts')
      if (error) throw error
      return data as DemoCounts
    },
  })
}

export interface DemoLinkViolation {
  tbl: string
  col: string
  parent: string
  row_count: number
}

export function useDemoLinkCheck() {
  return useMutation({
    mutationKey: ['demo', 'check'],
    mutationFn: async (): Promise<DemoLinkViolation[]> => {
      const { data, error } = await tci().rpc('demo_link_violations')
      if (error) throw error
      return (data ?? []) as DemoLinkViolation[]
    },
  })
}

export function useLoadDemoData() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['demo', 'load'],
    mutationFn: async (
      password: string | null,
    ): Promise<DemoCounts & { already_loaded?: boolean }> => {
      const { data, error } = await tci().rpc('seed_demo_data', { p_password: password })
      if (error) throw error
      return data as DemoCounts & { already_loaded?: boolean }
    },
    onSuccess: (data) => queryClient.setQueryData(COUNTS_KEY, data),
  })
}

export function useUnloadDemoData() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['demo', 'unload'],
    mutationFn: async (): Promise<DemoUnloadResult> => {
      const { data, error } = await tci().rpc('delete_demo_data')
      if (error) throw error
      return data as DemoUnloadResult
    },
    onSuccess: (data) => queryClient.setQueryData(COUNTS_KEY, data.after),
  })
}

export function useSetNewUsersDemoMode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['demo', 'new-users'],
    mutationFn: async (on: boolean) => {
      const { error } = await tci().rpc('set_new_users_demo_mode', { p_on: on })
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: COUNTS_KEY }),
  })
}
