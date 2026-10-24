/** "Request limit" modal on the policy page: buyer picker with search,
 * amount (policy currency), terms, justification → creates a draft. */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { AmountInput, Button, Field, Modal, Textarea } from '../../components/ui'
import { parseAmount } from '../../components/ui/amount'
import { EntityPicker } from '../entities/EntityPicker'
import { DlNote } from './DlNote'
import type { PolicyWithRefs } from '../policies/types'
import { useCreateLimitRequest } from './api'

export function RequestLimitModal({
  open,
  onClose,
  policy,
  excludedBuyerIds,
}: {
  open: boolean
  onClose: () => void
  policy: PolicyWithRefs
  /** Buyers that already have an OPEN request on this policy. */
  excludedBuyerIds: readonly string[]
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const createRequest = useCreateLimitRequest()

  const [entityId, setBuyerId] = useState<string | null>(null)
  const [amount, setAmount] = useState('')
  const [terms, setTerms] = useState('')
  const [justification, setJustification] = useState('')
  const [error, setError] = useState<string | null>(null)

  const parsedAmount = parseAmount(amount) ?? Number.NaN
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0
  const valid = entityId && amountValid
  const missing = [
    ...(entityId ? [] : [t('limits.missing.buyer')]),
    ...(amountValid ? [] : [t('limits.missing.amount')]),
  ]

  const handleCreate = async () => {
    if (!valid || !entityId) return
    setError(null)
    try {
      const created = await createRequest.mutateAsync({
        policy_id: policy.id,
        entity_id: entityId,
        requested_amount: parsedAmount,
        currency_code: policy.currency_code, // request currency defaults to policy currency
        requested_payment_terms_days: terms ? Number(terms) : null,
        justification: justification.trim() || null,
      })
      onClose()
      void navigate(`/limits/${created.id}`)
    } catch {
      setError(t('limits.createFailed'))
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('limits.requestLimit')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleCreate()} disabled={!valid} loading={createRequest.isPending}>
            {t('limits.createDraft')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('limits.fields.buyer')}>
          <EntityPicker value={entityId} onChange={setBuyerId} exclude={excludedBuyerIds} allowRequest autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('limits.fields.requestedAmount')}>
            <AmountInput value={amount} onChange={setAmount} suffix={policy.currency_code} />
          </Field>
          <Field label={t('limits.fields.paymentTerms')}>
            <AmountInput
              decimals={0}
              value={terms}
              onChange={setTerms}
              suffix={t('policies.terms.daysSuffix')}
            />
          </Field>
        </div>
        <DlNote
          amount={amountValid ? parsedAmount : null}
          dl={Number(policy.discretionary_limit)}
          currency={policy.currency_code}
          audience="staff"
        />
        <Field label={t('limits.fields.justification')}>
          <Textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
          />
        </Field>
        {missing.length > 0 && <p className="text-[13px] text-slate-500">{missing.join(' · ')}</p>}
        {error && (
          <p className="text-[13px] text-neg-500" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
