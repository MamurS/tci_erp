/** Data access for claims (migrations 0032-0036).
 *
 * Every write goes through a SQL function, never a raw insert or patch: the
 * status machine, the coverage engine, the indemnity freeze, the payment cap
 * and the recovery split all live there. A raw write would produce a row the
 * rules never saw.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, tci } from '../../lib/supabase'
import { CLAIM_DOCUMENTS_BUCKET, claimDocumentPath } from './documents'
import type {
  CauseOfLoss,
  Claim,
  ClaimDocument,
  ClaimDocumentType,
  ClaimInvoiceCoverage,
  ClaimPayment,
  ClaimPosition,
  ClaimStatus,
  ClaimStatusHistoryRow,
  CoverageVerdict,
  IndemnityTrace,
  PolicyLiability,
  Recovery,
} from './types'

const KEYS = {
  list: (scope: string) => ['claims', 'list', scope] as const,
  one: (id: string) => ['claims', 'one', id] as const,
  coverage: (id: string) => ['claims', 'coverage', id] as const,
  indemnity: (id: string) => ['claims', 'indemnity', id] as const,
  position: (id: string) => ['claims', 'position', id] as const,
  documents: (id: string) => ['claims', 'documents', id] as const,
  payments: (id: string) => ['claims', 'payments', id] as const,
  recoveries: (id: string) => ['claims', 'recoveries', id] as const,
  history: (id: string) => ['claims', 'history', id] as const,
  readiness: (id: string) => ['claims', 'readiness', id] as const,
  liability: (policyId: string) => ['claims', 'liability', policyId] as const,
}

export function useClaims(filter?: { policyId?: string; entityId?: string }) {
  const scope = filter?.policyId ?? filter?.entityId ?? 'all'
  return useQuery({
    queryKey: KEYS.list(scope),
    queryFn: async (): Promise<Claim[]> => {
      let q = tci().from('v_claims').select('*').order('created_at', { ascending: false })
      if (filter?.policyId) q = q.eq('policy_id', filter.policyId)
      if (filter?.entityId) q = q.eq('buyer_entity_id', filter.entityId)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as Claim[]
    },
  })
}

export function useClaim(id: string | undefined) {
  return useQuery({
    queryKey: KEYS.one(id ?? ''),
    enabled: Boolean(id),
    queryFn: async (): Promise<Claim | null> => {
      const { data, error } = await tci().from('v_claims').select('*').eq('id', id!).maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as Claim | null
    },
  })
}

export function useClaimCoverage(claimId: string | undefined) {
  return useQuery({
    queryKey: KEYS.coverage(claimId ?? ''),
    enabled: Boolean(claimId),
    queryFn: async (): Promise<ClaimInvoiceCoverage[]> => {
      const { data, error } = await tci()
        .from('v_claim_invoice_coverage')
        .select('*')
        .eq('claim_id', claimId!)
        .order('shipment_date', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as ClaimInvoiceCoverage[]
    },
  })
}

/** The live calculation. What was APPROVED is frozen on the claim itself
 * (`indemnity_trace`); this is what the figure would be right now. */
export function useIndemnity(claimId: string | undefined) {
  return useQuery({
    queryKey: KEYS.indemnity(claimId ?? ''),
    enabled: Boolean(claimId),
    queryFn: async (): Promise<IndemnityTrace> => {
      const { data, error } = await tci().rpc('calculate_indemnity', { p_claim_id: claimId! })
      if (error) throw error
      return data as unknown as IndemnityTrace
    },
  })
}

