/** «Запросить лимит» — the one thing a client can start.
 *
 * The buyer picker searches the shared registry through
 * tci.client_search_entities, which needs three characters and caps its
 * result. When nothing matches, the client names the company instead and the
 * request becomes a proposal for an information manager: a client never
 * creates a company in the registry, and this form has no path that does. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Field, Input, Modal, Select, Spinner } from '../../components/ui'
import { useEntitySearch, useRequestLimit } from './api'
import type { ClientPolicy, EntitySearchHit } from './types'

interface Props {
  policies: ClientPolicy[]
  open: boolean
  onClose: () => void
}

export function RequestLimitModal({ policies, open, onClose }: Props) {
  const { t } = useTranslation()
  const request = useRequestLimit()

  const [policyId, setPolicyId] = useState(policies[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<EntitySearchHit | null>(null)
  const [proposing, setProposing] = useState(false)
  const [proposedName, setProposedName] = useState('')
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [justification, setJustification] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<'request' | 'proposal' | null>(null)

  const { data: hits, isFetching } = useEntitySearch(picked || proposing ? '' : query)
  const policy = policies.find((p) => p.id === policyId)

  const buyerChosen = Boolean(picked) || (proposing && proposedName.trim().length > 0)
  const amountValue = Number(amount.replace(/\s/g, '').replace(',', '.'))
  const amountValid = Number.isFinite(amountValue) && amountValue > 0
  const canSubmit = Boolean(policyId) && buyerChosen && amountValid && !request.isPending

  const reset = () => {
    setQuery('')
    setPicked(null)
    setProposing(false)
    setProposedName('')
    setRegistrationNumber('')
    setAmount('')
    setPaymentTerms('')
    setJustification('')
    setError(null)
    setDone(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const submit = async () => {
    setError(null)
    try {
      const result = await request.mutateAsync({
        policyId,
        entityId: picked?.id ?? null,
        proposedName: picked ? null : proposedName.trim(),
        registrationNumber: picked ? null : registrationNumber.trim() || null,
        countryCode: null,
        amount: amountValue,
        currency: policy?.currency_code ?? 'UZS',
        paymentTermsDays: paymentTerms ? Number(paymentTerms) : null,
        justification: justification.trim() || null,
      })
      setDone(result.kind)
    } catch (err) {
      // The function's refusals are deterministic and named; anything else is
      // genuinely unknown and says so.
      const code = (err as { code?: string } | null)?.code
      setError(
        code === 'P0001'
          ? t('portal.limits.requestRefused')
          : code === 'P0004'
            ? t('portal.limits.requestNotAllowed')
            : t('portal.limits.requestFailed'),
      )
    }
  }

  if (done) {
    return (
      <Modal
        open={open}
        title={t('portal.limits.requestTitle')}
        onClose={close}
        footer={<Button onClick={close}>{t('common.close')}</Button>}
      >
        <p className="text-sm text-slate-700">
          {t(done === 'proposal'
            ? 'portal.limits.sentProposal'
            : 'portal.limits.sentRequest')}
        </p>
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      wide
      title={t('portal.limits.requestTitle')}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {t('portal.limits.send')}
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

      <div className="flex flex-col gap-4">
        <Field label={t('portal.limits.policy')}>
          <Select value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.policy_number} ({p.currency_code})
              </option>
            ))}
          </Select>
        </Field>

        {/* --- the buyer ------------------------------------------------- */}
        {picked ? (
          <Field label={t('portal.limits.buyer')}>
            <div className="flex items-center justify-between rounded-md border border-slate-300 bg-slate-50 px-3 py-2">
              <span className="text-sm font-medium text-slate-900">
                {picked.name}
                {picked.registration_number && (
                  <span className="ml-2 num text-xs text-slate-400">
                    {picked.registration_number}
                  </span>
                )}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setPicked(null)}>
                {t('portal.limits.changeBuyer')}
              </Button>
            </div>
          </Field>
        ) : proposing ? (
          <>
            <div className="rounded-md border border-warn-500/30 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500">
              {t('portal.limits.proposalNote')}
            </div>
            <Field label={t('portal.limits.buyerName')}>
              <Input
                value={proposedName}
                onChange={(e) => setProposedName(e.target.value)}
                placeholder={t('portal.limits.buyerNamePlaceholder')}
              />
            </Field>
            <Field label={t('portal.limits.registrationNumber')}>
              <Input
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
              />
            </Field>
            <Button variant="ghost" size="sm" onClick={() => setProposing(false)}>
              {t('portal.limits.backToSearch')}
            </Button>
          </>
        ) : (
          <Field label={t('portal.limits.buyer')}>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('portal.limits.searchPlaceholder')}
            />
            {query.trim().length > 0 && query.trim().length < 3 && (
              <span className="text-xs text-slate-400">{t('portal.limits.searchMin')}</span>
            )}
            {isFetching && <Spinner />}
            {query.trim().length >= 3 && !isFetching && (
              <div className="mt-1 flex flex-col gap-1">
                {(hits ?? []).map((hit) => (
                  <button
                    key={hit.id}
                    type="button"
                    onClick={() => setPicked(hit)}
                    className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-1.5 text-left text-sm hover:bg-slate-50"
                  >
                    <span>{hit.name}</span>
                    <span className="num text-xs text-slate-400">
                      {hit.registration_number ?? ''} {hit.country_code ?? ''}
                    </span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setProposing(true)
                    setProposedName(query.trim())
                  }}
                  className="rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-left text-[13px] text-slate-600 hover:bg-slate-50"
                >
                  {(hits ?? []).length
                    ? t('portal.limits.notListed')
                    : t('portal.limits.noneFound', { query: query.trim() })}
                </button>
              </div>
            )}
          </Field>
        )}

        {/* --- what they want -------------------------------------------- */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('portal.limits.amountIn', { currency: policy?.currency_code ?? '' })}>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {amount.trim() !== '' && !amountValid && (
              <span className="text-[13px] text-neg-500">{t('portal.limits.amountInvalid')}</span>
            )}
          </Field>
          <Field label={t('portal.limits.paymentTermsDays')}>
            <Input
              inputMode="numeric"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
            />
            {policy?.max_payment_terms_days != null && (
              <span className="text-xs text-slate-400">
                {t('portal.limits.maxTerms', { days: policy.max_payment_terms_days })}
              </span>
            )}
          </Field>
        </div>

        <Field label={t('portal.limits.justification')}>
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:outline-2 focus:outline-accent-600"
          />
        </Field>

        {policy?.discretionary_limit != null && (
          <p className="text-xs text-slate-400">
            <Badge tone="neutral">{t('requests.terms.discretionary_limit')}</Badge>{' '}
            {t('portal.limits.dlHint')}
          </p>
        )}
      </div>
    </Modal>
  )
}
