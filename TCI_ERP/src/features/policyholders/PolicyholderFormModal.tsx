/** Add/edit policyholder modal — mirrors the buyers registry UX. */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Field, Input, Modal, Select } from '../../components/ui'
import { refName, useCountries, useIndustries } from '../buyers/api'
import type { PolicyholderInput } from './api'
import type { Policyholder } from './types'

interface PolicyholderFormModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (input: PolicyholderInput) => Promise<void>
  initial?: Policyholder | null
}

export function PolicyholderFormModal({
  open,
  onClose,
  onSubmit,
  initial,
}: PolicyholderFormModalProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: countries } = useCountries()
  const { data: industries } = useIndustries()

  const [name, setName] = useState('')
  const [legalForm, setLegalForm] = useState('')
  const [countryCode, setCountryCode] = useState('UZ')
  const [industryId, setIndustryId] = useState('')
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [address, setAddress] = useState('')
  const [website, setWebsite] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setLegalForm(initial?.legal_form ?? '')
      setCountryCode(initial?.country_code ?? 'UZ')
      setIndustryId(initial?.industry_id ?? '')
      setRegistrationNumber(initial?.registration_number ?? '')
      setAddress(initial?.address ?? '')
      setWebsite(initial?.website ?? '')
      setContactPerson(initial?.contact_person ?? '')
      setContactEmail(initial?.contact_email ?? '')
      setContactPhone(initial?.contact_phone ?? '')
      setNotes(initial?.notes ?? '')
      setError(null)
    }
  }, [open, initial])

  const valid = name.trim() && registrationNumber.trim()

  const handleSubmit = async () => {
    if (!valid) return
    setSaving(true)
    setError(null)
    try {
      await onSubmit({
        name: name.trim(),
        legal_form: legalForm.trim() || null,
        country_code: countryCode,
        industry_id: industryId || null,
        registration_number: registrationNumber.trim(),
        address: address.trim() || null,
        website: website.trim() || null,
        contact_person: contactPerson.trim() || null,
        contact_email: contactEmail.trim() || null,
        contact_phone: contactPhone.trim() || null,
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
      title={initial ? t('policyholders.edit') : t('policyholders.add')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving || !valid}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Field label={t('policyholders.fields.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label={t('policyholders.fields.legalForm')}>
            <Input value={legalForm} onChange={(e) => setLegalForm(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('policyholders.fields.country')}>
            <Select value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
              {(countries ?? []).map((c) => (
                <option key={c.code} value={c.code}>
                  {refName(c, locale)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('policyholders.fields.industry')}>
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
        <Field label={t('policyholders.fields.registrationNumber')}>
          <Input
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
            required
          />
        </Field>
        <Field label={t('policyholders.fields.address')}>
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('policyholders.fields.contactPerson')}>
            <Input value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
          </Field>
          <Field label={t('policyholders.fields.contactPhone')}>
            <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('policyholders.fields.contactEmail')}>
            <Input
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </Field>
          <Field label={t('policyholders.fields.website')}>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
          </Field>
        </div>
        <Field label={t('policyholders.fields.notes')}>
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
