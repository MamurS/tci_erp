/** Add/edit legal entity modal with dedup-on-entry:
 *  - exact (country, registration number) match -> BLOCKING notice + link;
 *  - pg_trgm name similarity (threshold 0.4, top 5) -> non-blocking
 *    "possible duplicates" suggestions. */

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button, Field, Input, Modal, Select } from '../../components/ui'
import {
  refName,
  useCountries,
  useCreateEntity,
  useIndustries,
  useRegNumberMatch,
  useSimilarEntities,
  useUpdateEntity,
} from './api'
import type { EntityInput } from './api'
import { dedupVerdict } from './dedup'
import type { LegalEntity } from './types'

interface EntityFormModalProps {
  open: boolean
  onClose: () => void
  initial?: LegalEntity | null
  /** Pre-fills the name of a NEW company (e.g. the proposed name of an
   * unresolved submission buyer). Ignored when editing. */
  initialName?: string
  /** When given, a newly created company is handed back instead of being
   * navigated to - the caller stays where it is (submission buyer
   * resolution). Without it the form keeps its registry behaviour. */
  onCreated?: (entity: LegalEntity) => void
}

export function EntityFormModal({
  open,
  onClose,
  initial,
  initialName,
  onCreated,
}: EntityFormModalProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()
  const { data: countries } = useCountries()
  const { data: industries } = useIndustries()
  const createEntity = useCreateEntity()
  const updateEntity = useUpdateEntity(initial?.id ?? '')

  const [name, setName] = useState('')
  const [legalForm, setLegalForm] = useState('')
  const [countryCode, setCountryCode] = useState('UZ')
  const [industryId, setIndustryId] = useState('')
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [foundedDate, setFoundedDate] = useState('')
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
      setName(initial?.name ?? initialName ?? '')
      setLegalForm(initial?.legal_form ?? '')
      setCountryCode(initial?.country_code ?? 'UZ')
      setIndustryId(initial?.industry_id ?? '')
      setRegistrationNumber(initial?.registration_number ?? '')
      setFoundedDate(initial?.founded_date ?? '')
      setAddress(initial?.address ?? '')
      setWebsite(initial?.website ?? '')
      setContactPerson(initial?.contact_person ?? '')
      setContactEmail(initial?.contact_email ?? '')
      setContactPhone(initial?.contact_phone ?? '')
      setNotes(initial?.notes ?? '')
      setError(null)
    }
  }, [open, initial, initialName])

  // Dedup-on-entry (both checks exclude the entity being edited).
  const regMatch = useRegNumberMatch(countryCode, registrationNumber, initial?.id)
  const similar = useSimilarEntities(name, initial?.id)
  const dedup = dedupVerdict(regMatch.data, similar.data)
  const blocked = dedup.blocked

  const valid = Boolean(name.trim()) && !blocked

  const handleSubmit = async () => {
    if (!valid) return
    setSaving(true)
    setError(null)
    const input: EntityInput = {
      name: name.trim(),
      legal_form: legalForm.trim() || null,
      country_code: countryCode,
      industry_id: industryId || null,
      registration_number: registrationNumber.trim() || null,
      founded_date: foundedDate || null,
      address: address.trim() || null,
      website: website.trim() || null,
      contact_person: contactPerson.trim() || null,
      contact_email: contactEmail.trim() || null,
      contact_phone: contactPhone.trim() || null,
      notes: notes.trim() || null,
    }
    try {
      if (initial) {
        await updateEntity.mutateAsync(input)
      } else {
        const created = await createEntity.mutateAsync(input)
        if (onCreated) onCreated(created)
        else void navigate(`/entities/${created.id}`)
      }
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
      title={initial ? t('entities.edit') : t('entities.add')}
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
          <Field label={t('buyers.fields.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label={t('buyers.fields.legalForm')}>
            <Input value={legalForm} onChange={(e) => setLegalForm(e.target.value)} />
          </Field>
        </div>

        {/* Non-blocking fuzzy duplicates while typing the name */}
        {!initial && dedup.suggestions.length > 0 && (
          <div className="rounded-md border border-warn-500/30 bg-warn-50 px-3 py-2 text-[13px]">
            <p className="mb-1 font-medium text-warn-500">{t('entities.possibleDuplicates')}</p>
            <ul className="flex flex-col gap-0.5">
              {dedup.suggestions.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/entities/${s.id}`}
                    className="text-accent-700 hover:underline"
                    onClick={onClose}
                  >
                    {s.name}
                  </Link>{' '}
                  <span className="text-slate-500">{s.registration_number ?? ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

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
          />
        </Field>

        {/* Blocking exact duplicate on (country, registration number) */}
        {blocked && dedup.blockingEntity && (
          <div
            className="rounded-md border border-neg-500/30 bg-neg-50 px-3 py-2 text-[13px] text-neg-500"
            role="alert"
          >
            {t('entities.regExists', { name: dedup.blockingEntity.name })}{' '}
            <Link
              to={`/entities/${dedup.blockingEntity.id}`}
              className="font-medium underline"
              onClick={onClose}
            >
              {t('entities.openEntity')}
            </Link>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('buyers.fields.foundedDate')}>
            <Input type="date" value={foundedDate} onChange={(e) => setFoundedDate(e.target.value)} />
          </Field>
          <Field label={t('buyers.fields.website')}>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
          </Field>
        </div>
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
          <Field label={t('buyers.fields.notes')}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        {error && (
          <p className="text-[13px] text-neg-500" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  )
}
