/** Data access for wording templates, the insurer's particulars and
 *  generated draft contracts (migration 0050). */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { supabase, tci } from '../../lib/supabase'
import type { MergeData } from './context'
import { DOCX_MIME, inspectTemplate, renderTemplate, WordingError } from './docx'

export const WORDING_BUCKET = 'wording'

export type ProductStructure = 'whole_turnover' | 'key_buyers' | 'single_buyer'
export type TemplateStatus = 'draft' | 'active' | 'retired'

export interface WordingTemplate {
  id: string
  name: string
  description: string | null
  country_code: string | null
  language: string
  product_structure: ProductStructure | null
  version: number
  status: TemplateStatus
  storage_path: string
  file_name: string
  size_bytes: number
  placeholders: string[]
  uploaded_at: string
  activated_at: string | null
  retired_at: string | null
}

export interface PolicyDocument {
  id: string
  policy_id: string | null
  insurance_request_id: string | null
  template_id: string
  template_version: number
  language: string
  storage_path: string
  file_name: string
  generated_at: string
  wording_templates: { name: string; file_name: string } | null
}

export interface InsurerProfile {
  legal_name: string | null
  legal_form: string | null
  registration_number: string | null
  tax_id: string | null
  license_number: string | null
  license_date: string | null
  country_code: string | null
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  bank_name: string | null
  bank_account: string | null
  bank_code: string | null
  signatory_name: string | null
  signatory_title: string | null
  signatory_basis: string | null
  updated_at: string
}

/** A policy or a submission: exactly one. */
export type WordingTarget = { policyId: string; requestId?: never } | { requestId: string; policyId?: never }

const targetId = (t: WordingTarget): string => t.policyId ?? t.requestId ?? ''

/** Refused with a reason the screen names (see errors.ts). */
export { WordingError }

export function useWordingTemplates() {
  return useQuery({
    queryKey: ['wording', 'templates'],
    queryFn: async (): Promise<WordingTemplate[]> => {
      const { data, error } = await tci()
        .from('wording_templates')
        .select('*')
        .order('status')
        .order('language')
        .order('version', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as WordingTemplate[]
    },
  })
}

export function useInsurerProfile() {
  return useQuery({
    queryKey: ['wording', 'insurer'],
    queryFn: async (): Promise<InsurerProfile | null> => {
      const { data, error } = await tci().from('insurer_profile').select('*').maybeSingle()
      if (error) throw error
      return data as unknown as InsurerProfile | null
    },
  })
}

export function useSaveInsurerProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: Omit<InsurerProfile, 'updated_at'>) => {
      const { data: auth } = await supabase.auth.getUser()
      const { error } = await tci()
        .from('insurer_profile')
        .update({ ...input, updated_at: new Date().toISOString(), updated_by: auth.user?.id ?? null })
        .eq('id', true)
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['wording', 'insurer'] }),
  })
}

/** Storage keys allow a narrow alphabet; the original name stays on the row. */
export function storageFileName(name: string): string {
  const base = name.replace(/\.docx$/i, '').normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '')
  return `${(base || 'template').slice(0, 80)}.docx`
}

export interface UploadTemplateInput {
  file: Blob
  fileName: string
  name: string
  description: string
  countryCode: string | null
  language: string
  product: ProductStructure | null
}

/** Inspect the file in the browser, store it, then register it (0050 checks
 *  the path, that the object exists, that the caller uploaded it). */
export function useUploadWordingTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: UploadTemplateInput) => {
      const buffer = await input.file.arrayBuffer()
      const inspection = inspectTemplate(buffer)
      if (inspection.error) throw new WordingError('invalid_template', inspection.error)
      const id = crypto.randomUUID()
      const fileName = storageFileName(input.fileName)
      const path = `templates/${id}/${fileName}`
      const { error: upError } = await supabase.storage
        .from(WORDING_BUCKET)
        .upload(path, input.file, { contentType: DOCX_MIME, upsert: false })
      if (upError) throw upError
      const { data, error } = await tci().rpc('register_wording_template', {
        p_id: id,
        p_name: input.name,
        p_description: input.description || null,
        p_country: input.countryCode,
        p_language: input.language,
        p_product: input.product,
        p_storage_path: path,
        p_file_name: fileName,
        p_placeholders: inspection.placeholders,
      })
      if (error) throw error
      return { template: data as unknown as WordingTemplate, unknown: inspection.unknown }
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['wording', 'templates'] }),
  })
}

