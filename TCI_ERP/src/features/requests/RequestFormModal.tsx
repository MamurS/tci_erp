/** "New submission" modal: applicant (an existing company) plus the initial
 * buyer package. A package buyer may be entered as a bare NAME — sales
 * resolve it to a company later, which is exactly what the
 * entity_resolution stage exists for. */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Plus, X } from 'lucide-react'

import { AmountInput, Button, Field, Modal, Textarea } from '../../components/ui'
import { parseAmount } from '../../components/ui/amount'
import { EntityPicker } from '../entities/EntityPicker'
import { useCreateInsuranceRequest } from './api'
import type { RequestBuyerInput } from './types'

interface DraftBuyer extends Omit<RequestBuyerInput, 'requested_amount'> {
  /** Local key: package rows have no id until they are saved. */
  key: string
  /** The plain amount as typed ("" while empty); parsed on save. */
  requested_amount: string
}

let nextKey = 0

export function RequestFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const createRequest = useCreateInsuranceRequest()

  const [entityId, setEntityId] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [buyers, setBuyers] = useState<DraftBuyer[]>([])
  const [error, setError] = useState<string | null>(null)

  const buyersValid = buyers.every(
    (b) =>
      (b.entity_id || (b.proposed_name ?? '').trim()) && (parseAmount(b.requested_amount) ?? 0) > 0,
  )
  const valid = Boolean(entityId) && buyers.length > 0 && buyersValid

  const reset = () => {
    setEntityId(null)
    setNotes('')
    setBuyers([])
    setError(null)
  }

  const handleCreate = async () => {
    if (!valid || !entityId) return
    setError(null)
    try {
      const created = await createRequest.mutateAsync({
        entity_id: entityId,
        notes: notes.trim() || null,
        buyers: buyers.map((b) => ({
          entity_id: b.entity_id,
          proposed_name: b.entity_id ? null : (b.proposed_name ?? '').trim() || null,
          requested_amount: parseAmount(b.requested_amount) ?? 0,
          requested_payment_terms_days: b.requested_payment_terms_days,
        })),
      })
      reset()
      onClose()
      void navigate(`/requests/${created.id}`)
    } catch {
      setError(t('requests.createFailed'))
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={t('requests.actions.create')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleCreate()} disabled={!valid || createRequest.isPending}>
            {createRequest.isPending ? t('common.saving') : t('requests.actions.createDraft')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('requests.fields.applicant')}>
          <EntityPicker value={entityId} onChange={setEntityId} allowRequest autoFocus />
        </Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12px] font-semibold tracking-wide text-slate-600 uppercase">
              {t('requests.buyerPackage')}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setBuyers((prev) => [
                  ...prev,
                  {
                    key: `b${nextKey++}`,
                    entity_id: null,
                    proposed_name: '',
                    requested_amount: '',
                    requested_payment_terms_days: null,
                  },
                ])
              }
            >
              <Plus />
              {t('requests.addBuyer')}
            </Button>
          </div>
          {buyers.length === 0 ? (
            <p className="text-xs text-slate-400">{t('requests.noBuyersYet')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {buyers.map((b, index) => (
                <div key={b.key} className="grid grid-cols-[minmax(0,1fr)_140px_auto] items-center gap-2">
                  {/* A company from the registry, or — when it is not there
                      yet — its name, which sales resolve at entity_resolution. */}
                  <EntityPicker
                    value={b.entity_id}
                    onChange={(id) =>
                      setBuyers((prev) =>
                        prev.map((row, i) =>
                          i === index ? { ...row, entity_id: id, proposed_name: id ? null : row.proposed_name } : row,
                        ),
                      )
                    }
                    text={b.proposed_name ?? ''}
                    onTextChange={(name) =>
                      setBuyers((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, proposed_name: name } : row)),
                      )
                    }
                    exclude={entityId ? [entityId] : undefined}
                    placeholder={t('picker.buyerPlaceholder')}
                    aria-label={t('requests.buyerPackage')}
                  />
                  <AmountInput
                    value={b.requested_amount}
                    onChange={(plain) =>
                      setBuyers((prev) =>
                        prev.map((row, i) => (i === index ? { ...row, requested_amount: plain } : row)),
                      )
                    }
                    placeholder={t('requests.fields.requestedAmount')}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setBuyers((prev) => prev.filter((_, i) => i !== index))}
                    aria-label={t('common.delete')}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Field label={t('requests.fields.notes')}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
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
