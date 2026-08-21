import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
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
    <div className="login-page">
      <div className="login-lang">
        <LanguageSwitcher />
      </div>
      <form className="login-card" onSubmit={(e) => void handleSubmit(e)}>
        <h1 className="login-title">{t('auth.signInTitle')}</h1>
        <p className="login-subtitle">{t('auth.signInSubtitle')}</p>

        <label className="field">
          <span className="field-label">{t('auth.email')}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </label>

        <label className="field">
          <span className="field-label">{t('auth.password')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? t('auth.signingIn') : t('auth.signIn')}
        </button>

        <p className="login-note">{t('auth.noSelfSignup')}</p>
      </form>
    </div>
  )
}