export function useSetTemplateStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; status: 'active' | 'retired' }) => {
      const { error } = await tci().rpc('set_wording_template_status', { p_id: input.id, p_status: input.status })
      if (error) throw error
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['wording', 'templates'] }),
  })
}

export function usePolicyDocuments(target: WordingTarget) {
  const column = target.policyId ? 'policy_id' : 'insurance_request_id'
  return useQuery({
    queryKey: ['wording', 'documents', targetId(target)],
    queryFn: async (): Promise<PolicyDocument[]> => {
      const { data, error } = await tci()
        .from('policy_documents')
        .select('id, policy_id, insurance_request_id, template_id, template_version, language, storage_path, file_name, generated_at, wording_templates(name, file_name)')
        .eq(column, targetId(target))
        .order('generated_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as PolicyDocument[]
    },
  })
}

export interface PolicyDocumentWithRefs extends PolicyDocument {
  generated_by: string
  policies: { policy_number: string } | null
  insurance_requests: { request_number: string } | null
}

/** Every generated draft contract, newest first — the contracts register. */
export function useAllPolicyDocuments() {
  return useQuery({
    queryKey: ['wording', 'documents', 'all'],
    queryFn: async (): Promise<PolicyDocumentWithRefs[]> => {
      const { data, error } = await tci()
        .from('policy_documents')
        .select(
          'id, policy_id, insurance_request_id, template_id, template_version, language, storage_path, file_name, generated_at, generated_by, wording_templates(name, file_name), policies(policy_number), insurance_requests(request_number)',
        )
        .order('generated_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []) as unknown as PolicyDocumentWithRefs[]
    },
  })
}

export async function fetchTemplateBytes(path: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage.from(WORDING_BUCKET).download(path)
  if (error) throw error
  return data.arrayBuffer()
}

export interface GenerateInput {
  target: WordingTarget
  template: WordingTemplate
  /** Builds the printable context in the template's language. */
  buildContext: (data: MergeData) => Record<string, unknown>
  /** The name the person downloads, e.g. "TCI-2026-001 — Договор.docx". */
  downloadName: string
}

/** Merge data from the database, words from the template, rendered here,
 *  stored, then registered — the database records what the document said. */
export function useGenerateDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: GenerateInput): Promise<Blob> => {
      const { data, error } = await tci().rpc('wording_merge_data', {
        p_policy_id: input.target.policyId ?? null,
        p_request_id: input.target.requestId ?? null,
      })
      if (error) throw error
      const blob = renderTemplate(await fetchTemplateBytes(input.template.storage_path), input.buildContext(data as unknown as MergeData))
      const id = crypto.randomUUID()
      const path = `documents/${targetId(input.target)}/${id}.docx`
      const { error: upError } = await supabase.storage
        .from(WORDING_BUCKET)
        .upload(path, blob, { contentType: DOCX_MIME, upsert: false })
      if (upError) throw upError
      const { error: regError } = await tci().rpc('register_policy_document', {
        p_id: id,
        p_policy_id: input.target.policyId ?? null,
        p_request_id: input.target.requestId ?? null,
        p_template_id: input.template.id,
        p_storage_path: path,
        p_file_name: input.downloadName,
      })
      if (regError) throw regError
      return blob
    },
    // The target's own list and the contracts register both change.
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['wording', 'documents'] }),
  })
}

/** A one-minute signed link that downloads the stored file under its name. */
export async function wordingDownloadUrl(path: string, fileName: string): Promise<string> {
  const { data, error } = await supabase.storage.from(WORDING_BUCKET).createSignedUrl(path, 60, { download: fileName })
  if (error) throw error
  return data.signedUrl
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** The active template that fits best: the policyholder's country beats any
 *  country, the exact product beats any product, the UI language beats
 *  other languages. */
export function bestTemplate(
  templates: readonly WordingTemplate[],
  want: { countryCode: string | null; product: ProductStructure | null; language: string },
): WordingTemplate | null {
  const score = (t: WordingTemplate): number =>
    (t.country_code === want.countryCode && want.countryCode ? 4 : t.country_code === null ? 1 : -100) +
    (t.product_structure === want.product && want.product ? 2 : t.product_structure === null ? 1 : -100) +
    (t.language === want.language ? 3 : 0)
  const candidates = templates.filter((t) => t.status === 'active').map((t) => ({ t, s: score(t) })).filter((x) => x.s > 0)
  candidates.sort((a, b) => b.s - a.s)
  return candidates[0]?.t ?? null
}
