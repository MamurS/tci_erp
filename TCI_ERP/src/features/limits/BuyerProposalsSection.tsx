/** Buyer proposals from the portal (migration 0025).
 *
 * A client asked for a limit on a company we do not have in the registry.
 * Resolving one either points at a company that turns out to exist already,
 * or creates it — and either way raises the real limit request, so from that
 * point the request is indistinguishable from one a colleague typed. The
 * client never writes tci.legal_entities; this is the queue that feeds it. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../../auth/AuthContext'
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Modal,
  Spinner,
  Table,
} from '../../components/ui'
import { EM_DASH, formatAmount, formatMoment } from '../../lib/format'
import { hasRole } from '../../lib/roles'
import { tci } from '../../lib/supabase'

interface BuyerProposal {
  id: string
  policy_id: string
  proposed_name: string
  proposed_registration_number: string | null
  proposed_country_code: string | null
  requested_amount: number
  currency_code: string
  requested_payment_terms_days: number | null
  justification: string | null
  status: string
  created_at: string
  policies: { policy_number: string; legal_entities: { name: string } | null } | null
}

const KEY = ['buyer-proposals'] as const

function useBuyerProposals() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<BuyerProposal[]> => {
      const { data, error } = await tci()
        .from('client_buyer_proposals')
        .select('*, policies(policy_number, legal_entities(name))')
        .eq('status', 'pending_entity')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as unknown as BuyerProposal[]
    },
  })
}

export function BuyerProposalsSection() {
  const { t, i18n } = useTranslation()
  const { roles } = useAuth()
  const { data: proposals, isLoading } = useBuyerProposals()
  const [resolving, setResolving] = useState<BuyerProposal | null>(null)

  const canResolve = hasRole(
    roles,
    'admin',
    'information_manager',
    'sales',
    'credit_underwriter',
  )

  if (isLoading) return <Spinner label={t('common.loading')} />

  if (!proposals?.length) {
    return (
      <EmptyState
        title={t('limits.proposals.empty')}
        hint={t('limits.proposals.emptyHint')}
      />
    )
  }

  return (
    <>
      <Table>
        <thead>
          <tr>
            <th>{t('limits.proposals.proposedName')}</th>
            <th>{t('limits.proposals.registrationNumber')}</th>
            <th>{t('limits.proposals.policy')}</th>
            <th className="text-right">{t('limits.fields.requestedAmount')}</th>
            <th>{t('limits.proposals.asked')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {proposals.map((proposal) => (
            <tr key={proposal.id}>
              <td className="font-medium text-slate-900">
                {proposal.proposed_name}
                <Badge tone="warn">{t('limits.proposals.fromClient')}</Badge>
              </td>
              <td className="num text-slate-500">
                {proposal.proposed_registration_number ?? EM_DASH}
              </td>
              <td className="num text-slate-500">
                {proposal.policies?.policy_number ?? EM_DASH}
              </td>
              <td className="num text-right">
                {formatAmount(proposal.requested_amount, i18n.language)}{' '}
                {proposal.currency_code}
              </td>
              <td className="text-slate-500">
                {formatMoment(proposal.created_at, i18n.language)}
              </td>
              <td className="text-right">
                <Button
                  size="sm"
                  disabled={!canResolve}
                  onClick={() => setResolving(proposal)}
                >
                  {t('limits.proposals.resolve')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      {resolving && (
        <ResolveModal proposal={resolving} onClose={() => setResolving(null)} />
      )}
    </>
  )
}

function ResolveModal({
  proposal,
  onClose,
}: {
  proposal: BuyerProposal
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()

  const [query, setQuery] = useState(proposal.proposed_name)
  const [name, setName] = useState(proposal.proposed_name)
  const [registrationNumber, setRegistrationNumber] = useState(
    proposal.proposed_registration_number ?? '',
  )
  const [error, setError] = useState<string | null>(null)

  // Same dedup-on-entry search the registry uses, so an information manager
  // sees an existing company before creating a duplicate of it.
  const { data: matches } = useQuery({
    queryKey: ['entity-match', query],
    enabled: query.trim().length >= 3,
    queryFn: async (): Promise<{ id: string; name: string; registration_number: string | null }[]> => {
      const { data, error: searchError } = await tci()
        .from('legal_entities')
        .select('id, name, registration_number')
        .ilike('name', `%${query.trim()}%`)
        .limit(8)
      if (searchError) throw searchError
      return (data ?? []) as { id: string; name: string; registration_number: string | null }[]
    },
  })

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: KEY })
    void queryClient.invalidateQueries({ queryKey: ['limit-requests'] })
    void queryClient.invalidateQueries({ queryKey: ['agenda'] })
    onClose()
  }

  const resolve = useMutation({
    mutationFn: async (entityId: string | null) => {
      const { error: rpcError } = await tci().rpc('resolve_buyer_proposal', {
        p_proposal_id: proposal.id,
        p_entity_id: entityId,
        p_new_name: entityId ? null : name.trim(),
        p_new_country: null,
        p_new_registration_number: entityId ? null : registrationNumber.trim() || null,
        p_new_legal_form: null,
      })
      if (rpcError) throw rpcError
    },
    onSuccess: done,
    onError: (err) => {
      const code = (err as { code?: string } | null)?.code
      setError(
        code === 'P0001'
          ? t('limits.proposals.refused')
          : code === '42501'
            ? t('limits.proposals.notAllowed')
            : t('limits.proposals.failed'),
      )
    },
  })

  const reject = useMutation({
    mutationFn: async () => {
      const { error: rpcError } = await tci().rpc('reject_buyer_proposal', {
        p_proposal_id: proposal.id,
        p_reason: t('limits.proposals.rejectedDefault'),
      })
      if (rpcError) throw rpcError
    },
    onSuccess: done,
    onError: () => setError(t('limits.proposals.failed')),
  })

  const busy = resolve.isPending || reject.isPending

  return (
    <Modal
      open
      wide
      title={t('limits.proposals.resolveTitle')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => reject.mutate()}>
            {t('limits.proposals.reject')}
          </Button>
          <Button disabled={busy || !name.trim()} onClick={() => resolve.mutate(null)}>
            {t('limits.proposals.createAndRaise')}
          </Button>
        </>
      }
    >
      {error && (
        <div
          className="mb-4 rounded-md border border-neg-500/30 bg-neg-50 px-4 py-2.5 text-[13px] text-neg-500"
          role="alert"
        >
          {error}
        </div>
      )}

      <p className="mb-4 text-sm text-slate-600">
        {t('limits.proposals.intro', {
          policyholder: proposal.policies?.legal_entities?.name ?? EM_DASH,
          policy: proposal.policies?.policy_number ?? EM_DASH,
        })}
      </p>

      {proposal.justification && (
        <p className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
          {proposal.justification}
        </p>
      )}

      <Field label={t('limits.proposals.searchExisting')}>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} />
      </Field>

      {(matches ?? []).length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          <p className="text-xs text-slate-400">{t('limits.proposals.maybeExisting')}</p>
          {(matches ?? []).map((match) => (
            <button
              key={match.id}
              type="button"
              disabled={busy}
              onClick={() => resolve.mutate(match.id)}
              className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-1.5 text-left text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              <span>{match.name}</span>
              <span className="num text-xs text-slate-400">
                {match.registration_number ?? ''}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 border-t border-slate-100 pt-4">
        <p className="mb-3 text-xs text-slate-400">{t('limits.proposals.orCreate')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('limits.proposals.companyName')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('limits.proposals.registrationNumber')}>
            <Input
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
            />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
