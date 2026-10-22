/** Data access for contract drafts (migration 0057). Reads go through the
 * staff RLS (or the client views); every write is a gated function. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, tci } from '../../lib/supabase'
import type { MergeData } from '../wording/context'
import type { WordingTarget } from '../wording/api'
import type { ContractStatus, VersionSource } from './machine'
import type { ContractDoc } from './model'

export const SCANS_BUCKET = 'contract-scans'

export interface ContractDraft {
  id: string
  draft_number: string
  policy_id: string | null
  insurance_request_id: string | null
  template_id: string
  language: string
  status: ContractStatus
  current_version_id: string | null
  current_version_no: number
  shared_version_id: string | null
  shared_at: string | null
  signed_version_id: string | null
  signed_scan_path: string | null
  signed_scan_name: string | null
  signed_at: string | null
  signed_by: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface ContractDraftWithRefs extends ContractDraft {
  policies: { policy_number: string; entity_id: string; product_structure: string | null; legal_entities: { name: string; country_code: string | null } | null } | null
  insurance_requests: { request_number: string; entity_id: string; product_structure: string | null; legal_entities: { name: string; country_code: string | null } | null } | null
  wording_templates: { name: string; file_name: string; version: number; language: string } | null
}

/** A version without its content (the list). */
export interface VersionMeta {
  id: string
  draft_id: string
  version_no: number
  source: VersionSource
  restored_from_version: number | null
  template_id: string | null
  template_version: number | null
  change_note: string | null
  author_id: string
  created_at: string
  content_hash: string
  wording_templates: { name: string; file_name: string } | null
}

export interface ContractVersion extends VersionMeta {
  content: ContractDoc
}

export interface StatusChange {
  id: string
  draft_id: string
  from_status: ContractStatus | null
  to_status: ContractStatus
  version_id: string
  comment: string | null
  changed_by: string
  changed_at: string
}

export interface DraftComment {
  id: string
  draft_id: string
  version_id: string
  author_id: string
  author_side: 'staff' | 'client'
  body: string
  created_at: string
}

const KEYS = {
  all: ['contractDrafts'] as const,
  forTarget: (id: string) => ['contractDrafts', 'target', id] as const,
  draft: (id: string) => ['contractDrafts', 'draft', id] as const,
  versions: (id: string) => ['contractDrafts', 'versions', id] as const,
  version: (id: string, no: number) => ['contractDrafts', 'version', id, no] as const,
  history: (id: string) => ['contractDrafts', 'history', id] as const,
  comments: (id: string) => ['contractDrafts', 'comments', id] as const,
  mergeData: (id: string) => ['contractDrafts', 'mergeData', id] as const,
  portal: ['contractDrafts', 'portal'] as const,
}

const DRAFT_SELECT =
  '*, policies(policy_number, entity_id, product_structure, legal_entities(name, country_code)), insurance_requests(request_number, entity_id, product_structure, legal_entities(name, country_code)), wording_templates(name, file_name, version, language)'
const VERSION_META =
  'id, draft_id, version_no, source, restored_from_version, template_id, template_version, change_note, author_id, created_at, content_hash, wording_templates(name, file_name)'

/** The draft of a policy or a submission, if there is one. */
export function useDraftForTarget(target: WordingTarget | null | undefined) {
  const id = target?.policyId ?? target?.requestId ?? ''
  const column = target?.policyId ? 'policy_id' : 'insurance_request_id'
  return useQuery({
    queryKey: KEYS.forTarget(id),
    enabled: Boolean(id),
    queryFn: async (): Promise<ContractDraftWithRefs | null> => {
      const { data, error } = await tci().from('contract_drafts').select(DRAFT_SELECT).eq(column, id).maybeSingle()
      if (error) throw error
      return data as unknown as ContractDraftWithRefs | null
    },
  })
}

/** Every draft, the most recently changed first — the register. */
export function useAllDrafts() {
  return useQuery({
    queryKey: [...KEYS.all, 'list'],
    queryFn: async (): Promise<ContractDraftWithRefs[]> => {
      const { data, error } = await tci().from('contract_drafts').select(DRAFT_SELECT).order('updated_at', { ascending: false }).limit(500)
      if (error) throw error
      return (data ?? []) as unknown as ContractDraftWithRefs[]
    },
  })
}

