/**
 * Two narrow reads the triage bodies need and no feature exposes: one row of
 * the credit workbench's queue view, and a buyer's OPEN overdue
 * notifications. Both read existing views (RLS decides what comes back) and
 * reuse their types; nothing here computes or writes.
 */

import { useQuery } from '@tanstack/react-query'

import { tci } from '../../../lib/supabase'
import type { QueueRow } from '../../limits/workbench/types'
import type { OverdueNotification } from '../../overdue/types'

/** The request as tci.v_limit_request_queue sees it: the band it would be
 * decided in, its amount in UZS and the CALLER's authority for that band —
 * `decide_alone` is the database's answer to «can I decide this?». Null when
 * the request is no longer open. */
export function useLimitQueueRow(requestId: string | undefined) {
  return useQuery({
    queryKey: ['limits', 'workbench', 'queue', 'row', requestId ?? ''] as const,
    enabled: Boolean(requestId),
    queryFn: async (): Promise<QueueRow | null> => {
      const { data, error } = await tci()
        .from('v_limit_request_queue')
        .select('*')
        .eq('request_id', requestId!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as QueueRow | null
    },
  })
}

/** The buyer's overdue notifications that are still open, under any policy. */
export function useOpenOverduesForBuyer(entityId: string | undefined) {
  return useQuery({
    queryKey: ['overdues', 'buyer-open', entityId ?? ''] as const,
    enabled: Boolean(entityId),
    queryFn: async (): Promise<OverdueNotification[]> => {
      const { data, error } = await tci()
        .from('v_overdue_notifications')
        .select('*')
        .eq('buyer_entity_id', entityId!)
        .eq('status', 'open')
        .order('first_due_date', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as OverdueNotification[]
    },
  })
}
