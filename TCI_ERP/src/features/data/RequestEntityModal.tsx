/**
 * «Запросить создание организации» — offered wherever a search finds
 * nothing. Before anything is filed the fuzzy duplicate check runs on what
 * the person typed, so a different spelling of a company we hold is shown
 * first. Filing creates a request in an information manager's Agenda; the
 * person is told who has it and is told again when it is done.
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button, Callout, Field, Input, Modal, Select, Textarea } from '../../components/ui'
import { refusalKey } from '../../lib/refusals'
import { refName, useCountries, useSimilarEntities } from '../entities/api'
import { useRequestEntity, useStaffDirectory } from './api'
import { staffName } from './staff'
import type { RequestResult } from './types'

export function RequestEntityModal({
  open,
  initialName,
  onClose,
}: {
  open: boolean
  initialName: string
  onClose: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: countries } = useCountries()
  const staff = useStaffDirectory()
  const request = useRequestEntity()
  const [name, setName] = useState(initialName)
  const [country, setCountry] = useState('UZ')
  const [registration, setRegistration] = useState('')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<RequestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const similar = useSimilarEntities(name)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setRegistration('')
      setNote('')
      setResult(null)
      setError(null)
    }
  }, [open, initialName])

  const submit = () => {
    setError(null)
    request
      .mutateAsync({ name, country, registrationNumber: registration, note })
      .then(setResult)
      .catch((e: unknown) => setError(t(refusalKey(e))))
  }

  return (
    <Modal
      open={open}
      title={t('data.requestModal.title')}
      onClose={onClose}
      footer={
        result ? (
          <Button onClick={onClose}>{t('common.close')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button disabled={!name.trim() || request.isPending} onClick={submit}>
              {t('data.requestModal.submit')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <ResultMessage result={result} assignee={staffName(staff.data, result.assigned_to ?? null)} onClose={onClose} />
      ) : (
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-slate-600">{t('data.requestModal.hint')}</p>
          {error && <Callout tone="neg" title={error} />}
          <Field label={t('data.fields.company')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>

          {(similar.data ?? []).length > 0 && (
            <Callout tone="warn" title={t('data.requestModal.similarTitle')}>
              <ul className="mt-1 space-y-1">
                {(similar.data ?? []).map((e) => (
                  <li key={e.id}>
                    <Link to={`/entities/${e.id}`} onClick={onClose} className="font-medium text-accent-600 hover:underline">
                      {e.name}
                    </Link>
                    <span className="text-slate-500"> · {e.country_code}{e.registration_number ? ` · ${e.registration_number}` : ''}</span>
                  </li>
                ))}
              </ul>
            </Callout>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('data.fields.country')}>
              <Select value={country} onChange={(e) => setCountry(e.target.value)}>
                {(countries ?? []).map((c) => (
                  <option key={c.code} value={c.code}>
                    {refName(c, locale)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('data.fields.registrationNumber')} hint={t('data.requestModal.registrationHint')}>
              <Input value={registration} onChange={(e) => setRegistration(e.target.value)} />
            </Field>
          </div>
          <Field label={t('data.fields.note')} hint={t('data.requestModal.noteHint')}>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
      )}
    </Modal>
  )
}

function ResultMessage({ result, assignee, onClose }: { result: RequestResult; assignee: string; onClose: () => void }) {
  const { t } = useTranslation()
  if (result.result === 'exists')
    return (
      <Callout
        tone="info"
        title={t('data.requestModal.exists')}
        action={
          <Link to={`/entities/${result.entity_id}`} onClick={onClose} className="font-medium text-accent-600 hover:underline">
            {t('data.request.openCompany')}
          </Link>
        }
      />
    )
  return (
    <Callout
      tone={result.result === 'requested' ? 'pos' : 'info'}
      title={
        result.result === 'requested'
          ? t('data.requestModal.requested', { number: result.request_number })
          : t('data.requestModal.alreadyRequested', { number: result.request_number })
      }
    >
      {result.assigned_to ? t('data.requestModal.assignedTo', { name: assignee }) : t('data.requestModal.toTeam')}
      <span className="mt-1 block">{t('data.requestModal.youWillBeTold')}</span>
    </Callout>
  )
}
