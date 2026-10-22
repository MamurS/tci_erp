/** «Мой аккаунт» for staff: password, second factor, other sessions.
 *
 * Mounted ABOVE the MFA gate (App.tsx): a person the policy sends here to
 * enrol must be able to reach it while every other screen is closed. */

import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import { Card, LinkButton, PageHeader, SectionTitle } from '../../components/ui'
import { MfaSection } from './MfaSection'
import { SessionsSection } from './SessionsSection'

export function AccountPage() {
  const { t } = useTranslation()
  const { session } = useAuth()

  return (
    // The shell's full width like every page, so the title does not jump
    // sideways; the three settings stack, so no grid cell is left empty.
    <div>
      <PageHeader title={t('account.title')} subtitle={session?.user.email ?? ''} />

      <div className="flex flex-col gap-5">
        <Card className="p-5">
          {/* The same head as the cards below: title, one line of hint. The
              roles are on the user menu, top right. */}
          <SectionTitle className="mb-3" hint={t('account.passwordHint')}>
            {t('portal.account.security')}
          </SectionTitle>
          {/* Secondary: the page's one primary is enabling the second factor. */}
          <LinkButton variant="secondary" to="/change-password">
            {t('account.changePassword')}
          </LinkButton>
        </Card>

        <MfaSection />
        <SessionsSection />
      </div>
    </div>
  )
}