export function useContractDraft(draftId: string | undefined) {
  return useQuery({
    queryKey: KEYS.draft(draftId ?? ''),
    enabled: Boolean(draftId),
    queryFn: async (): Promise<ContractDraftWithRefs> => {
      const { data, error } = await tci().from('contract_drafts').select(DRAFT_SELECT).eq('id', draftId!).single()
      if (error) throw error
      return data as unknown as ContractDraftWithRefs
    },
  })
}

export function useVersions(draftId: string | undefined) {
  return useQuery({
    queryKey: KEYS.versions(draftId ?? ''),
    enabled: Boolean(draftId),
    queryFn: async (): Promise<VersionMeta[]> => {
      const { data, error } = await tci()
        .from('contract_versions')
        .select(VERSION_META)
        .eq('draft_id', draftId!)
        .order('version_no', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as VersionMeta[]
    },
  })
}

export async function fetchVersion(draftId: string, versionNo: number): Promise<ContractVersion> {
  const { data, error } = await tci()
    .from('contract_versions')
    .select(`${VERSION_META}, content`)
    .eq('draft_id', draftId)
    .eq('version_no', versionNo)
    .single()
  if (error) throw error
  return data as unknown as ContractVersion
}

/** A version's content; versions never change, so it is cached for good. */
export function useVersion(draftId: string | undefined, versionNo: number | null | undefined) {
  return useQuery({
    queryKey: KEYS.version(draftId ?? '', versionNo ?? 0),
    enabled: Boolean(draftId) && typeof versionNo === 'number' && versionNo > 0,
    staleTime: Infinity,
    queryFn: () => fetchVersion(draftId!, versionNo!),
  })
}

export function useStatusHistory(draftId: string | undefined) {
  return useQuery({
    queryKey: KEYS.history(draftId ?? ''),
    enabled: Boolean(draftId),
    queryFn: async (): Promise<StatusChange[]> => {
      const { data, error } = await tci()
        .from('contract_draft_status_history')
        .select('*')
        .eq('draft_id', draftId!)
        .order('changed_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as StatusChange[]
    },
  })
}

export function useDraftComments(draftId: string | undefined) {
  return useQuery({
    queryKey: KEYS.comments(draftId ?? ''),
    enabled: Boolean(draftId),
    queryFn: async (): Promise<DraftComment[]> => {
      const { data, error } = await tci()
        .from('contract_draft_comments')
        .select('*')
        .eq('draft_id', draftId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as DraftComment[]
    },
  })
}

/** What the database says NOW for the draft's policy or submission. */
export function useCurrentMergeData(draft: Pick<ContractDraft, 'id' | 'policy_id' | 'insurance_request_id'> | null | undefined) {
  return useQuery({
    queryKey: KEYS.mergeData(draft?.id ?? ''),
    enabled: Boolean(draft),
    queryFn: () => fetchMergeData({ policyId: draft!.policy_id, requestId: draft!.insurance_request_id }),
  })
}

export async function fetchMergeData(target: { policyId?: string | null; requestId?: string | null }): Promise<MergeData> {
  const { data, error } = await tci().rpc('wording_merge_data', {
    p_policy_id: target.policyId ?? null,
    p_request_id: target.requestId ?? null,
  })
  if (error) throw error
  return data as unknown as MergeData
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: KEYS.all })
    // a status change opens or closes a review task
    void queryClient.invalidateQueries({ queryKey: ['agenda'] })
  }
}

export function useCreateDraft() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (input: { target: WordingTarget; templateId: string; content: ContractDoc; note?: string | null }) => {
      const { data, error } = await tci().rpc('create_contract_draft', {
        p_policy_id: input.target.policyId ?? null,
        p_request_id: input.target.requestId ?? null,
        p_template_id: input.templateId,
        p_content: input.content,
        p_change_note: input.note ?? null,
      })
      if (error) throw error
      return data as unknown as ContractDraft
    },
    onSuccess: invalidate,
  })
}

export interface SaveVersionInput {
  draftId: string
  baseVersionNo: number
  content: ContractDoc
  source: 'manual' | 'generated' | 'refreshed'
  note?: string | null
  templateId?: string | null
  confirmReplace?: boolean
}

