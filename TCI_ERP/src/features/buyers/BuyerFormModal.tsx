import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Field, Input, Modal, Select } from '../../components/ui'
import { refName, useCountries, useIndustries } from './api'
import type { BuyerInput } from './api'
import type { Buyer } from './types'

interface BuyerFormModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (input: BuyerInput) => Promise<void>
  initial?: Buyer | null
}

export function BuyerFormModal({ open, onClose, onSubmit, initial }: BuyerFormModalProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: countries } = useCountries()
  const { data: industries } = useIndustries()

  const [name, setName] = useState('')
  const [countryCode, setCountryCode] = useState('UZ')
  const [industryId, setIndustryId] = useState('')
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [website, setWebsite] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setCountryCode(initial?.country_code ?? 'UZ')
      setIndustryId(initial?.industry_id ?? '')
      setRegistrationNumber(initial?.registration_number ?? '')
      setWebsite(initial?.website ?? '')
      setNotes(initial?.notes ?? '')
      setError(null)
    }
  }, [open, initial])

  const handleSubmit = async () => {
    if (!name.trim() || !registrationNumber.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onSubmit({
        name: name.trim(),
        country_code: countryCode,
        industry_id: industryId || null,
        registration_number: registrationNumber.trim(),
        website: website.trim() || null,
        notes: notes.trim() || null,
      })
      onClose()
    } catch {
      setError(t('common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? t('buyers.editBuyer') : t('buyers.addBuyer')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving || !name.trim() || !registrationNumber.trim()}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('buyers.fields.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('buyers.fields.country')}>
            <Select value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
              {(countries ?? []).map((c) => (
                <option key={c.code} value={c.code}>
                  {refName(c, locale)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('buyers.fields.industry')}>
            <Select value={industryId} onChange={(e) => setIndustryId(e.target.value)}>
              <option value="">{t('common.notSelected')}</option>
              {(industries ?? []).map((ind) => (
                <option key={ind.code} value={ind.code}>
                  {refName(ind, locale)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('buyers.fields.registrationNumber')}>
          <Input
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
            required
          />
        </Field>
        <Field label={t('buyers.fields.website')}>
          <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
        </Field>
        <Field label={t('buyers.fields.notes')}>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
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
