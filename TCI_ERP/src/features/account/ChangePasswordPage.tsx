/** Self-service password change.
 *
 * Two audiences on one screen: a user forced here after provisioning (they
 * cannot leave until it is done), and anyone who chose «Change password»
 * from the header menu. The copy switches; the rules do not.
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button, Card, Field, Input, PageHeader } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { supabase, tci } from '../../lib/supabase'
import { MIN_PASSWORD_LENGTH, checkPassword, passwordStrength } from './password'

export function ChangePasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { session, mustChangePassword, clearPasswordChangeFlag } = useAuth()

  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [touched, setTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const email = session?.user.email ?? ''
  const verdict = checkPassword(password, confirmation, email)
  const strength = passwordStrength(password)

  const submit = async () => {
    setTouched(true)
    if (!verdict.valid) return
    setSaving(true)
    setError(null)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        setError(updateError.message)
        return
      }
      // Record the rotation. The password itself already changed, so a
      // failure here must not look like the change failed.
      const { error: flagError } = await tci().rpc('complete_password_change')
      if (flagError) console.error('Failed to clear the password-change flag', flagError)
      clearPasswordChangeFlag()
      void navigate('/', { replace: true })
    } catch {
      setError(t('common.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader
        title={t('account.changePassword')}
        subtitle={mustChangePassword ? t('account.forcedSubtitle') : t('account.subtitle')}
      />

      {mustChangePassword && (
        <div className="mb-4 rounded-md border border-warn-500/30 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500">
          {t('account.forcedNotice')}
        </div>
      )}

      <Card className="flex flex-col gap-3 p-5">
        <p className="text-[13px] text-slate-500">{email}</p>

        <Field label={t('account.newPassword')}>
          <Input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => setTouched(true)}
          />
          {password && (
            <p className="mt-1 text-xs">
              <span className="text-slate-500">{t('account.strength')}: </span>
              <span
                className={
                  strength === 'strong'
                    ? 'text-pos-500'
                    : strength === 'fair'
                      ? 'text-warn-500'
                      : 'text-neg-500'
                }
              >
                {t(`account.strengths.${strength}`)}
              </span>
            </p>
          )}
        </Field>

        <Field label={t('account.confirmPassword')}>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        </Field>

        <ul className="flex flex-col gap-0.5 text-xs text-slate-500">
          <Rule ok={password.length >= MIN_PASSWORD_LENGTH} touched={touched}>
            {t('account.rules.length', { count: MIN_PASSWORD_LENGTH })}
          </Rule>
          <Rule ok={!verdict.problems.includes('noLetter')} touched={touched}>
            {t('account.rules.letter')}
          </Rule>
          <Rule ok={!verdict.problems.includes('noDigit')} touched={touched}>
            {t('account.rules.digit')}
          </Rule>
          <Rule ok={!verdict.problems.includes('sameAsEmail')} touched={touched}>
            {t('account.rules.notEmail')}
          </Rule>
          <Rule
            ok={Boolean(confirmation) && !verdict.problems.includes('mismatch')}
            touched={touched}
          >
            {t('account.rules.match')}
          </Rule>
        </ul>

        {error && (
          <p className="text-[13px] text-neg-500" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <Button onClick={() => void submit()} disabled={saving || !verdict.valid}>
            {saving ? t('common.saving') : t('account.savePassword')}
          </Button>
          {/* No way out while the rotation is mandatory. */}
          {!mustChangePassword && (
            <Button variant="secondary" onClick={() => void navigate(-1)}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      </Card>
    </div>
  )
}

function Rule({
  ok,
  touched,
  children,
}: {
  ok: boolean
  touched: boolean
  children: React.ReactNode
}) {
  const tone = ok ? 'text-pos-500' : touched ? 'text-neg-500' : 'text-slate-400'
  return (
    <li className={tone}>
      <span aria-hidden className="mr-1">
        {ok ? '✓' : '·'}
      </span>
      {children}
    </li>
  )
}
