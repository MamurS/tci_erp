import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { Button, Card, Field, Input } from '../components/ui'
import { LanguageSwitcher } from '../components/layout/LanguageSwitcher'

export function LoginPage() {
  const { t } = useTranslation()
  const { session, signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (session) return <Navigate to="/" replace />

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    const { error: signInError } = await signIn(email, password)
    if (signInError) {
      setError(
        signInError.toLowerCase().includes('invalid')
          ? t('auth.errors.invalidCredentials')
          : t('auth.errors.generic'),
      )
      setSubmitting(false)
    }
  }

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

          {error && (
            <p className="text-[13px] text-neg-500" role="alert">
              {error}
            </p>
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
