/** «Запросить лимит» — the one thing a client can start.
 *
 * The buyer picker searches the shared registry through
 * tci.client_search_entities, which needs three characters and caps its
 * result. When nothing matches, the client names the company instead and the
 * request becomes a proposal for an information manager: a client never
 * creates a company in the registry, and this form has no path that does. */

import { PencilLine } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  AmountInput,
  Button,
  Callout,
  Field,
  Input,
  Modal,
  SearchInput,
  Select,
  Spinner,
  Textarea,
} from '../../components/ui'
import { parseAmount } from '../../components/ui/amount'
import { DlNote } from '../limits/DlNote'
import { clientCoverRefusal } from '../risk/integration'
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
  const amountValue = parseAmount(amount) ?? Number.NaN
  const amountValid = Number.isFinite(amountValue) && amountValue > 0
  const canSubmit = Boolean(policyId) && buyerChosen && amountValid
  // Said under the form while «Send» is greyed, so a disabled button is never
  // a riddle (the «enter it by name» line above is a button, not a hint).
  const missing = [
    ...(buyerChosen ? [] : [t('limits.missing.buyerOrName')]),
    ...(amountValid ? [] : [t('limits.missing.amount')]),
  ]

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
      // genuinely unknown and says so. No cover (0085) is said in the
      // client's own words — never «sanctions», never a regime.
      const code = (err as { code?: string } | null)?.code
      const cover = clientCoverRefusal(err)
      setError(
        cover
          ? t(cover)
          : code === 'P0001'
          ? t('portal.limits.requestRefused')
          : code === '42501'
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
        <p className="text-body text-slate-700">
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
          <Button disabled={!canSubmit} loading={request.isPending} onClick={() => void submit()}>
            {t('portal.limits.send')}
          </Button>
        </>
      }
    >
      {error && <Callout tone="neg" title={error} />}

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
              <span className="text-body font-medium text-slate-900">
                {picked.name}
                {picked.registration_number && (
                  <span className="ml-2 num text-caption text-slate-500">
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
            <Callout tone="info" title={t('portal.limits.proposalNote')} />
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
            <SearchInput value={query} onChange={setQuery} placeholder={t('portal.limits.searchPlaceholder')} />
            {query.trim().length > 0 && query.trim().length < 3 && (
              <span className="text-caption text-slate-500">{t('portal.limits.searchMin')}</span>
            )}
            {isFetching && <Spinner />}
            {query.trim().length >= 3 && !isFetching && (
              <div className="mt-1 flex flex-col gap-1">
                {(hits ?? []).map((hit) => (
                  <button
                    key={hit.id}
                    type="button"
                    onClick={() => setPicked(hit)}
                    className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-body hover:bg-slate-50"
                  >
                    <span>{hit.name}</span>
                    <span className="num text-caption text-slate-500">
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
                  className="flex items-center gap-2 rounded-md border border-dashed border-accent-300 px-3 py-2 text-left text-small font-medium text-accent-700 hover:bg-accent-50"
                >
                  <PencilLine className="size-4 shrink-0" aria-hidden />
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
          <Field label={t('portal.limits.amount')}>
            <AmountInput
              value={amount}
              onChange={setAmount}
              suffix={policy?.currency_code}
              invalid={amount.trim() !== '' && !amountValid}
            />
            {amount.trim() !== '' && !amountValid && (
              <span className="text-small text-neg-500">{t('portal.limits.amountInvalid')}</span>
            )}
          </Field>
          <Field label={t('portal.limits.paymentTerms')}>
            <AmountInput
              decimals={0}
              value={paymentTerms}
              onChange={setPaymentTerms}
              suffix={t('policies.terms.daysSuffix')}
            />
            {policy?.max_payment_terms_days != null && (
              <span className="text-caption text-slate-500">
                {t('portal.limits.maxTerms', { days: policy.max_payment_terms_days })}
              </span>
            )}
          </Field>
        </div>

        {policy && (
          <DlNote
            amount={amountValid ? amountValue : null}
            dl={policy.discretionary_limit == null ? null : Number(policy.discretionary_limit)}
            currency={policy.currency_code}
            audience="client"
          />
        )}

        <Field label={t('portal.limits.justification')}>
          <Textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
          />
        </Field>

        {missing.length > 0 && (
          <p className="text-small text-slate-500" data-testid="request-missing">
            {missing.join(' · ')}
          </p>
        )}
      </div>
    </Modal>
  )
}
