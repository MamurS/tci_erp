/** The person's zoom (0076, tci.user_profiles.ui_scale) and text size (0081,
 * ui_text_scale) on the server: read once a session exists, written by the
 * pickers. The values are APPLIED through lib/uiScale.ts, which also caches
 * them for the next first paint. */

import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../../auth/AuthContext'
import { pinUiScale, setUiScale, setUiTextScale, uiScaleOrDefault, uiTextScaleOrDefault } from '../../lib/uiScale'
import type { UiScale, UiTextScale } from '../../lib/uiScale'
import { tci } from '../../lib/supabase'

const key = (userId: string) => ['ui-scale', userId] as const

/** Mounted once under the auth provider: applies the server's value. */
export function useUiScaleSync() {
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const query = useQuery({
    queryKey: key(userId ?? ''),
    enabled: Boolean(userId),
    staleTime: Infinity,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await tci().from('user_profiles').select('ui_scale').eq('user_id', userId!).maybeSingle()
      if (error) throw error
      return (data as { ui_scale: number | null } | null)?.ui_scale ?? null
    },
  })
  useEffect(() => {
    if (query.isSuccess) setUiScale(uiScaleOrDefault(query.data))
  }, [query.isSuccess, query.data])
}

/** Applies at once; saves for the person; a refused save keeps the size on
 * this device only (the next sign-in shows the server's value again). */
export function useSaveUiScale() {
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['ui-scale', 'save'],
    mutationFn: async (scale: UiScale) => {
      setUiScale(scale)
      if (!userId) return
      const { error } = await tci().from('user_profiles').update({ ui_scale: scale }).eq('user_id', userId)
      if (error) throw error
    },
    onSuccess: (_data, scale) => {
      if (userId) queryClient.setQueryData(key(userId), scale)
    },
  })
}

/** Print routes: the page is laid out at 100 % while it is open. */
export function usePrintScale() {
  useEffect(() => {
    pinUiScale(100)
    return () => pinUiScale(null)
  }, [])
}

// ---------------------------------------------------------------------------
// The text size (0081, tci.user_profiles.ui_text_scale). Its own query, so a
// database without the column yet (the migration is applied before merge)
// leaves the text at its default and the zoom untouched.
// ---------------------------------------------------------------------------

const textKey = (userId: string) => ['ui-text-scale', userId] as const

/** Mounted once under the auth provider: applies the server's text size. */
export function useUiTextScaleSync() {
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const query = useQuery({
    queryKey: textKey(userId ?? ''),
    enabled: Boolean(userId),
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<number | null> => {
      const { data, error } = await tci()
        .from('user_profiles')
        .select('ui_text_scale')
        .eq('user_id', userId!)
        .maybeSingle()
      if (error) throw error
      return (data as { ui_text_scale: number | null } | null)?.ui_text_scale ?? null
    },
  })
  useEffect(() => {
    if (query.isSuccess) setUiTextScale(uiTextScaleOrDefault(query.data))
  }, [query.isSuccess, query.data])
}

/** Applies at once; saves for the person, as the zoom does. */
export function useSaveUiTextScale() {
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['ui-text-scale', 'save'],
    mutationFn: async (text: UiTextScale) => {
      setUiTextScale(text)
      if (!userId) return
      const { error } = await tci().from('user_profiles').update({ ui_text_scale: text }).eq('user_id', userId)
      if (error) throw error
    },
    onSuccess: (_data, text) => {
      if (userId) queryClient.setQueryData(textKey(userId), text)
    },
  })
}
