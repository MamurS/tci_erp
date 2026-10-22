/** The offer dialogs: prepare a new offer (its language, validity and whether
 * the brochure is appended — the texts start from the defaults in that
 * language) and withdraw a live one (a reason is required). */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Callout, Field, Modal, Select, Textarea } from '../../components/ui'
import { DateInput } from '../../components/ui/DateInput'
import { useFixedT } from '../../i18n/useFixedT'
import { refusalKey } from '../../lib/refusals'
import { BROCHURE_LANGS } from '../brochure/model'
import { useCreateOffer, useWithdrawOffer } from './api'
import { addDays, DEFAULT_VALIDITY_DAYS, offerToday } from './machine'
import type { OfferLang, OfferRow } from './model'
import { defaultTexts } from './texts'

export function CreateOfferModal({
  requestId,
  entityId,
  onClose,
  onCreated,
}: {
  requestId: string
  entityId: string
  onClose: () => void
  onCreated: (offerId: string) => void
}) {
  const { t, i18n } = useTranslation()
  const ui = (i18n.resolvedLanguage ?? 'ru') as OfferLang
  const [language, setLanguage] = useState<OfferLang>((BROCHURE_LANGS as readonly string[]).includes(ui) ? ui : 'ru')
  const today = offerToday()
  const [validUntil, setValidUntil] = useState(addDays(today, DEFAULT_VALIDITY_DAYS))
  const [brochure, setBrochure] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const docT = useFixedT(language)
  const create = useCreateOffer()

  const submit = () => {
    if (!validUntil || validUntil < today) return setError(t('offers.errors.validUntilPast'))
    setError(null)
    create
      .mutateAsync({
        requestId,
        entityId,
        language,
        texts: defaultTexts((key) => docT.t(key)),
        validUntil,
        includeBrochure: brochure,
      })
      .then((row) => onCreated(row.id))
      .catch((e: unknown) => setError(t(refusalKey(e))))
  }

  return (
    <Modal
      open
      title={t('offers.create.title')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={!docT.ready}>
            {t('offers.create.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{t('offers.create.hint')}</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('offers.fields.language')} hint={t('offers.create.languageHint')}>
            <Select value={language} onChange={(e) => setLanguage(e.target.value as OfferLang)}>
              {BROCHURE_LANGS.map((l) => (
                <option key={l} value={l}>
                  {t(`offers.languages.${l}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('offers.fields.validUntil')}>
            <DateInput value={validUntil} onChange={setValidUntil} min={today} />
          </Field>
        </div>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-accent-600"
            checked={brochure}
            onChange={(e) => setBrochure(e.target.checked)}
          />
          <span>
            {t('offers.fields.includeBrochure')}
            <span className="block text-[12.5px] text-slate-500">{t('offers.create.brochureHint')}</span>
          </span>
        </label>
        {error && <Callout tone="neg" title={error} />}
      </div>
    </Modal>
  )
}

export function WithdrawOfferModal({ offer, onClose }: { offer: OfferRow; onClose: () => void }) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const withdraw = useWithdrawOffer()
  const out = offer.status === 'published' || offer.status === 'viewed'

  const submit = () => {
    if (!reason.trim()) return setError(t('offers.errors.withdrawReason'))
    setError(null)
    withdraw
      .mutateAsync({ offer, reason: reason.trim() })
      .then(onClose)
      .catch((e: unknown) => setError(t(refusalKey(e))))
  }

  return (
    <Modal
      open
      title={t('offers.withdraw.title', { number: offer.offer_number })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={submit} loading={withdraw.isPending}>
            {t('offers.withdraw.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{out ? t('offers.withdraw.hintPublished') : t('offers.withdraw.hintDraft')}</p>
        <Field label={t('offers.fields.reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} autoFocus />
        </Field>
        {error && <Callout tone="neg" title={error} />}
      </div>
    </Modal>
  )
}
