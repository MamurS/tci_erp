/** The step-up: a signed-in user with a verified factor enters the code.
 *
 * Standalone, like the login page: no shell, because the shell's data would
 * be empty anyway - the database gates are closed until the session reaches
 * aal2. A wrong code is answered by Supabase; five wrong codes lock the
 * account through the MFA verification hook (0044), and the lockout message
 * is shown as such.
 */

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../auth/AuthContext'
import { classifySignInError, signInErrorKey } from '../auth/signInErrors'
import { Button, Card, Field, Input } from '../components/ui'
import { LanguageSwitcher } from '../components/layout/LanguageSwitcher'
import { landingPath } from '../features/portal/navigation'
import { supabase } from '../lib/supabase'

export function MfaVerifyPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { session, roles, authStatus, refreshAuthStatus, signOut } = useAuth()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase.auth.mfa.listFactors().then(({ data }) => {
      if (cancelled) return
      const verified = (data?.totp ?? []).find((f) => f.status === 'verified')
      setFactorId(verified?.id ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!session) return <Navigate to="/login" replace />
  // Already stepped up (or never needed to): nothing to do here.
  if (authStatus?.mfaSatisfied) {
    const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname
    return <Navigate to={from && from !== '/mfa/verify' ? from : landingPath(roles)} replace />
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!factorId) return
    setBusy(true)
    setError(null)
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId,
      code: code.trim(),
    })
    if (verifyError) {
      const failure = classifySignInError({
        code: verifyError.code,
        status: 'status' in verifyError ? (verifyError as { status?: number }).status : undefined,
        message: verifyError.message,
      })
      setError(
        failure.kind === 'locked' || failure.kind === 'rateLimited'
          ? t(signInErrorKey(failure), { minutes: failure.minutes ?? 0, count: failure.minutes ?? 0 })
          : t('mfaVerify.badCode'),
      )
      setBusy(false)
      setCode('')
      return
    }
    await refreshAuthStatus()
    setBusy(false)
    void navigate(landingPath(roles), { replace: true })
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-sm p-8">
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <div>
            <h1 className="text-title font-semibold text-slate-900">{t('mfaVerify.title')}</h1>
            <p className="mt-0.5 text-small text-slate-500">{t('mfaVerify.hint')}</p>
          </div>
          <p className="text-small text-slate-500">{session.user.email}</p>

          <Field label={t('mfaVerify.code')}>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="font-mono tracking-widest"
              autoFocus
            />
          </Field>

          {error && (
            <p className="text-small text-neg-500" role="alert">
              {error}
            </p>
          )}
          {factorId === null && (
            <p className="text-small text-slate-500">{t('mfaVerify.noFactor')}</p>
          )}

          <Button type="submit" disabled={busy || code.length !== 6 || !factorId} className="justify-center">
            {busy ? t('mfaVerify.verifying') : t('mfaVerify.verify')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => void signOut()}>
            {t('auth.signOut')}
          </Button>
        </form>
      </Card>
    </div>
  )
}
