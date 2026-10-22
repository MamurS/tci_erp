/** Data access for policy premium (migrations 0027, 0056).
 *
 * Every write is one RPC that answers with the policy's instalments as they
 * now stand; the cache takes that answer, so nothing is refetched to show a
 * change. Recording a payment and invoicing paint at once (onMutate, with the
 * same oldest-first rule the database uses) and roll back on a refusal. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'
import { todayIso } from '../../components/ui/dateEntry'
import { allocate, netPaid } from './premium'
import type { PaymentSource, PolicyPremium, PremiumInstalment, PremiumPayment } from './premium'

export const PREMIUM_KEYS = {
  premium: (policyId: string) => ['premium', 'policy', policyId] as const,
  instalments: (policyId: string) => ['premium', 'instalments', policyId] as const,
  payments: (policyId: string) => ['premium', 'payments', policyId] as const,
  entries: (policyId: string) => ['premium', 'entries', policyId] as const,
  all: ['premium', 'all'] as const,
}

/** The Agenda board and its badge share this key (agenda/api.ts). */
const AGENDA_TASKS = ['agenda', 'tasks'] as const

export interface PremiumEntry {
  id: string
  declaration_id: string
  policy_id: string
  covered_turnover: number
  rate_used: number
  amount: number
  currency_code: string
  computed_at: string
}

export function usePolicyPremium(policyId: string | undefined) {
  return useQuery({
    queryKey: PREMIUM_KEYS.premium(policyId ?? ''),
    enabled: Boolean(policyId),
    queryFn: async (): Promise<PolicyPremium | null> => {
      const { data, error } = await tci()
        .from('v_policy_premium')
        .select('*')
        .eq('policy_id', policyId!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as PolicyPremium | null
    },
  })
}

/** The schedule with what has been paid against it (v_premium_instalments). */
export function usePremiumInstalments(policyId: string | undefined) {
  return useQuery({
    queryKey: PREMIUM_KEYS.instalments(policyId ?? ''),
    enabled: Boolean(policyId),
    queryFn: async (): Promise<PremiumInstalment[]> => {
      const { data, error } = await tci()
        .from('v_premium_instalments')
        .select('*')
        .eq('policy_id', policyId!)
        .order('sequence')
      if (error) throw error
      return (data ?? []) as unknown as PremiumInstalment[]
    },
  })
}

/** Payments and reversals, newest first. */
export function usePremiumPayments(policyId: string | undefined) {
  return useQuery({
    queryKey: PREMIUM_KEYS.payments(policyId ?? ''),
    enabled: Boolean(policyId),
    queryFn: async (): Promise<PremiumPayment[]> => {
      const { data, error } = await tci()
        .from('premium_payments')
        .select('*')
        .eq('policy_id', policyId!)
        .order('payment_date', { ascending: false })
        .order('recorded_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as PremiumPayment[]
    },
  })
}

/** Earned premium, one row per accepted declaration, each with the rate it
 * was written at. */
export function usePremiumEntries(policyId: string | undefined) {
  return useQuery({
    queryKey: PREMIUM_KEYS.entries(policyId ?? ''),
    enabled: Boolean(policyId),
    queryFn: async (): Promise<PremiumEntry[]> => {
      const { data, error } = await tci()
        .from('premium_entries')
        .select('*')
        .eq('policy_id', policyId!)
        .order('computed_at')
      if (error) throw error
      return (data ?? []) as unknown as PremiumEntry[]
    },
  })
}

/** What a write changes besides the schedule it answers with: the policy
 * totals, the payments list, the roll-up, and the chasing tasks. */
function settle(qc: QueryClient, policyId: string, rows: PremiumInstalment[] | undefined) {
  if (rows) qc.setQueryData(PREMIUM_KEYS.instalments(policyId), rows)
  void qc.invalidateQueries({ queryKey: PREMIUM_KEYS.premium(policyId) })
  void qc.invalidateQueries({ queryKey: PREMIUM_KEYS.payments(policyId) })
  void qc.invalidateQueries({ queryKey: PREMIUM_KEYS.all })
  void qc.invalidateQueries({ queryKey: AGENDA_TASKS })
}

/** Snapshot + optimistic change of the schedule; the returned context rolls it back. */
async function paint(
  qc: QueryClient,
  policyId: string,
  change: (rows: PremiumInstalment[]) => PremiumInstalment[],
): Promise<{ previous: PremiumInstalment[] | undefined }> {
  const key = PREMIUM_KEYS.instalments(policyId)
  await qc.cancelQueries({ queryKey: key })
  const previous = qc.getQueryData<PremiumInstalment[]>(key)
  if (previous) qc.setQueryData(key, change(previous))
  return { previous }
}

function rollback(qc: QueryClient, policyId: string, context: { previous: PremiumInstalment[] | undefined } | undefined) {
  if (context?.previous) qc.setQueryData(PREMIUM_KEYS.instalments(policyId), context.previous)
}

export interface InvoiceInput {
  instalmentId: string
  invoiceNumber: string
  invoiceDate: string
  note: string | null
}

export function useInvoiceInstalment(policyId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: InvoiceInput): Promise<PremiumInstalment[]> => {
      const { data, error } = await tci().rpc('invoice_premium_instalment', {
        p_instalment_id: input.instalmentId,
        p_invoice_number: input.invoiceNumber,
        p_invoice_date: input.invoiceDate,
        p_note: input.note,
      })
      if (error) throw error
      return (data ?? []) as unknown as PremiumInstalment[]
    },
    onMutate: (input) =>
      paint(qc, policyId, (rows) =>
        rows.map((r) =>
          r.id === input.instalmentId
            ? {
                ...r,
                status: 'invoiced',
                invoiced_at: new Date().toISOString(),
                invoice_number: input.invoiceNumber.trim(),
                invoice_date: input.invoiceDate,
                derived_status: r.derived_status === 'pending' ? 'invoiced' : r.derived_status,
              }
            : r,
        ),
      ),
    onError: (_e, _input, context) => rollback(qc, policyId, context),
    onSuccess: (rows) => settle(qc, policyId, rows),
  })
}

