/** Information gathering before a limit decision (migration 0067). The
 * routing and the release are the database's; these hooks read what the
 * buyer still lacks, ask the database to re-check, and let credit
 * underwriting waive the gathering with a reason. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import { invalidateLimitWorkflow } from './api'
import { parseGaps } from './information'
import type { InformationGap } from './information'

const gapsKey = (entityId: string) => ['limit-information', entityId] as const

/** tci.buyer_information_gaps for one buyer. */
export function useBuyerInformationGaps(entityId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: gapsKey(entityId ?? ''),
    enabled: enabled && Boolean(entityId),
    queryFn: async (): Promise<InformationGap[]> => {
      const { data, error } = await tci().rpc('buyer_information_gaps', { p_entity_id: entityId })
      if (error) throw error
      return parseGaps(data)
    },
  })
}

function invalidate(queryClient: ReturnType<typeof useQueryClient>, entityId: string) {
  invalidateLimitWorkflow(queryClient)
  void queryClient.invalidateQueries({ queryKey: gapsKey(entityId) })
}

/** «Проверить снова»: answers what is still missing (empty = released). */
export function useRecheckInformation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['limits', 'recheck-information'],
    mutationFn: async (input: { requestId: string; entityId: string }): Promise<InformationGap[]> => {
      const { data, error } = await tci().rpc('recheck_limit_information', { p_request_id: input.requestId })
      if (error) throw error
      return parseGaps(data)
    },
    onSettled: (_data, _error, input) => invalidate(queryClient, input.entityId),
  })
}

/** Credit underwriting sends the request on without the information. */
export function useWaiveInformation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['limits', 'waive-information'],
    mutationFn: async (input: { requestId: string; entityId: string; comment: string }): Promise<void> => {
      const { error } = await tci().rpc('waive_limit_information', {
        p_request_id: input.requestId,
        p_comment: input.comment,
      })
      if (error) throw error
    },
    onSettled: (_data, _error, input) => invalidate(queryClient, input.entityId),
  })
}
