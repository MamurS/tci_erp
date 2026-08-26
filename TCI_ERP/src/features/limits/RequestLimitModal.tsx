/** "Request limit" modal on the policy page: buyer picker with search,
 * amount (policy currency), terms, justification → creates a draft. */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button, Field, Input, Modal, Select } from '../../components/ui'
import { useEntities } from '../entities/api'
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
  const { data: buyers } = useEntities()
  const createRequest = useCreateLimitRequest()

  const [buyerSearch, setBuyerSearch] = useState('')
  const [entityId, setBuyerId] = useState('')
  const [amount, setAmount] = useState('')
  const [terms, setTerms] = useState('')
  const [justification, setJustification] = useState('')
  const [error, setError] = useState<string | null>(null)

  const candidates = useMemo(() => {
    const query = buyerSearch.trim().toLowerCase()
    return (buyers ?? []).filter(
      (b) =>
        !excludedBuyerIds.includes(b.id) &&
        (!query || b.name.toLowerCase().includes(query)),
    )
  }, [buyers, buyerSearch, excludedBuyerIds])

  const parsedAmount = Number(amount.replace(/\s/g, '').replace(',', '.'))
  const valid = entityId && Number.isFinite(parsedAmount) && parsedAmount > 0

  const handleCreate = async () => {
    if (!valid) return
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
          <Button onClick={() => void handleCreate()} disabled={!valid || createRequest.isPending}>
            {createRequest.isPending ? t('common.saving') : t('limits.createDraft')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('limits.fields.buyer')}>
          <Input
            value={buyerSearch}
            onChange={(e) => setBuyerSearch(e.target.value)}
            placeholder={t('buyers.searchPlaceholder')}
          />
          <Select
            value={entityId}
            onChange={(e) => setBuyerId(e.target.value)}
            className="mt-1.5"
            size={Math.min(6, Math.max(3, candidates.length))}
          >
            {candidates.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} · {b.registration_number}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t('limits.fields.requestedAmount')} (${policy.currency_code})`}>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="num"
            />
          </Field>
          <Field label={t('limits.fields.paymentTerms')}>
            <Input
              inputMode="numeric"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder={t('policies.terms.daysSuffix')}
            />
          </Field>
        </div>
        <Field label={t('limits.fields.justification')}>
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:outline-2 focus:outline-accent-600"
          />
        </Field>
        {error && (
          <p className="text-[13px] text-neg-500" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