export interface PaymentInput {
  amount: number
  paymentDate: string
  currency: string
  reference: string | null
  source: PaymentSource
  note: string | null
}

export function useRecordPayment(policyId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: PaymentInput): Promise<PremiumInstalment[]> => {
      const { data, error } = await tci().rpc('record_premium_payment', {
        p_policy_id: policyId,
        p_amount: input.amount,
        p_payment_date: input.paymentDate,
        p_currency: input.currency,
        p_reference: input.reference,
        p_source: input.source,
        p_note: input.note,
      })
      if (error) throw error
      return (data ?? []) as unknown as PremiumInstalment[]
    },
    // The schedule repaints with the payment allocated oldest first, exactly
    // as the view will: what was paid so far plus this payment.
    onMutate: (input) =>
      paint(qc, policyId, (rows) => {
        const paidSoFar = rows.reduce((sum, r) => sum + Number(r.paid_amount), 0)
        return allocate(rows, paidSoFar + input.amount, todayIso())
      }),
    onError: (_e, _input, context) => rollback(qc, policyId, context),
    onSuccess: (rows) => settle(qc, policyId, rows),
  })
}

export function useReversePayment(policyId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { paymentId: string; reason: string }): Promise<PremiumInstalment[]> => {
      const { data, error } = await tci().rpc('reverse_premium_payment', {
        p_payment_id: input.paymentId,
        p_reason: input.reason,
      })
      if (error) throw error
      return (data ?? []) as unknown as PremiumInstalment[]
    },
    onMutate: async (input) => {
      const payments = qc.getQueryData<PremiumPayment[]>(PREMIUM_KEYS.payments(policyId)) ?? []
      const reversed = payments.find((p) => p.id === input.paymentId)
      return paint(qc, policyId, (rows) =>
        reversed ? allocate(rows, netPaid(payments) - Number(reversed.amount), todayIso()) : rows,
      )
    },
    onError: (_e, _input, context) => rollback(qc, policyId, context),
    onSuccess: (rows) => settle(qc, policyId, rows),
  })
}

/** Generate the schedule. Refuses when anything has been invoiced, which is
 * the point: an instalment that has been billed is a fact. Also the way a
 * policy created BEFORE migration 0027 gets its first schedule. */
export function useGenerateInstalments(policyId: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (replace: boolean): Promise<number> => {
      const { data, error } = await tci().rpc('generate_premium_instalments', {
        p_policy_id: policyId,
        p_replace: replace,
      })
      if (error) throw error
      return Number(data ?? 0)
    },
    onSuccess: () => {
      if (!policyId) return
      void qc.invalidateQueries({ queryKey: PREMIUM_KEYS.instalments(policyId) })
      settle(qc, policyId, undefined)
    },
  })
}

/** Every policy's premium picture, for the dashboard roll-up. RLS decides
 * which policies come back; nothing here filters. */
export function useAllPolicyPremium() {
  return useQuery({
    queryKey: PREMIUM_KEYS.all,
    queryFn: async (): Promise<PolicyPremium[]> => {
      const { data, error } = await tci().from('v_policy_premium').select('*')
      if (error) throw error
      return (data ?? []) as unknown as PolicyPremium[]
    },
  })
}