export function useClaimPosition(claimId: string | undefined) {
  return useQuery({
    queryKey: KEYS.position(claimId ?? ''),
    enabled: Boolean(claimId),
    queryFn: async (): Promise<ClaimPosition | null> => {
      const { data, error } = await tci()
        .from('v_claim_position')
        .select('*')
        .eq('claim_id', claimId!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as ClaimPosition | null
    },
  })
}

export function usePolicyLiability(policyId: string | undefined) {
  return useQuery({
    queryKey: KEYS.liability(policyId ?? ''),
    enabled: Boolean(policyId),
    queryFn: async (): Promise<PolicyLiability | null> => {
      const { data, error } = await tci()
        .from('v_policy_liability')
        .select('*')
        .eq('policy_id', policyId!)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as PolicyLiability | null
    },
  })
}

export function useClaimDocuments(claimId: string | undefined) {
  return useQuery({
    queryKey: KEYS.documents(claimId ?? ''),
    enabled: Boolean(claimId),
    queryFn: async (): Promise<ClaimDocument[]> => {
      const { data, error } = await tci()
        .from('claim_documents')
        .select('*')
        .eq('claim_id', claimId!)
        .order('uploaded_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as ClaimDocument[]
    },
  })
}

export function useClaimPayments(claimId: string | undefined) {
  return useQuery({
    queryKey: KEYS.payments(claimId ?? ''),
    enabled: Boolean(claimId),
    queryFn: async (): Promise<ClaimPayment[]> => {
      const { data, error } = await tci()
        .from('claim_payments')
        .select('*')
        .eq('claim_id', claimId!)
        .order('paid_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as ClaimPayment[]
    },
  })
}

export function useRecoveries(claimId: string | undefined) {
  return useQuery({
    queryKey: KEYS.recoveries(claimId ?? ''),
    enabled: Boolean(claimId),
    queryFn: async (): Promise<Recovery[]> => {
      const { data, error } = await tci()
        .from('recoveries')
        .select('*')
        .eq('claim_id', claimId!)
        .order('received_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as unknown as Recovery[]
    },
  })
}

export function useClaimHistory(claimId: string | undefined) {
  return useQuery({
    queryKey: KEYS.history(claimId ?? ''),
    enabled: Boolean(claimId),
    queryFn: async (): Promise<ClaimStatusHistoryRow[]> => {
      const { data, error } = await tci()
        .from('claim_status_history')
        .select('*')
        .eq('claim_id', claimId!)
        .order('changed_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ClaimStatusHistoryRow[]
    },
  })
}

/** The blockers and the checklist, straight from the database, so the screen
 * and the refusal can never disagree. */
export function useClaimReadiness(claimId: string | undefined) {
  return useQuery({
    queryKey: KEYS.readiness(claimId ?? ''),
    enabled: Boolean(claimId),
    queryFn: async (): Promise<{ blockers: string[]; missing: ClaimDocumentType[]; eligibleFrom: string | null }> => {
      const [blockers, missing, eligible] = await Promise.all([
        tci().rpc('claim_submission_blockers', { p_claim_id: claimId! }),
        tci().rpc('missing_claim_documents', { p_claim_id: claimId! }),
        tci().rpc('claim_eligible_from', { p_claim_id: claimId! }),
      ])
      if (blockers.error) throw blockers.error
      if (missing.error) throw missing.error
      if (eligible.error) throw eligible.error
      return {
        blockers: (blockers.data ?? []) as string[],
        missing: (missing.data ?? []) as ClaimDocumentType[],
        eligibleFrom: (eligible.data ?? null) as string | null,
      }
    },
  })
}

function useInvalidateClaims() {
  const qc = useQueryClient()
  return (claimId?: string) => {
    void qc.invalidateQueries({ queryKey: ['claims'] })
    void qc.invalidateQueries({ queryKey: ['agenda'] })
    // Approving suspends the buyer's limit.
    void qc.invalidateQueries({ queryKey: ['limits'] })
    if (claimId) void qc.invalidateQueries({ queryKey: KEYS.one(claimId) })
  }
}

export function useOpenClaim() {
  const invalidate = useInvalidateClaims()
  return useMutation({
    mutationFn: async (input: {
      policy_id: string
      entity_id: string
      cause_of_loss: CauseOfLoss
      overdue_notification_id?: string | null
      insolvency_reference?: string | null
    }) => {
      const { data, error } = await tci().rpc('open_claim', {
        p_policy_id: input.policy_id,
        p_entity_id: input.entity_id,
        p_cause: input.cause_of_loss,
        p_noa_id: input.overdue_notification_id ?? null,
        p_insolvency_reference: input.insolvency_reference ?? null,
      })
      if (error) throw error
      return data as unknown as Claim
    },
    onSuccess: () => invalidate(),
  })
}

export function useChangeClaimStatus() {
  const invalidate = useInvalidateClaims()
  return useMutation({
    mutationFn: async (input: { id: string; to: ClaimStatus; comment?: string | null }) => {
      const { error } = await tci().rpc('change_claim_status', {
        p_claim_id: input.id,
        p_to: input.to,
        p_comment: input.comment ?? null,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidate(v.id),
  })
}

export function useSaveClaimInvoice() {
  const invalidate = useInvalidateClaims()
  return useMutation({
    mutationFn: async (input: {
      claim_id: string
      invoice_id?: string | null
      invoice_number: string
      invoice_date: string
      shipment_date: string
      due_date: string
      amount: number
      paid_amount?: number
      disputed_amount?: number
      note?: string | null
    }) => {
      const { error } = await tci().rpc('save_claim_invoice', {
        p_claim_id: input.claim_id,
        p_invoice_number: input.invoice_number,
        p_invoice_date: input.invoice_date,
        p_shipment_date: input.shipment_date,
        p_due_date: input.due_date,
        p_amount: input.amount,
        p_paid_amount: input.paid_amount ?? 0,
        p_disputed_amount: input.disputed_amount ?? 0,
        p_note: input.note ?? null,
        p_invoice_id: input.invoice_id ?? null,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidate(v.claim_id),
  })
}

export function useDeleteClaimInvoice() {
  const invalidate = useInvalidateClaims()
  return useMutation({
    mutationFn: async (input: { claim_id: string; invoice_id: string }) => {
      const { error } = await tci().rpc('delete_claim_invoice', { p_invoice_id: input.invoice_id })
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidate(v.claim_id),
  })
}

export function useVerifyCoverage() {
  const invalidate = useInvalidateClaims()
  return useMutation({
    mutationFn: async (claimId: string) => {
      const { error } = await tci().rpc('verify_claim_coverage', { p_claim_id: claimId })
      if (error) throw error
    },
    onSuccess: (_d, claimId) => invalidate(claimId),
  })
}

export function useOverrideVerdict() {
  const invalidate = useInvalidateClaims()
  return useMutation({
    mutationFn: async (input: {
      claim_id: string
      claim_invoice_id: string
      verdict: CoverageVerdict
      covered_amount: number
      justification: string
    }) => {
      const { error } = await tci().rpc('override_claim_verdict', {
        p_claim_invoice_id: input.claim_invoice_id,
        p_verdict: input.verdict,
        p_covered_amount: input.covered_amount,
        p_justification: input.justification,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidate(v.claim_id),
  })
}

export function useClearOverride() {
  const invalidate = useInvalidateClaims()
  return useMutation({
    mutationFn: async (input: { claim_id: string; claim_invoice_id: string }) => {
      const { error } = await tci().rpc('clear_claim_verdict_override', {
        p_claim_invoice_id: input.claim_invoice_id,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidate(v.claim_id),
  })
}

export function useApproveClaim() {
  const invalidate = useInvalidateClaims()
  return useMutation({
    mutationFn: async (input: { id: string; comment?: string | null }) => {
      const { error } = await tci().rpc('approve_claim', {
        p_claim_id: input.id,
        p_comment: input.comment ?? null,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidate(v.id),
  })
}

export function useRecordPayment() {
  const invalidate = useInvalidateClaims()
  return useMutation({
    mutationFn: async (input: {
      claim_id: string
      amount: number
      paid_at: string
      reference?: string | null
    }) => {
      const { error } = await tci().rpc('record_claim_payment', {
        p_claim_id: input.claim_id,
        p_amount: input.amount,
        p_paid_at: input.paid_at,
        p_reference: input.reference ?? null,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidate(v.claim_id),
  })
}

export function useRecordRecovery() {
  const invalidate = useInvalidateClaims()
  return useMutation({
    mutationFn: async (input: {
      claim_id: string
      gross_amount: number
      recovery_costs: number
      received_at: string
      note?: string | null
    }) => {
      const { error } = await tci().rpc('record_recovery', {
        p_claim_id: input.claim_id,
        p_gross: input.gross_amount,
        p_costs: input.recovery_costs,
        p_received_at: input.received_at,
        p_note: input.note ?? null,
      })
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidate(v.claim_id),
  })
}

/** Upload: the bytes go straight to Storage under the claim's folder, then the
 * register row is written by tci.register_claim_document, which re-checks the
 * path, the size and the declared type. */
export function useUploadClaimDocument() {
  const invalidate = useInvalidateClaims()
  return useMutation({
    mutationFn: async (input: {
      claim_id: string
      file: File
      document_type: ClaimDocumentType
      note?: string | null
    }) => {
      const path = claimDocumentPath(input.claim_id, input.file.name)
      const { error: upErr } = await supabase.storage
        .from(CLAIM_DOCUMENTS_BUCKET)
        .upload(path, input.file, { contentType: input.file.type, upsert: false })
      if (upErr) throw upErr
      const { error } = await tci().rpc('register_claim_document', {
        p_claim_id: input.claim_id,
        p_storage_path: path,
        p_document_type: input.document_type,
        p_filename: input.file.name,
        p_size_bytes: input.file.size,
        p_content_type: input.file.type,
        p_note: input.note ?? null,
      })
      if (error) {
        // The register refused it, so the object must not be left orphaned.
        await supabase.storage.from(CLAIM_DOCUMENTS_BUCKET).remove([path])
        throw error
      }
    },
    onSuccess: (_d, v) => invalidate(v.claim_id),
  })
}

export function useDeleteClaimDocument() {
  const invalidate = useInvalidateClaims()
  return useMutation({
    mutationFn: async (input: { claim_id: string; document_id: string }) => {
      const { error } = await tci().rpc('delete_claim_document', { p_document_id: input.document_id })
      if (error) throw error
    },
    onSuccess: (_d, v) => invalidate(v.claim_id),
  })
}

/** A short-lived link to a private object. The bucket is not public, so this is
 * the only way to open one. */
export async function signedDocumentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(CLAIM_DOCUMENTS_BUCKET)
    .createSignedUrl(storagePath, 60)
  if (error) throw error
  return data.signedUrl
}
