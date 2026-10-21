/** The insurer's own particulars, printed into contracts as {{insurer.*}}.
 *  Admin edits; everyone who generates contracts sees what will be printed. */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Card, Field, Input, SectionTitle, Spinner } from '../../components/ui'
import { CountryPicker } from '../entities/CountryPicker'
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
  const { t } = useTranslation()
  const { data: profile, isLoading } = useInsurerProfile()
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
      <SectionTitle className="mb-4" hint={t('wording.insurer.hint', WORDING_SYNTAX)}>
        {t('wording.insurer.title')}
      </SectionTitle>
      <div className="grid gap-3 md:grid-cols-3">
        {FIELDS.map((field) => (
          <Field key={field} label={t(`wording.insurer.fields.${field}`)}>
            {field === 'country_code' ? (
              <CountryPicker
                value={form.country_code ?? null}
                disabled={!canEdit}
                onChange={(code) => set('country_code', code ?? '')}
              />
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
