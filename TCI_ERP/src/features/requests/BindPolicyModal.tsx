/**
 * «Выпустить полис» — the bind step. The submission's agreed terms become a
 * policy; only the number and the cover period are entered here, because
 * everything else was settled during the commercial review and is projected
 * verbatim by tci.bind_insurance_request.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button, Field, Input, Modal } from '../../components/ui'
import { useBindInsuranceRequest } from './api'
import { defaultBindDates, missingTerms, validateBind } from './bind'
import type { BindFormValues } from './bind'
import type { InsuranceRequest } from './types'

interface Props {
  request: InsuranceRequest
  open: boolean
  onClose: () => void
}

export function BindPolicyModal({ request, open, onClose }: Props) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const bind = useBindInsuranceRequest(request.id)

  const [form, setForm] = useState<BindFormValues>(() => ({
    policy_number: '',
    ...defaultBindDates(new Date()),
  }))
  const [submitted, setSubmitted] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const missing = missingTerms(request)
  const errors = validateBind(form)
  const blocked = missing.length > 0 || Object.keys(errors).length > 0

  const set = (patch: Partial<BindFormValues>) => setForm((f) => ({ ...f, ...patch }))

  const message = (field: keyof BindFormValues) => {
    const error = submitted && errors[field]
    if (!error) return null
    return <span className="text-[13px] text-neg-500">{t(`requests.bind.validation.${error}`)}</span>
  }

  const run = async () => {
    setSubmitted(true)
    setServerError(null)
    if (blocked) return
    try {
      const policy = await bind.mutateAsync({
        policyNumber: form.policy_number.trim(),
        inceptionDate: form.inception_date,
        expiryDate: form.expiry_date,
      })
      onClose()
      void navigate(`/policies/${policy.id}`)
    } catch (error) {
      // The function's refusals are deterministic and named; anything else is
      // genuinely unknown and says so rather than pretending to know.
      const code = (error as { code?: string } | null)?.code
      setServerError(
        code === 'P0004'
          ? t('requests.bind.errors.notAllowed')
          : code === 'P0001'
            ? t('requests.bind.errors.refused')
            : t('requests.bind.errors.unknown'),
      )
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('requests.bind.title')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={bind.isPending || missing.length > 0} onClick={() => void run()}>
            {t('requests.bind.confirm')}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-600">
        {t('requests.bind.intro', { number: request.request_number })}
      </p>

      {missing.length > 0 && (
        <div className="mb-4 rounded-md border border-warn-500/30 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500">
          {t('requests.bind.missingTerms', {
            terms: missing.map((term) => t(`requests.terms.${term}`)).join(', '),
          })}
        </div>
      )}

      {serverError && (
        <div
          className="mb-4 rounded-md border border-neg-500/30 bg-neg-50 px-4 py-2.5 text-[13px] text-neg-500"
          role="alert"
        >
          {serverError}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Field label={t('policies.fields.policyNumber')}>
          <Input
            value={form.policy_number}
            onChange={(e) => set({ policy_number: e.target.value })}
          />
          {message('policy_number')}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('policies.fields.inceptionDate')}>
            <Input
              type="date"
              value={form.inception_date}
              onChange={(e) => set({ inception_date: e.target.value })}
            />
            {message('inception_date')}
          </Field>
          <Field label={t('policies.fields.expiryDate')}>
            <Input
              type="date"
              value={form.expiry_date}
              onChange={(e) => set({ expiry_date: e.target.value })}
            />
            {message('expiry_date')}
          </Field>
        </div>
      </div>

      <p className="mt-4 text-[13px] text-slate-500">{t('requests.bind.note')}</p>
    </Modal>
  )
}
