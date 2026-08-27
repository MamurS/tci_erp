/** "New submission" modal: applicant (an existing company) plus the initial
 * buyer package. A package buyer may be entered as a bare NAME — sales
 * resolve it to a company later, which is exactly what the
 * entity_resolution stage exists for. */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button, Field, Input, Modal, Select } from '../../components/ui'
import { EM_DASH } from '../../lib/format'
import { useEntities } from '../entities/api'
import { useCreateInsuranceRequest } from './api'
import type { RequestBuyerInput } from './types'

interface DraftBuyer extends RequestBuyerInput {
  /** Local key: package rows have no id until they are saved. */
  key: string
}

let nextKey = 0

export function RequestFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: entities } = useEntities()
  const createRequest = useCreateInsuranceRequest()

  const [applicantSearch, setApplicantSearch] = useState('')
  const [entityId, setEntityId] = useState('')
  const [notes, setNotes] = useState('')
  const [buyers, setBuyers] = useState<DraftBuyer[]>([])
  const [error, setError] = useState<string | null>(null)

  const candidates = useMemo(() => {
    const query = applicantSearch.trim().toLowerCase()
    return (entities ?? []).filter((e) => !query || e.name.toLowerCase().includes(query))
  }, [entities, applicantSearch])

  const buyersValid = buyers.every(
    (b) => (b.entity_id || (b.proposed_name ?? '').trim()) && b.requested_amount > 0,
  )
  const valid = Boolean(entityId) && buyers.length > 0 && buyersValid

  const reset = () => {
    setApplicantSearch('')
    setEntityId('')
    setNotes('')
    setBuyers([])
    setError(null)
  }

  const handleCreate = async () => {
    if (!valid) return
    setError(null)
    try {
      const created = await createRequest.mutateAsync({
        entity_id: entityId,
        notes: notes.trim() || null,
        buyers: buyers.map((b) => ({
          entity_id: b.entity_id,
          proposed_name: b.entity_id ? null : (b.proposed_name ?? '').trim() || null,
          requested_amount: b.requested_amount,
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
          <Input
            value={applicantSearch}
            onChange={(e) => setApplicantSearch(e.target.value)}
            placeholder={t('entities.searchPlaceholder')}
          />
          <Select
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            className="mt-1.5"
            size={Math.min(6, Math.max(3, candidates.length))}
          >
            {candidates.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.registration_number ?? EM_DASH}
              </option>
            ))}
          </Select>
        </Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-medium text-slate-600">
              {t('requests.buyerPackage')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setBuyers((prev) => [
                  ...prev,
                  {
                    key: `b${nextKey++}`,
                    entity_id: null,
                    proposed_name: '',
                    requested_amount: 0,
                    requested_payment_terms_days: null,
                  },
                ])
              }
            >
              + {t('requests.addBuyer')}
            </Button>
          </div>
          {buyers.length === 0 ? (
            <p className="text-xs text-slate-400">{t('requests.noBuyersYet')}</p>
          ) : (
            <div className="flex flex-col gap-2">
              {buyers.map((b, index) => (
                <div key={b.key} className="grid grid-cols-[1fr_1fr_120px_auto] items-center gap-2">
                  <Select
                    value={b.entity_id ?? ''}
                    onChange={(e) =>
                      setBuyers((prev) =>
                        prev.map((row, i) =>
                          i === index ? { ...row, entity_id: e.target.value || null } : row,
                        ),
                      )
                    }
                  >
                    <option value="">{t('requests.buyerByName')}</option>
                    {(entities ?? []).map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </Select>
                  {/* Always rendered so the row keeps its columns; a chosen
                      company supplies the name itself. */}
                  <Input
                    value={b.entity_id ? '' : (b.proposed_name ?? '')}
                    disabled={Boolean(b.entity_id)}
                    onChange={(e) =>
                      setBuyers((prev) =>
                        prev.map((row, i) =>
                          i === index ? { ...row, proposed_name: e.target.value } : row,
                        ),
                      )
                    }
                    placeholder={t('requests.buyerNamePlaceholder')}
                  />
                  <Input
                    inputMode="decimal"
                    className="num"
                    value={b.requested_amount || ''}
                    onChange={(e) =>
                      setBuyers((prev) =>
                        prev.map((row, i) =>
                          i === index
                            ? { ...row, requested_amount: Number(e.target.value) || 0 }
                            : row,
                        ),
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
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <Field label={t('requests.fields.notes')}>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
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
