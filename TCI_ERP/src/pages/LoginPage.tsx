import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { signInErrorKey } from '../auth/signInErrors'
import type { SignInFailure } from '../auth/signInErrors'
import { isTurnstileEnabled, mountTurnstile, turnstileSiteKey } from '../auth/turnstile'
import type { TurnstileHandle } from '../auth/turnstile'
import { BrandMark, Button, Field, Input } from '../components/ui'
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
    <div className="flex min-h-screen bg-white">
      {/* Brand panel */}
      <div className="relative hidden w-[46%] max-w-[640px] flex-col justify-between overflow-hidden bg-gradient-to-br from-accent-600 via-accent-700 to-accent-900 p-12 text-white lg:flex">
        <BrandPixels />
        <BrandMark size="lg" inverse />
        <div className="relative">
          <h2 className="font-display text-[44px] leading-[1.05] font-bold tracking-wide uppercase">
            {t('auth.heroTitle')}
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/75">{t('auth.heroText')}</p>
        </div>
        <div className="relative flex items-center gap-2 text-[12px] text-white/55">
          <span className="inline-block size-2.5 bg-brand-orange" aria-hidden="true" />
          {t('app.company')}
        </div>
      </div>

      {/* Form */}
      <div className="relative flex flex-1 items-center justify-center p-6">
        <div className="absolute top-5 right-5">
          <LanguageSwitcher />
        </div>
        <form className="flex w-full max-w-sm flex-col gap-5" onSubmit={(e) => void handleSubmit(e)}>
          <div className="lg:hidden">
            <BrandMark size="md" />
          </div>
          <div>
            <h1 className="font-display text-[30px] leading-tight font-bold tracking-wide text-accent-600 uppercase">
              {t('auth.signInTitle')}
            </h1>
            <p className="mt-1 text-[14px] text-slate-500">{t('auth.signInSubtitle')}</p>
          </div>

          <Field label={t('auth.email')}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              className="h-11"
            />
          </Field>

          <Field label={t('auth.password')}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="h-11"
            />
          </Field>

          {/* The widget renders nothing unless Cloudflare needs an interaction. */}
          {captchaEnabled && <div ref={captchaRef} data-testid="turnstile" />}

          {failure && (
            <div
              className={
                tone === 'warn'
                  ? 'rounded-md border border-warn-500/30 bg-warn-50 px-3 py-2 text-[13px] text-warn-500'
                  : 'rounded-md border border-neg-500/25 bg-neg-50 px-3 py-2 text-[13px] text-neg-500'
              }
              role="alert"
            >
              {t(signInErrorKey(failure), { minutes: failure.minutes ?? 0, count: failure.minutes ?? 0 })}
              {failure.kind === 'captcha' && captchaBroken && (
                <span className="ml-1">{t('auth.errors.captchaUnavailable')}</span>
              )}
            </div>
          )}

          <Button type="submit" disabled={submitting} className="h-11 w-full text-[15px]">
            {submitting ? t('auth.signingIn') : t('auth.signIn')}
          </Button>

          <p className="text-center text-xs text-slate-400">{t('auth.noSelfSignup')}</p>
        </form>
      </div>
    </div>
  )
}

/** The pixel-square motif of the brand, top-right of the panel. */
function BrandPixels() {
  const cells = [
    [0, 0, 0.18], [1, 0, 0.32], [2, 0, 0.12], [3, 0, 0.5],
    [1, 1, 0.14], [2, 1, 0.4], [3, 1, 0.22],
    [2, 2, 0.2], [3, 2, 0.12],
    [3, 3, 0.3],
  ] as const
  return (
    <svg className="pointer-events-none absolute top-0 right-0 w-40 opacity-80" viewBox="0 0 4 4" aria-hidden="true">
      {cells.map(([x, y, o]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="0.94" height="0.94" fill="#0093d0" opacity={o} />
      ))}
    </svg>
  )
}
