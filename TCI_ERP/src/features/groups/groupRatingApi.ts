/** The group rating (migration 0074): read by the credit desk and admin,
 * set and ended by a senior credit analyst. A set caps members at once, so
 * the members' grades and the grade badges are refetched. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import type { GroupRatingState } from './groupRating'

export const groupRatingKey = (entityId: string) => ['groups', 'rating', entityId] as const

export function useGroupRating(entityId: string, enabled: boolean) {
  return useQuery({
    queryKey: groupRatingKey(entityId),
    enabled,
    queryFn: async (): Promise<GroupRatingState> => {
      const { data, error } = await tci().rpc('group_rating_state', { p_entity_id: entityId })
      if (error) throw error
      return data as GroupRatingState
    },
  })
}

export function useGroupRatingActions(entityId: string) {
  const queryClient = useQueryClient()
  const settle = (state: GroupRatingState) => {
    queryClient.setQueryData(groupRatingKey(entityId), state)
    // members of the group are capped: every grade may have moved
    void queryClient.invalidateQueries({ queryKey: ['buyers'] })
    void queryClient.invalidateQueries({ queryKey: ['entities'] })
    void queryClient.invalidateQueries({ queryKey: ['groups', 'rating'] })
    void queryClient.invalidateQueries({ queryKey: ['limits'] })
  }
  const set = useMutation({
    mutationKey: ['groups', 'rating', 'set'],
    mutationFn: async (input: { grade: string; reason: string }): Promise<GroupRatingState> => {
      const { data, error } = await tci().rpc('set_group_rating', {
        p_entity_id: entityId,
        p_grade: input.grade,
        p_reason: input.reason,
      })
      if (error) throw error
      return data as GroupRatingState
    },
    onSuccess: settle,
  })
  const end = useMutation({
    mutationKey: ['groups', 'rating', 'end'],
    mutationFn: async (reason: string): Promise<GroupRatingState> => {
      const { data, error } = await tci().rpc('end_group_rating', { p_entity_id: entityId, p_reason: reason })
      if (error) throw error
      return data as GroupRatingState
    },
    onSuccess: settle,
  })
  return { set, end }
}
