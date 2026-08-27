/** «Client access» on the company card: the portal users of this company,
 * and the invite button.
 *
 * Lives here rather than in Admin because sales invite clients as part of
 * working an account, not as an administrative chore. Visible to admin,
 * sales and commercial underwriting; the service enforces the same rule,
 * and tci.v_entity_client_users returns nothing to anyone else.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, EmptyState, Spinner, Table } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { EM_DASH } from '../../lib/format'
import { canProvision } from './provisioningAccess'
import { CreateUserModal } from './CreateUserModal'
import { ServiceUnavailableNotice } from './ServiceUnavailableNotice'
import { TempPasswordPanel } from './TempPasswordPanel'
import { provisioningErrorKey } from './provisioningErrors'
import {
  useEntityClientUsers,
  useProvisioningAvailable,
  useResetUserPassword,
} from './provisioningApi'
import type { ProvisionedUser } from '../../lib/provisioning'

export function EntityClientAccessSection({ entityId }: { entityId: string }) {
  const { t } = useTranslation()
  const { roles } = useAuth()
  const { data: users, isLoading } = useEntityClientUsers(entityId)
  const { data: provisioningUp } = useProvisioningAvailable()
  const resetPassword = useResetUserPassword()

  const [inviteOpen, setInviteOpen] = useState(false)
  const [credentials, setCredentials] = useState<ProvisionedUser | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  // The view already filters by role; this keeps the section itself away
  // from anyone who could not act on it.
  if (!canProvision(roles)) return null

  const runReset = async (userId: string) => {
    setErrorKey(null)
    try {
      setCredentials(await resetPassword.mutateAsync(userId))
    } catch (error) {
      setErrorKey(provisioningErrorKey(error))
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{t('provisioning.clientAccess')}</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">{t('provisioning.clientAccessHint')}</p>
        </div>
        <Button
          size="sm"
          onClick={() => setInviteOpen(true)}
          disabled={provisioningUp === false}
        >
          {t('provisioning.inviteClient')}
        </Button>
      </div>

      {provisioningUp === false && (
        <div className="mb-3">
          <ServiceUnavailableNotice />
        </div>
      )}

      {credentials && (
        <div className="mb-3">
          <TempPasswordPanel user={credentials} onDismiss={() => setCredentials(null)} />
        </div>
      )}

      {errorKey && (
        <p className="mb-3 text-[13px] text-neg-500" role="alert">
          {t(`provisioning.errors.${errorKey}`)}
        </p>
      )}

      {isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : !users?.length ? (
        <EmptyState
          title={t('provisioning.noClientUsers')}
          hint={t('provisioning.noClientUsersHint')}
        />
      ) : (
        <Table dense>
          <thead>
            <tr>
              <th>{t('provisioning.fields.email')}</th>
              <th>{t('provisioning.fields.fullName')}</th>
              <th>{t('admin.fields.lastSignIn')}</th>
              <th>{t('provisioning.fields.state')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id}>
                <td className="font-medium text-slate-800">{u.email}</td>
                <td className="text-slate-600">{u.full_name ?? EM_DASH}</td>
                <td className="text-slate-500">
                  {u.last_sign_in_at
                    ? u.last_sign_in_at.slice(0, 16).replace('T', ' ')
                    : t('provisioning.neverSignedIn')}
                </td>
                <td>
                  {u.disabled ? (
                    <Badge tone="neg">{t('provisioning.disabled')}</Badge>
                  ) : u.must_change_password ? (
                    <Badge tone="warn">{t('provisioning.awaitingPasswordChange')}</Badge>
                  ) : (
                    <Badge tone="pos">{t('provisioning.active')}</Badge>
                  )}
                </td>
                <td className="text-right">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={provisioningUp === false || resetPassword.isPending}
                    onClick={() => void runReset(u.user_id)}
                  >
                    {t('provisioning.resetPassword')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <CreateUserModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        lockedEntityId={entityId}
        onCreated={(user) => setCredentials(user)}
      />
    </Card>
  )
}
