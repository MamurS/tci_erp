/** The insurer's own particulars, printed into contracts as {{insurer.*}}.
 *  Admin edits; everyone who generates contracts sees what will be printed. */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card, Field, Input, SectionTitle, Select, Spinner } from '../../components/ui'
import { useCountries } from '../entities/api'
import type { InsurerProfile } from './api'
import { useInsurerProfile, useSaveInsurerProfile } from './api'
import { WORDING_SYNTAX } from './catalogue'
import { wordingErrorKey } from './errors'

type Editable = Omit<InsurerProfile, 'updated_at'>

const FIELDS: readonly (keyof Editable)[] = [
  'legal_name', 'legal_form', 'registration_number', 'tax_id', 'license_number', 'license_date',
  'country_code', 'address', 'phone', 'email', 'website', 'bank_name', 'bank_account', 'bank_code',
  'signatory_name', 'signatory_title', 'signatory_basis',
]

const empty = (): Editable => Object.fromEntries(FIELDS.map((f) => [f, null])) as unknown as Editable

export function InsurerProfileCard({ canEdit }: { canEdit: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: profile, isLoading } = useInsurerProfile()
  const { data: countries } = useCountries()
  const save = useSaveInsurerProfile()
  const [form, setForm] = useState<Editable>(empty)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (profile) {
      const next = empty()
      for (const f of FIELDS) (next as Record<string, string | null>)[f] = profile[f]
      setForm(next)
    }
  }, [profile])

  if (isLoading) return <Spinner label={t('common.loading')} />

  const set = (field: keyof Editable, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value.trim() === '' ? null : value }))

  return (
    <Card className="p-5">
      <SectionTitle>{t('wording.insurer.title')}</SectionTitle>
      <p className="mb-4 text-[13px] text-slate-500">{t('wording.insurer.hint', WORDING_SYNTAX)}</p>
      <div className="grid gap-3 md:grid-cols-3">
        {FIELDS.map((field) => (
          <Field key={field} label={t(`wording.insurer.fields.${field}`)}>
            {field === 'country_code' ? (
              <Select
                value={form.country_code ?? ''}
                disabled={!canEdit}
                onChange={(e) => set('country_code', e.target.value)}
              >
                <option value="">{t('common.notSelected')}</option>
                {(countries ?? []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {locale === 'ru' ? c.name_ru : locale === 'uz' ? c.name_uz : c.name_en}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                type={field === 'license_date' ? 'date' : 'text'}
                value={(form[field] as string | null) ?? ''}
                disabled={!canEdit}
                onChange={(e) => set(field, e.target.value)}
              />
            )}
          </Field>
        ))}
      </div>
      {canEdit && (
        <div className="mt-4 flex items-center gap-3">
          <Button
            disabled={save.isPending}
            onClick={() => {
              setMessage(null)
              save
                .mutateAsync(form)
                .then(() => setMessage({ tone: 'ok', text: t('wording.insurer.saved') }))
                .catch((e: unknown) => setMessage({ tone: 'error', text: t(wordingErrorKey(e)) }))
            }}
          >
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
          {message && (
            <span className={`text-[13px] ${message.tone === 'ok' ? 'text-pos-500' : 'text-neg-500'}`}>{message.text}</span>
          )}
        </div>
      )}
    </Card>
  )
}
