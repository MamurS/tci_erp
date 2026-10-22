/** Data access for commercial offers (migration 0058). Staff read through RLS
 * and tci.v_commercial_offers; the portal reads tci.v_client_offers only;
 * every write is a gated function. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'

import { optimistic, rowInList } from '../../lib/optimistic'
import { tci } from '../../lib/supabase'
import type { OfferParams } from './kp/params'
import type { ClientOffer, OfferLang, OfferRow, OfferVersion } from './model'

export const OFFER_KEYS = {
  all: ['offers'] as const,
  forRequest: (requestId: string) => ['offers', 'request', requestId] as const,
  forEntity: (entityId: string) => ['offers', 'entity', entityId] as const,
  offer: (offerId: string) => ['offers', 'offer', offerId] as const,
  versions: (offerId: string) => ['offers', 'versions', offerId] as const,
  version: (offerId: string, versionNo: number) => ['offers', 'version', offerId, versionNo] as const,
  client: ['portal', 'offers'] as const,
}

/** The submission an offer belongs to moves when it is published or
 * withdrawn; its page and the portal's submissions follow. */
const REQUEST_KEY = (requestId: string) => ['insurance-requests', requestId] as const

export function useRequestOffers(requestId: string | undefined) {
  return useQuery({
    queryKey: OFFER_KEYS.forRequest(requestId ?? ''),
    enabled: Boolean(requestId),
    queryFn: async (): Promise<OfferRow[]> => {
      const { data, error } = await tci()
        .from('v_commercial_offers')
        .select('*')
        .eq('insurance_request_id', requestId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as OfferRow[]
    },
  })
}

export function useEntityOffers(entityId: string | undefined) {
  return useQuery({
    queryKey: OFFER_KEYS.forEntity(entityId ?? ''),
    enabled: Boolean(entityId),
    queryFn: async (): Promise<OfferRow[]> => {
      const { data, error } = await tci()
        .from('v_commercial_offers')
        .select('*')
        .eq('entity_id', entityId!)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as OfferRow[]
    },
  })
}

export function useOffer(offerId: string | undefined) {
  return useQuery({
    queryKey: OFFER_KEYS.offer(offerId ?? ''),
    enabled: Boolean(offerId),
    queryFn: async (): Promise<OfferRow | null> => {
      const { data, error } = await tci().from('v_commercial_offers').select('*').eq('id', offerId!).maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as OfferRow | null
    },
  })
}

/** The versions without their content, newest first. */
export type OfferVersionMeta = Omit<OfferVersion, 'texts' | 'data'>
export function useOfferVersions(offerId: string | undefined) {
  return useQuery({
    queryKey: OFFER_KEYS.versions(offerId ?? ''),
    enabled: Boolean(offerId),
    queryFn: async (): Promise<OfferVersionMeta[]> => {
      const { data, error } = await tci()
        .from('commercial_offer_versions')
        .select('id, offer_id, version_no, valid_until, include_brochure, brochure_version_id, note, author_id, created_at')
        .eq('offer_id', offerId!)
        .order('version_no', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as OfferVersionMeta[]
    },
  })
}

async function fetchOfferVersion(offerId: string, versionNo: number): Promise<OfferVersion | null> {
  const { data, error } = await tci()
    .from('commercial_offer_versions')
    .select('*')
    .eq('offer_id', offerId)
    .eq('version_no', versionNo)
    .maybeSingle()
  if (error) throw error
  return (data ?? null) as unknown as OfferVersion | null
}

/** One version, content included. A version never changes. */
export function offerVersionQuery(offerId: string, versionNo: number) {
  return {
    queryKey: OFFER_KEYS.version(offerId, versionNo),
    queryFn: () => fetchOfferVersion(offerId, versionNo),
    staleTime: Infinity,
  }
}

export function useOfferVersion(offerId: string | undefined, versionNo: number | null) {
  return useQuery({
    ...offerVersionQuery(offerId ?? '', versionNo ?? 0),
    enabled: Boolean(offerId && versionNo),
  })
}

function settleOffer(qc: QueryClient, offer: Pick<OfferRow, 'id' | 'insurance_request_id' | 'entity_id'>) {
  void qc.invalidateQueries({ queryKey: OFFER_KEYS.forRequest(offer.insurance_request_id) })
  void qc.invalidateQueries({ queryKey: OFFER_KEYS.forEntity(offer.entity_id) })
  void qc.invalidateQueries({ queryKey: OFFER_KEYS.offer(offer.id) })
  void qc.invalidateQueries({ queryKey: OFFER_KEYS.versions(offer.id) })
}

export interface CreateOfferInput {
  requestId: string
  entityId: string
  language: OfferLang
  /** The document's parameters (kp/params.ts), stored as the version's texts. */
  texts: OfferParams
  validUntil: string
  includeBrochure: boolean
}

export function useCreateOffer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateOfferInput): Promise<{ id: string }> => {
      const { data, error } = await tci().rpc('create_commercial_offer', {
        p_request_id: input.requestId,
        p_language: input.language,
        p_texts: input.texts,
        p_valid_until: input.validUntil,
        p_include_brochure: input.includeBrochure,
      })
      if (error) throw error
      return data as { id: string }
    },
    onSuccess: (row, input) =>
      settleOffer(qc, { id: row.id, insurance_request_id: input.requestId, entity_id: input.entityId }),
  })
}

