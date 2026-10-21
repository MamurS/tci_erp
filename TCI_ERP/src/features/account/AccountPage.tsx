/** «Мой аккаунт» for staff: password, second factor, other sessions.
 *
 * Mounted ABOVE the MFA gate (App.tsx): a person the policy sends here to
 * enrol must be able to reach it while every other screen is closed. */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import { Card, PageHeader, SectionTitle } from '../../components/ui'
import { MfaSection } from './MfaSection'
import { SessionsSection } from './SessionsSection'

export function AccountPage() {
  const { t } = useTranslation()
  const { session, roles } = useAuth()

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('account.title')} subtitle={session?.user.email ?? ''} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <SectionTitle className="mb-2">{t('portal.account.security')}</SectionTitle>
          <p className="mb-1 text-[13px] text-slate-500">
            {roles.length ? roles.map((r) => t(`roles.${r}`)).join(' · ') : t('roles.unassigned')}
          </p>
          <p className="mb-4 text-[13px] text-slate-500">{t('account.passwordHint')}</p>
          <Link
            to="/change-password"
            className="inline-flex items-center rounded-md bg-accent-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-accent-700"
          >
            {t('account.changePassword')}
          </Link>
        </Card>

        <MfaSection />
        <SessionsSection />
      </div>
    </div>
  )
}
