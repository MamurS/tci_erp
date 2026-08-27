/** Shown when a signed-in user opens a section their roles do not cover
 * (direct URL). The sidebar hides such sections; this is the guard. */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Card } from '../components/ui'
import { useAuth } from '../auth/AuthContext'

export function NoAccessPage() {
  const { t } = useTranslation()
  const { roles } = useAuth()

  return (
    <Card className="mx-auto mt-10 max-w-lg p-8 text-center">
      <p className="text-3xl" aria-hidden>
        🔒
      </p>
      <h1 className="mt-3 text-lg font-semibold text-slate-900">{t('access.denied')}</h1>
      <p className="mt-2 text-[13px] text-slate-500">{t('access.deniedHint')}</p>
      <p className="mt-3 text-[13px] text-slate-500">
        {t('access.yourRoles')}:{' '}
        {roles.length ? (
          roles.map((r) => t(`roles.${r}`)).join(', ')
        ) : (
          <span className="text-slate-400">{t('roles.unassigned')}</span>
        )}
      </p>
      <Link
        to="/"
        className="mt-5 inline-block text-sm font-medium text-accent-700 hover:underline"
      >
        {t('access.backToDashboard')}
      </Link>
    </Card>
  )
}