export interface SaveOfferInput {
  offer: Pick<OfferRow, 'id' | 'insurance_request_id' | 'entity_id'>
  baseVersionNo: number
  texts: OfferParams
  validUntil: string
  includeBrochure: boolean
  note: string | null
}

export function useSaveOfferVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: SaveOfferInput): Promise<OfferVersion> => {
      const { data, error } = await tci().rpc('save_offer_version', {
        p_offer_id: input.offer.id,
        p_base_version_no: input.baseVersionNo,
        p_texts: input.texts,
        p_valid_until: input.validUntil,
        p_include_brochure: input.includeBrochure,
        p_note: input.note,
      })
      if (error) throw error
      return data as OfferVersion
    },
    onSuccess: (version, input) => {
      qc.setQueryData(OFFER_KEYS.version(version.offer_id, version.version_no), version)
      settleOffer(qc, input.offer)
    },
  })
}

/** Publish and withdraw move the submission too (the server decides), so
 * they show a spinner in place rather than painting ahead. */
export function usePublishOffer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (offer: Pick<OfferRow, 'id' | 'insurance_request_id' | 'entity_id'>) => {
      const { error } = await tci().rpc('publish_offer', { p_offer_id: offer.id })
      if (error) throw error
    },
    onSettled: (_r, _e, offer) => {
      settleOffer(qc, offer)
      void qc.invalidateQueries({ queryKey: REQUEST_KEY(offer.insurance_request_id) })
      void qc.invalidateQueries({ queryKey: ['agenda', 'tasks'] })
    },
  })
}

export function useWithdrawOffer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { offer: Pick<OfferRow, 'id' | 'insurance_request_id' | 'entity_id'>; reason: string }) => {
      const { error } = await tci().rpc('withdraw_offer', { p_offer_id: input.offer.id, p_reason: input.reason })
      if (error) throw error
    },
    onSettled: (_r, _e, input) => {
      settleOffer(qc, input.offer)
      void qc.invalidateQueries({ queryKey: REQUEST_KEY(input.offer.insurance_request_id) })
      void qc.invalidateQueries({ queryKey: ['agenda', 'tasks'] })
    },
  })
}

// ---------------------------------------------------------------------------
// The portal
// ---------------------------------------------------------------------------

export function useClientOffers() {
  return useQuery({
    queryKey: OFFER_KEYS.client,
    queryFn: async (): Promise<ClientOffer[]> => {
      const { data, error } = await tci()
        .from('v_client_offers')
        .select('*')
        .order('published_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as ClientOffer[]
    },
  })
}

/** Opening the offer records the first view (once per publication). */
export function useClientViewOffer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (offerId: string) => {
      const { error } = await tci().rpc('client_view_offer', { p_offer_id: offerId })
      if (error) throw error
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: OFFER_KEYS.client }),
  })
}

type AnswerVars = { offerId: string; comment?: string }

/** Accept: the offer reads accepted at once; a refusal (expired, or the
 * submission moved) restores it and says why. */
export function useClientAcceptOffer(onRefusal?: (key: string) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['portal', 'offers', 'accept'],
    ...optimistic<AnswerVars, void>(qc, {
      patches: () => [
        rowInList<ClientOffer, AnswerVars>(OFFER_KEYS.client, (v) => v.offerId, (row) => ({
          ...row,
          status: 'accepted',
          effective_status: 'accepted',
        })),
      ],
      invalidate: () => [['portal', 'submissions'], ['portal', 'tasks']],
      onRefusal,
    }),
    mutationFn: async ({ offerId }: AnswerVars) => {
      const { error } = await tci().rpc('client_accept_offer', { p_offer_id: offerId })
      if (error) throw error
    },
  })
}

export function useClientRequestOfferChanges(onRefusal?: (key: string) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationKey: ['portal', 'offers', 'changes'],
    ...optimistic<AnswerVars, void>(qc, {
      patches: () => [
        rowInList<ClientOffer, AnswerVars>(OFFER_KEYS.client, (v) => v.offerId, (row, v) => ({
          ...row,
          status: 'changes_requested',
          effective_status: 'changes_requested',
          client_comment: v.comment ?? null,
        })),
      ],
      invalidate: () => [['portal', 'submissions'], ['portal', 'tasks']],
      onRefusal,
    }),
    mutationFn: async ({ offerId, comment }: AnswerVars) => {
      const { error } = await tci().rpc('client_request_offer_changes', {
        p_offer_id: offerId,
        p_comment: comment ?? '',
      })
      if (error) throw error
    },
  })
}
