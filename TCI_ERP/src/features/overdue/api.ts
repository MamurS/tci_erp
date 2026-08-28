/** Data access for overdue notifications (migration 0028).
 *
 * Filing goes through tci.file_overdue_notification because that is where the
 * automatic limit suspension happens. A raw insert would create the
 * notification and leave the buyer's cover running.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import type { NoaStatus, OverdueNotification } from './types'

const KEYS = {
  list: (policyId?: string) => ['overdues', 'list', policyId ?? 'all'] as const,
  one: (id: string) => ['overdues', 'one', id] as const,
}

export function useOverdueNotifications(policyId?: string) {
  return useQuery({
    queryKey: KEYS.list(policyId),
    queryFn: async (): Promise<OverdueNotification[]> => {
      let q = tci()
        .from('v_overdue_notifications')
        .select('*')
        .order('first_due_date', { ascending: true })
      if (policyId) q = q.eq('policy_id', policyId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as OverdueNotification[]
    },
  })
}

export function useOverdueNotification(id: string | undefined) {
  return useQuery({
    queryKey: KEYS.one(id ?? ''),
    enabled: Boolean(id),
    queryFn: async (): Promise<OverdueNotification | null> => {
      const { data, error } = await tci()
        .from('v_overdue_notifications')
        .select('*')
        .eq('id', id!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as OverdueNotification | null
    },
  })
}

function useInvalidateOverdues() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['overdues'] })
    // Filing suspends a limit, so the limits views move too.
    void qc.invalidateQueries({ queryKey: ['limits'] })
    void qc.invalidateQueries({ queryKey: ['agenda'] })
  }
}

export function useFileNoa() {
  const invalidate = useInvalidateOverdues()
  return useMutation({
    mutationFn: async (input: {
      policy_id: string
      entity_id: string
      first_due_date: string
      overdue_amount: number
      currency_code?: string | null
    }) => {
      const { data, error } = await tci().rpc('file_overdue_notification', {
        p_policy_id: input.policy_id,
        p_entity_id: input.entity_id,
        p_first_due_date: input.first_due_date,
        p_overdue_amount: input.overdue_amount,
        p_currency: input.currency_code ?? null,
      })
      if (error) throw error
      return data as { noa_id: string; reported_late: boolean; suspension_decision_id: string | null }
    },
    onSuccess: invalidate,
  })
}

export function useResolveNoa() {
  const invalidate = useInvalidateOverdues()
  return useMutation({
    mutationFn: async (input: { id: string; status: NoaStatus; note?: string | null }) => {
      const { error } = await tci().rpc('resolve_overdue_notification', {
        p_noa_id: input.id,
        p_status: input.status,
        p_note: input.note ?? null,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}
