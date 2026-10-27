import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { signInErrorKey } from '../auth/signInErrors'
import { formatCountdown } from '../auth/loginGate'
import type { SignInFailure } from '../auth/signInErrors'
import { isTurnstileEnabled, mountTurnstile, turnstileSiteKey } from '../auth/turnstile'
import type { TurnstileHandle } from '../auth/turnstile'
import { LOGIN_MOSAIC_URI } from '../components/ui/heroMosaic'
import { BrandMark, Button, Field, Input, PasswordInput } from '../components/ui'
import { LanguageSwitcher } from '../components/layout/LanguageSwitcher'
import { landingPath } from '../features/portal/navigation'
import { NewVersionNotice } from '../components/layout/NewVersionNotice'
import { useNewVersion } from '../lib/useNewVersion'
import { reloadIntoNewBuild } from '../lib/appVersion'

/** A licensed photograph for the sign-in panel (a path under /public), or
 * null for the trade mosaic. None has been provided yet. */
const LOGIN_PHOTO: string | null = null

export function LoginPage() {
  const { t } = useTranslation()
  const { session, roles, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [failure, setFailure] = useState<SignInFailure | null>(null)
  // When the next attempt may start (epoch ms): the form stays put, the
  // button counts down (the gate refuses earlier attempts anyway).
  const [waitUntil, setWaitUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [helpOpen, setHelpOpen] = useState(false)

  // A sign-in page left open across a deploy would sign in with the old
  // code. While nothing has been typed a reload loses nothing, so it
  // reloads by itself; with a half-typed form it asks instead.
  const newVersion = useNewVersion()
  const pristine = email === '' && password === '' && !submitting
  const [reloadDeclined, setReloadDeclined] = useState(false)
  useEffect(() => {
    if (!newVersion || !pristine) return
    void reloadIntoNewBuild().then((reloading) => {
      if (!reloading) setReloadDeclined(true)
    })
  }, [newVersion, pristine])
  // The notice only where the page does not reload by itself: no flash of
  // it while the reload is on its way.
  const offerReload = newVersion && (!pristine || reloadDeclined)

  useEffect(() => {
    if (waitUntil === null) return
    const tick = window.setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= waitUntil) setWaitUntil(null)
    }, 250)
    return () => window.clearInterval(tick)
  }, [waitUntil])
  const waitSeconds = waitUntil === null ? 0 : Math.max(0, (waitUntil - now) / 1000)
  const waiting = waitSeconds > 0

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
      if (error.seconds) {
        setNow(Date.now())
        setWaitUntil(Date.now() + error.seconds * 1000)
      }
      setPassword('')
      setSubmitting(false)
    }
  }

  const tone =
    waiting ||
    failure?.kind === 'locked' ||
    failure?.kind === 'rateLimited' ||
    failure?.kind === 'throttled'
      ? 'warn'
      : 'neg'

  return (
    <div className="flex min-h-screen bg-white">
      {/* Brand panel */}
      {/* Brand panel: deep navy with the brochure's trade mosaic rising from
          the bottom (our own drawings; LOGIN_PHOTO takes a licensed photograph
          instead once there is one — DESIGN.md «Sign-in»). */}
      <div data-brand-surface className="relative hidden w-[55%] max-w-[52rem] flex-col justify-between overflow-hidden bg-accent-900 bg-linear-to-b from-accent-900 via-accent-800 to-accent-900 p-12 text-white lg:flex">
        <img
          src={LOGIN_PHOTO ?? LOGIN_MOSAIC_URI}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 w-full opacity-70 select-none [mask-image:linear-gradient(to_top,black_35%,transparent_95%)]"
        />
        <div className="relative">
          <BrandMark size="lg" inverse />
        </div>
        <div className="relative max-w-xl">
          <div className="mb-4 text-caption font-semibold tracking-wider text-sky-200 uppercase">
            {t('app.company')}
          </div>
          <h2 className="font-display text-display leading-[1.05] font-bold text-white">
            {t('auth.heroTitle')}
          </h2>
          <p className="mt-4 text-lead leading-relaxed text-accent-100">{t('auth.heroText')}</p>
        </div>
        <div className="relative h-1/3" aria-hidden="true" />
      </div>

      {/* Form */}
      <div className="relative flex flex-1 items-center justify-center p-6">
        <div className="absolute top-5 right-5">
          <LanguageSwitcher />
        </div>
        <form
          className="flex w-full max-w-sm flex-col gap-5"
          onSubmit={(e) => void handleSubmit(e)}
        >
          <div className="lg:hidden">
            <BrandMark size="md" />
          </div>
          <div>
            <h1 className="font-display text-headline leading-tight font-bold text-slate-900">
              {t('auth.signInTitle')}
            </h1>
            <p className="mt-1 text-body text-slate-500">{t('auth.signInSubtitle')}</p>
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
            {/* No revealResetKey: a successful sign-in leaves this page. */}
            <PasswordInput
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
                  ? 'rounded-md border border-warn-500/30 bg-warn-50 px-3 py-2 text-small text-warn-500'
                  : 'rounded-md border border-neg-500/25 bg-neg-50 px-3 py-2 text-small text-neg-500'
              }
              role="alert"
            >
              <p>
                {t(signInErrorKey(failure), {
                  minutes: failure.minutes ?? 0,
                  count: failure.minutes ?? 0,
                  time: formatCountdown(waitSeconds),
                })}
                {failure.kind === 'captcha' && captchaBroken && (
                  <span className="ml-1">{t('auth.errors.captchaUnavailable')}</span>
                )}
              </p>
              {failure.kind === 'invalidCredentials' && failure.attemptsLeft === 1 && !waiting && (
                <p className="mt-1 text-small">{t('auth.lastAttemptWarning')}</p>
              )}
              {failure.kind === 'invalidCredentials' && waiting && (
                <p className="mt-1 text-small">
                  {t('auth.errors.throttled', { time: formatCountdown(waitSeconds) })}
                </p>
              )}
            </div>
          )}

          <Button type="submit" disabled={submitting || waiting} className="h-11 w-full text-lead">
            {waiting
              ? t('auth.retryIn', { time: formatCountdown(waitSeconds) })
              : submitting
                ? t('auth.signingIn')
                : t('auth.signIn')}
          </Button>

          <div className="text-center">
            <button
              type="button"
              onClick={() => setHelpOpen((v) => !v)}
              className="text-small font-medium text-accent-600 hover:text-accent-500 hover:underline"
              aria-expanded={helpOpen}
            >
              {t('auth.forgotPassword')}
            </button>
            {helpOpen && (
              <p className="mt-2 rounded-md bg-accent-50 px-3 py-2 text-left text-small leading-relaxed text-slate-600">
                {t('auth.forgotPasswordHelp')}
              </p>
            )}
          </div>

          <p className="text-center text-caption text-slate-500">{t('auth.noSelfSignup')}</p>
        </form>
      </div>
      <NewVersionNotice stale={offerReload} />
    </div>
  )
}
