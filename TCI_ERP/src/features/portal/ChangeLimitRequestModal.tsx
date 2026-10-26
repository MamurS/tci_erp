/** «Изменить запрос» (0075). Before underwriting has the request it changes
 * in place and goes to them with the new figures; after, the change is a
 * replacement — the old request withdrawn and a new one sent in its place,
 * in one transaction on the server. The buyer and the policy never change:
 * a different buyer is a different request. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AmountInput, Button, Callout, Field, Modal, Textarea } from '../../components/ui'
import { parseAmount } from '../../components/ui/amount'
import { refusalOr } from '../../lib/optimistic'
import { DlNote } from '../limits/DlNote'
import { useChangeLimitRequest } from './api'
import { isUnchanged } from './requestChanges'
import type { ClientLimitRequest, ClientPolicy } from './types'

export function ChangeLimitRequestModal({
  request,
  mode,
  policy,
  onClose,
  onDone,
}: {
  request: ClientLimitRequest
  mode: 'amend' | 'replace'
  policy: ClientPolicy | undefined
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { t } = useTranslation()
  const change = useChangeLimitRequest()
  const [amount, setAmount] = useState(String(Number(request.requested_amount)))
  const [terms, setTerms] = useState(
    request.requested_payment_terms_days === null ? '' : String(request.requested_payment_terms_days),
  )
  const [justification, setJustification] = useState(request.justification ?? '')
  const [error, setError] = useState<string | null>(null)

  const amountValue = parseAmount(amount) ?? Number.NaN
  const amountValid = Number.isFinite(amountValue) && amountValue > 0
  const termsValue = terms.trim() === '' ? null : Number(terms)
  const next = { amount: amountValue, paymentTermsDays: termsValue, justification: justification.trim() || null }
  const unchanged = amountValid && isUnchanged(request, next)
  const buyer = request.buyer_name ?? request.proposed_name ?? ''

  const save = async () => {
    setError(null)
    try {
      await change.mutateAsync({ id: request.id, mode, ...next })
      onDone(t(mode === 'amend' ? 'portal.limits.change.doneAmended' : 'portal.limits.change.doneReplaced'))
    } catch (failure) {
      setError(t(refusalOr(failure, 'portal.limits.change.failed')))
    }
  }

  return (
    <Modal
      open
      wide
      title={t('portal.limits.change.title', { buyer })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!amountValid || unchanged} loading={change.isPending} onClick={() => void save()}>
            {t(mode === 'amend' ? 'portal.limits.change.saveAmend' : 'portal.limits.change.saveReplace')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Callout tone="neg" title={error} />}
        <Callout tone={mode === 'amend' ? 'info' : 'warn'} title={t(`portal.limits.change.${mode}Title`)}>
          {t(`portal.limits.change.${mode}Hint`)}
        </Callout>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('portal.limits.amount')}>
            <AmountInput
              value={amount}
              onChange={setAmount}
              suffix={request.currency_code}
              invalid={amount.trim() !== '' && !amountValid}
              autoFocus
            />
            {amount.trim() !== '' && !amountValid && (
              <span className="text-[0.8125rem] text-neg-500">{t('portal.limits.amountInvalid')}</span>
            )}
          </Field>
          <Field label={t('portal.limits.paymentTerms')}>
            <AmountInput decimals={0} value={terms} onChange={setTerms} suffix={t('policies.terms.daysSuffix')} />
            {policy?.max_payment_terms_days != null && (
              <span className="text-xs text-slate-400">
                {t('portal.limits.maxTerms', { days: policy.max_payment_terms_days })}
              </span>
            )}
          </Field>
        </div>

        {policy && (
          <DlNote
            amount={amountValid ? amountValue : null}
            dl={policy.discretionary_limit == null ? null : Number(policy.discretionary_limit)}
            currency={request.currency_code}
            audience="client"
          />
        )}

        <Field label={t('portal.limits.justification')}>
          <Textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={3} />
        </Field>

        {unchanged && <p className="text-[0.8125rem] text-slate-500">{t('portal.limits.change.unchangedHint')}</p>}
      </div>
    </Modal>
  )
}
