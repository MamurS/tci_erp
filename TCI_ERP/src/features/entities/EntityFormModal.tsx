/** Add/edit legal entity modal with dedup-on-entry:
 *  - exact (country, registration number) match -> BLOCKING notice + link;
 *  - pg_trgm name similarity (threshold 0.4, top 5) -> non-blocking
 *    "possible duplicates" suggestions. */

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button, DateInput, Field, Input, Modal } from '../../components/ui'
import {
  useCreateEntity,
  useRegNumberMatch,
  useSimilarEntities,
  useUpdateEntity,
} from './api'
import { CountryPicker } from './CountryPicker'
import { IndustryPicker } from './IndustryPicker'
import { countryFromLegalForm } from './legalForm'
import type { EntityInput } from './api'
import { dedupVerdict } from './dedup'
import type { LegalEntity } from './types'

/** The insurer's home market: a new company is Uzbek unless told otherwise. */
const DEFAULT_COUNTRY = 'UZ'

const todayIso = () => new Date().toISOString().slice(0, 10)

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
  /** Pre-fills a NEW company from a data request or an official registry
   * record. Ignored when editing. The duplicate checks run on it as usual. */
  prefill?: Partial<
    Pick<LegalEntity, 'name' | 'country_code' | 'registration_number' | 'address' | 'founded_date' | 'legal_form'>
  >
}

export function EntityFormModal({
  open,
  onClose,
  initial,
  initialName,
  onCreated,
  prefill,
}: EntityFormModalProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const createEntity = useCreateEntity()
  const updateEntity = useUpdateEntity(initial?.id ?? '')

  const [name, setName] = useState('')
  const [legalForm, setLegalForm] = useState('')
  const [countryCode, setCountryCode] = useState(DEFAULT_COUNTRY)
  // A new company's country follows the legal form in its name (ТОО → KZ,
  // GmbH → DE) until someone picks a country by hand, or a prefill gave one.
  const [countryChosen, setCountryChosen] = useState(false)
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

  // Compared by value: a caller may build the prefill object on every render,
  // and a refetch in the page behind must not wipe what is being typed.
  const prefillKey = JSON.stringify(initial ? null : (prefill ?? null))

  useEffect(() => {
    if (open) {
      const seed = JSON.parse(prefillKey) as EntityFormModalProps['prefill'] | null
      setName(initial?.name ?? seed?.name ?? initialName ?? '')
      setLegalForm(initial?.legal_form ?? seed?.legal_form ?? '')
      const seedName = initial?.name ?? seed?.name ?? initialName ?? ''
      const given = initial?.country_code ?? seed?.country_code ?? null
      setCountryCode(given ?? countryFromLegalForm(seedName) ?? DEFAULT_COUNTRY)
      setCountryChosen(given !== null)
      setIndustryId(initial?.industry_id ?? '')
      setRegistrationNumber(initial?.registration_number ?? seed?.registration_number ?? '')
      setFoundedDate(initial?.founded_date ?? seed?.founded_date ?? '')
      setAddress(initial?.address ?? seed?.address ?? '')
      setWebsite(initial?.website ?? '')
      setContactPerson(initial?.contact_person ?? '')
      setContactEmail(initial?.contact_email ?? '')
      setContactPhone(initial?.contact_phone ?? '')
      setNotes(initial?.notes ?? '')
      setError(null)
    }
  }, [open, initial, initialName, prefillKey])

  const onNameChange = (next: string) => {
    setName(next)
    if (!initial && !countryChosen) setCountryCode(countryFromLegalForm(next) ?? DEFAULT_COUNTRY)
  }

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
      wide
      onClose={onClose}
      title={initial ? t('entities.edit') : t('entities.add')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!valid} loading={saving}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Field label={t('buyers.fields.name')}>
            <Input value={name} onChange={(e) => onNameChange(e.target.value)} required />
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
            <CountryPicker
              value={countryCode || null}
              onChange={(code) => {
                setCountryCode(code ?? '')
                setCountryChosen(true)
              }}
            />
          </Field>
          <Field label={t('buyers.fields.industry')}>
            <IndustryPicker value={industryId || null} onChange={(code) => setIndustryId(code ?? '')} />
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
            <DateInput value={foundedDate} onChange={setFoundedDate} max={todayIso()} />
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
