/** Two-factor authentication (TOTP) — enrol, confirm, remove.
 *
 * One card, shared by the staff account page and the portal account page.
 * Enrolment is Supabase Auth's own flow (enroll → challenge → verify); the
 * database learns about it through auth.mfa_factors, which is what
 * tci.mfa_satisfied() reads. Removing the only factor while the policy
 * requires one closes every gate for this user until they enrol again, so
 * the confirmation says so.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import { Badge, Button, Card, ConfirmDialog, Field, Input, SectionTitle } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { formatMoment } from '../../lib/format'

interface Factor {
  id: string
  friendly_name?: string | null
  status: 'verified' | 'unverified'
}

interface Enrolment {
  factorId: string
  qrCode: string
  secret: string
}

export function MfaSection() {
  const { t, i18n } = useTranslation()
  const { authStatus, refreshAuthStatus } = useAuth()

  const [factors, setFactors] = useState<Factor[]>([])
  const [removing, setRemoving] = useState<Factor | null>(null)
  const [loading, setLoading] = useState(true)
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const loadFactors = async () => {
    const { data, error: listError } = await supabase.auth.mfa.listFactors()
    if (listError) {
      console.error('Failed to list MFA factors', listError)
      setFactors([])
    } else {
      setFactors((data?.totp ?? []) as Factor[])
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadFactors()
  }, [])

  const verified = factors.filter((f) => f.status === 'verified')

  const startEnrolment = async () => {
    setBusy(true)
    setError(null)
    setDone(false)
    // A stale unverified factor blocks a new enrolment under the same name;
    // clear any that were abandoned half-way.
    for (const f of factors.filter((x) => x.status === 'unverified')) {
      await supabase.auth.mfa.unenroll({ factorId: f.id })
    }
    const { data, error: enrolError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: t('account.mfa.factorName'),
    })
    setBusy(false)
    if (enrolError || !data) {
      setError(t('account.mfa.enrolFailed'))
      return
    }
    setEnrolment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret })
    setCode('')
  }

  const confirmEnrolment = async () => {
    if (!enrolment) return
    setBusy(true)
    setError(null)
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrolment.factorId,
      code: code.trim(),
    })
    setBusy(false)
    if (verifyError) {
      setError(t('account.mfa.badCode'))
      return
    }
    setEnrolment(null)
    setCode('')
    setDone(true)
    await loadFactors()
    await refreshAuthStatus()
  }

  const cancelEnrolment = async () => {
    if (enrolment) await supabase.auth.mfa.unenroll({ factorId: enrolment.factorId })
    setEnrolment(null)
    setCode('')
    setError(null)
    await loadFactors()
  }

  const removeFactor = async (factor: Factor) => {
    setRemoving(null)
    setBusy(true)
    setError(null)
    const { error: unenrolError } = await supabase.auth.mfa.unenroll({ factorId: factor.id })
    setBusy(false)
    if (unenrolError) {
      // Supabase requires an aal2 session to remove a verified factor.
      setError(t('account.mfa.disableFailed'))
      return
    }
    await loadFactors()
    await refreshAuthStatus()
  }

  return (
    <Card className="p-5">
      <SectionTitle
        className="mb-3"
        hint={t('account.mfa.hint')}
        actions={
          !loading && (
            <Badge tone={verified.length ? 'pos' : authStatus?.mfaRequired ? 'neg' : 'neutral'}>
              {verified.length ? t('account.mfa.on') : t('account.mfa.off')}
            </Badge>
          )
        }
      >
        {t('account.mfa.title')}
      </SectionTitle>

      {authStatus?.mfaRequired && !verified.length && (
        <div className="mb-3 rounded-md border border-neg-500/30 bg-red-50 px-3 py-2 text-[13px] text-neg-500">
          {t('account.mfa.requiredNotice')}
        </div>
      )}
      {!authStatus?.mfaRequired && authStatus?.mfaStaffEnforcedFrom && !verified.length && (
        <div className="mb-3 rounded-md border border-warn-500/30 bg-warn-50 px-3 py-2 text-[13px] text-warn-500">
          {t('account.mfa.graceNotice', { date: formatMoment(authStatus.mfaStaffEnforcedFrom, i18n.language) })}
        </div>
      )}

      {done && <p className="mb-3 text-[13px] text-pos-500">{t('account.mfa.enrolledNow')}</p>}

      {!enrolment && (
        <div className="flex flex-col gap-2">
          {verified.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-[13px]"
            >
              <span className="text-slate-700">{f.friendly_name || t('account.mfa.factorName')}</span>
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => setRemoving(f)}>
                {t('account.mfa.disable')}
              </Button>
            </div>
          ))}
          {!verified.length && (
            <div>
              <Button disabled={busy || loading} onClick={() => void startEnrolment()}>
                {t('account.mfa.enable')}
              </Button>
            </div>
          )}
        </div>
      )}

      {enrolment && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-slate-600">{t('account.mfa.scan')}</p>
          <img
            src={enrolment.qrCode}
            alt={t('account.mfa.qrAlt')}
            className="h-44 w-44 rounded-md border border-slate-200 bg-white p-1"
          />
          <p className="text-xs text-slate-500">
            {t('account.mfa.secret')}{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] text-slate-700">
              {enrolment.secret}
            </code>
          </p>
          <Field label={t('account.mfa.code')}>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="max-w-[10rem] font-mono tracking-widest"
            />
          </Field>
          <div className="flex gap-2">
            <Button disabled={busy || code.length !== 6} onClick={() => void confirmEnrolment()}>
              {busy ? t('common.saving') : t('account.mfa.verify')}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => void cancelEnrolment()}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 text-[13px] text-neg-500" role="alert">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={removing !== null}
        title={t('account.mfa.disable')}
        message={t(authStatus?.mfaRequired ? 'account.mfa.confirmDisableRequired' : 'account.mfa.confirmDisable')}
        confirmLabel={t('account.mfa.disable')}
        pending={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && void removeFactor(removing)}
      />
    </Card>
  )
}
