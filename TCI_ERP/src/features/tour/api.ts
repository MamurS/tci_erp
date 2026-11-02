/**
 * The tour progress on the server (0098, tci.user_profiles.ui_tour_state).
 * Its OWN query, as the theme and the text size: a database without the
 * column answers an error, the tour then knows nothing (`available: false`)
 * and starts once per browser session instead (TourHost).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../../auth/AuthContext'
import { tci } from '../../lib/supabase'
import { parseTourState, recordTour } from './state'
import type { TourRecord, TourState } from './types'

const key = (userId: string) => ['ui-tour-state', userId] as const

export interface TourStateQuery {
  /** The answer is in (or the query failed). */
  ready: boolean
  /** The server holds the progress; false: the column is not there (or the read failed). */
  available: boolean
  state: TourState
}

export function useTourState(): TourStateQuery {
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const query = useQuery({
    queryKey: key(userId ?? ''),
    enabled: Boolean(userId),
    staleTime: Infinity,
    retry: false,
    queryFn: async (): Promise<TourState> => {
      const { data, error } = await tci()
        .from('user_profiles')
        .select('ui_tour_state')
        .eq('user_id', userId!)
        .maybeSingle()
      if (error) throw error
      return parseTourState((data as { ui_tour_state: unknown } | null)?.ui_tour_state)
    },
  })
  return {
    ready: query.isSuccess || query.isError,
    available: query.isSuccess,
    state: query.data ?? {},
  }
}

interface SaveInput {
  tourId: string
  status: TourRecord['status']
  lastStep: number
}

/** Records one tour's outcome on top of what the server last said. A refused
 * write is only logged: the tour has already closed, and TourHost remembers
 * it for this browser session. */
export function useRecordTour() {
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['ui-tour-state', 'save'],
    mutationFn: async ({ tourId, status, lastStep }: SaveInput): Promise<TourState> => {
      const current = (userId && queryClient.getQueryData<TourState>(key(userId))) || {}
      const next = recordTour(current, tourId, status, lastStep, new Date())
      if (userId) queryClient.setQueryData(key(userId), next)
      if (!userId) return next
      const { error } = await tci().from('user_profiles').update({ ui_tour_state: next }).eq('user_id', userId)
      if (error) throw error
      return next
    },
    onError: (error: unknown) => {
      console.error('Failed to save the tour progress', error)
    },
  })
}
