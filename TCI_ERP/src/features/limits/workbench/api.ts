/** Data access for the credit workbench views (migration 0053). */

import { useQuery } from '@tanstack/react-query'

import { tci } from '../../../lib/supabase'
import type { GroupLimitRow, QueueRow, RatingWorkRow } from './types'

/** Open requests with band, UZS amount and whether the caller decides alone.
 * Keyed under 'limits' so every decision mutation refreshes it. */
export function useLimitQueue(enabled = true) {
  return useQuery({
    queryKey: ['limits', 'workbench', 'queue'],
    enabled,
    queryFn: async (): Promise<QueueRow[]> => {
      const { data, error } = await tci().from('v_limit_request_queue').select('*')
      if (error) throw error
      return (data ?? []) as unknown as QueueRow[]
    },
  })
}

export function useRatingWorklist(enabled = true) {
  return useQuery({
    queryKey: ['limits', 'workbench', 'ratings'],
    enabled,
    queryFn: async (): Promise<RatingWorkRow[]> => {
      const { data, error } = await tci().from('v_rating_worklist').select('*')
      if (error) throw error
      return (data ?? []) as unknown as RatingWorkRow[]
    },
  })
}

export function useGroupLimitStatus(enabled = true) {
  return useQuery({
    queryKey: ['limits', 'workbench', 'groups'],
    enabled,
    queryFn: async (): Promise<GroupLimitRow[]> => {
      const { data, error } = await tci().from('v_group_limit_status').select('*')
      if (error) throw error
      return (data ?? []) as unknown as GroupLimitRow[]
    },
  })
}
