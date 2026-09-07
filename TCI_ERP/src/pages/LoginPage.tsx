import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { signInErrorKey } from '../auth/signInErrors'
import type { SignInFailure } from '../auth/signInErrors'
import { isTurnstileEnabled, mountTurnstile, turnstileSiteKey } from '../auth/turnstile'
import type { TurnstileHandle } from '../auth/turnstile'
import { Button, Card, Field, Input } from '../components/ui'
import { LanguageSwitcher } from '../components/layout/LanguageSwitcher'
import { landingPath } from '../features/portal/navigation'

export function LoginPage() {
  const { t } = useTranslation()
  const { session, roles, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<SignInFailure | null>(null)

  // Cloudflare Turnstile, invisible. Mounted once; a token is requested at
  // submit time. Absent site key = no CAPTCHA (dev, previews, CI).
  const siteKey = turnstileSiteKey()
  const captchaEnabled = isTurnstileEnabled(siteKey)
  const captchaRef = useRef<HTMLDivElement | null>(null)
  const turnstile = useRef<TurnstileHandle | null>(null)
  const [captchaBroken, setCaptchaBroken] = useState(false)

  useEffect(() => {
    if (!captchaEnabled || !siteKey || !captchaRef.current) return
    let disposed = false
    mountTurnstile(captchaRef.current, siteKey)
      .then((handle) => {
        if (disposed) handle.dispose()
        else turnstile.current = handle
      })
      .catch((e: unknown) => {
        console.error('Turnstile failed to mount', e)
        setCaptchaBroken(true)
      })
    return () => {
      disposed = true
      turnstile.current?.dispose()
      turnstile.current = null
    }
  }, [captchaEnabled, siteKey])

  // Land each user on their own side of the app. PortalRedirect would move
  // them a frame later anyway; doing it here avoids the flash of the wrong
  // shell.
  if (session) return <Navigate to={landingPath(roles)} replace />

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setFailure(null)
    let captchaToken: string | undefined
    if (captchaEnabled) {
      try {
        captchaToken = await turnstile.current?.getToken()
      } catch (err) {
        console.error('Turnstile challenge failed', err)
        setFailure({ kind: 'captcha' })
        setSubmitting(false)
        return
      }
    }
    const { error } = await signIn(email, password, captchaToken)
    if (error) {
      setFailure(error)
      setSubmitting(false)
    }
  }

  const tone = failure?.kind === 'locked' || failure?.kind === 'rateLimited' ? 'warn' : 'neg'

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-sm p-8">
        <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
          <div>
            <h1 className="text-xl font-semibold text-slate-900">{t('auth.signInTitle')}</h1>
            <p className="mt-0.5 text-[13px] text-slate-500">{t('auth.signInSubtitle')}</p>
          </div>

          <Field label={t('auth.email')}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </Field>

          <Field label={t('auth.password')}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>

          {/* The widget renders nothing unless Cloudflare needs an interaction. */}
          {captchaEnabled && <div ref={captchaRef} data-testid="turnstile" />}

          {failure && (
            <div
              className={
                tone === 'warn'
                  ? 'rounded-md border border-warn-500/30 bg-warn-50 px-3 py-2 text-[13px] text-warn-500'
                  : 'text-[13px] text-neg-500'
              }
              role="alert"
            >
              {t(signInErrorKey(failure), { minutes: failure.minutes ?? 0, count: failure.minutes ?? 0 })}
              {failure.kind === 'captcha' && captchaBroken && (
                <span className="ml-1">{t('auth.errors.captchaUnavailable')}</span>
              )}
            </div>
          )}

          <Button type="submit" disabled={submitting} className="justify-center">
            {submitting ? t('auth.signingIn') : t('auth.signIn')}
          </Button>

          <p className="text-center text-xs text-slate-400">{t('auth.noSelfSignup')}</p>
        </form>
      </Card>
    </div>
  )
}