export function useSaveVersion() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (input: SaveVersionInput) => {
      const { data, error } = await tci().rpc('save_contract_version', {
        p_draft_id: input.draftId,
        p_base_version_no: input.baseVersionNo,
        p_content: input.content,
        p_source: input.source,
        p_change_note: input.note ?? null,
        p_template_id: input.templateId ?? null,
        p_confirm_replace: input.confirmReplace ?? false,
      })
      if (error) throw error
      return data as unknown as VersionMeta
    },
    onSuccess: invalidate,
  })
}

export function useRestoreVersion() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (input: { draftId: string; baseVersionNo: number; versionNo: number; note?: string | null }) => {
      const { data, error } = await tci().rpc('restore_contract_version', {
        p_draft_id: input.draftId,
        p_base_version_no: input.baseVersionNo,
        p_version_no: input.versionNo,
        p_change_note: input.note ?? null,
      })
      if (error) throw error
      return data as unknown as VersionMeta
    },
    onSuccess: invalidate,
  })
}

export function useChangeStatus() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (input: { draftId: string; to: ContractStatus; comment?: string | null }) => {
      const { error } = await tci().rpc('change_contract_status', {
        p_draft_id: input.draftId,
        p_to: input.to,
        p_comment: input.comment ?? null,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useShareDraft() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (input: { draftId: string; share: boolean }) => {
      const { error } = await tci().rpc('share_contract_draft', { p_draft_id: input.draftId, p_share: input.share })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

export function useAddComment() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (input: { draftId: string; body: string }) => {
      const { error } = await tci().rpc('add_contract_comment', { p_draft_id: input.draftId, p_body: input.body })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/** Storage keys allow a narrow alphabet; the original name stays on the row. */
export function scanFileName(name: string): string {
  const base = name.replace(/\.pdf$/i, '').normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
  return `${(base || 'signed').slice(0, 80)}.pdf`
}

/** Upload the signed scan under the draft's folder, then sign (0057 checks
 * the path, that the object exists, and that the caller uploaded it). */
export function useSignDraft() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: async (input: { draftId: string; versionNo: number; file: File }) => {
      const path = `${input.draftId}/${crypto.randomUUID()}-${scanFileName(input.file.name)}`
      const { error: upError } = await supabase.storage
        .from(SCANS_BUCKET)
        .upload(path, input.file, { contentType: 'application/pdf', upsert: false })
      if (upError) throw upError
      const { error } = await tci().rpc('sign_contract_draft', {
        p_draft_id: input.draftId,
        p_version_no: input.versionNo,
        p_storage_path: path,
        p_file_name: input.file.name,
      })
      if (error) throw error
    },
    onSuccess: invalidate,
  })
}

/** A one-minute signed link that downloads the signed scan. */
export async function scanDownloadUrl(path: string, fileName: string): Promise<string> {
  const { data, error } = await supabase.storage.from(SCANS_BUCKET).createSignedUrl(path, 60, { download: fileName })
  if (error) throw error
  return data.signedUrl
}

// ---------------------------------------------------------------------------
// The portal (v_client_contract_drafts, v_client_contract_comments)
// ---------------------------------------------------------------------------

export interface PortalDraft {
  id: string
  draft_number: string
  policy_id: string | null
  insurance_request_id: string | null
  reference: string
  status: ContractStatus
  language: string
  version_no: number
  content: ContractDoc
  version_created_at: string
  shared_at: string | null
  signed_at: string | null
}

export interface PortalComment {
  id: string
  draft_id: string
  version_no: number
  body: string
  created_at: string
  mine: boolean
}

export function usePortalDrafts() {
  return useQuery({
    queryKey: KEYS.portal,
    queryFn: async (): Promise<PortalDraft[]> => {
      const { data, error } = await tci().from('v_client_contract_drafts').select('*').order('shared_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as PortalDraft[]
    },
  })
}

export function usePortalComments(draftId: string | null) {
  return useQuery({
    queryKey: [...KEYS.portal, 'comments', draftId ?? ''],
    enabled: Boolean(draftId),
    queryFn: async (): Promise<PortalComment[]> => {
      const { data, error } = await tci()
        .from('v_client_contract_comments')
        .select('*')
        .eq('draft_id', draftId!)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as PortalComment[]
    },
  })
}

export function useClientComment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { draftId: string; body: string }) => {
      const { error } = await tci().rpc('client_comment_contract_draft', { p_draft_id: input.draftId, p_body: input.body })
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEYS.portal }),
  })
}
