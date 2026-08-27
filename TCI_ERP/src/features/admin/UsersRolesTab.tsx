/** Admin > Users & roles: every auth user with their role chips, last
 * sign-in, and a multi-select role editor. Writes are admin-only in RLS. */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, EmptyState, Modal, Spinner, Table } from '../../components/ui'
import { EM_DASH } from '../../lib/format'
import { STAFF_ROLES, USER_ROLES } from '../../lib/roles'
import type { UserRole } from '../../lib/roles'
import { useAuth } from '../../auth/AuthContext'
import { canDisableUser, canManageUser } from './provisioningAccess'
import { useAdminUsers, useSetUserRoles } from './api'
import type { AdminUser } from './api'
import { CreateUserModal } from './CreateUserModal'
import { ServiceUnavailableNotice } from './ServiceUnavailableNotice'
import { TempPasswordPanel } from './TempPasswordPanel'
import { provisioningErrorKey } from './provisioningErrors'
import {
  useProvisioningAvailable,
  useResetUserPassword,
  useSetUserDisabled,
} from './provisioningApi'
import type { ProvisionedUser } from '../../lib/provisioning'

export function UsersRolesTab({
  selectedUserId,
  onSelectUser,
}: {
  selectedUserId: string
  onSelectUser: (id: string) => void
}) {
  const { t } = useTranslation()
  const { session, roles: callerRoles } = useAuth()
  const { data: users, isLoading } = useAdminUsers()
  const { data: provisioningUp } = useProvisioningAvailable()
  const resetPassword = useResetUserPassword()
  const setDisabled = useSetUserDisabled()

  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [credentials, setCredentials] = useState<ProvisionedUser | null>(null)
  const [actionErrorKey, setActionErrorKey] = useState<string | null>(null)

  const runReset = async (user: AdminUser) => {
    setActionErrorKey(null)
    try {
      setCredentials(await resetPassword.mutateAsync(user.user_id))
    } catch (error) {
      setActionErrorKey(provisioningErrorKey(error))
    }
  }

  const toggleDisabled = async (user: AdminUser) => {
    setActionErrorKey(null)
    try {
      await setDisabled.mutateAsync({ userId: user.user_id, disabled: !user.disabled })
    } catch (error) {
      setActionErrorKey(provisioningErrorKey(error))
    }
  }

  if (isLoading) return <Spinner label={t('common.loading')} />

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[13px] text-slate-500">
          {t('admin.usersCount', { count: users?.length ?? 0 })}
        </span>
        <Button onClick={() => setCreateOpen(true)} disabled={provisioningUp === false}>
          {t('provisioning.createUser')}
        </Button>
      </div>

      {/* The service holds the service-role key and runs locally only. */}
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

      {actionErrorKey && (
        <p className="mb-3 text-[13px] text-neg-500" role="alert">
          {t(`provisioning.errors.${actionErrorKey}`)}
        </p>
      )}

      {!users?.length ? (
        <EmptyState title={t('admin.noUsers')} />
      ) : (
      <Table>
        <thead>
          <tr>
            <th>{t('admin.fields.email')}</th>
            <th>{t('admin.fields.roles')}</th>
            <th>{t('admin.fields.lastSignIn')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr
              key={u.user_id}
              onClick={() => onSelectUser(u.user_id)}
              className={`cursor-pointer transition-colors hover:bg-slate-50 ${
                u.user_id === selectedUserId ? 'bg-accent-50/60' : ''
              }`}
            >
              <td className="font-medium text-slate-800">
                {u.email}
                {u.full_name && (
                  <span className="block text-xs font-normal text-slate-400">{u.full_name}</span>
                )}
              </td>
              <td>
                <RoleChips roles={u.roles} />
                <span className="ml-1 inline-flex gap-1">
                  {u.disabled && <Badge tone="neg">{t('provisioning.disabled')}</Badge>}
                  {u.must_change_password && (
                    <Badge tone="warn">{t('provisioning.awaitingPasswordChange')}</Badge>
                  )}
                </span>
              </td>
              <td className="text-slate-500">
                {u.last_sign_in_at ? u.last_sign_in_at.slice(0, 16).replace('T', ' ') : EM_DASH}
              </td>
              <td className="text-right">
                <span className="inline-flex flex-wrap justify-end gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditing(u)
                    }}
                  >
                    {t('admin.editRoles')}
                  </Button>
                  {canManageUser(callerRoles, u.roles) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={provisioningUp === false || resetPassword.isPending}
                      onClick={(e) => {
                        e.stopPropagation()
                        void runReset(u)
                      }}
                    >
                      {t('provisioning.resetPassword')}
                    </Button>
                  )}
                  {/* Hidden rather than disabled for your own row: the
                      service refuses it, so a dead button would only puzzle. */}
                  {canDisableUser(callerRoles, u.user_id, session?.user.id) && (
                    <Button
                      variant={u.disabled ? 'secondary' : 'ghost'}
                      size="sm"
                      disabled={provisioningUp === false || setDisabled.isPending}
                      onClick={(e) => {
                        e.stopPropagation()
                        void toggleDisabled(u)
                      }}
                    >
                      {u.disabled ? t('provisioning.enable') : t('provisioning.disable')}
                    </Button>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      )}

      {editing && <RolesModal user={editing} onClose={() => setEditing(null)} />}
      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(user) => setCredentials(user)}
      />
    </>
  )
}

export function RoleChips({ roles }: { roles: readonly UserRole[] }) {
  const { t } = useTranslation()
  if (!roles.length) return <span className="text-xs text-slate-400">{t('roles.unassigned')}</span>
  return (
    <span className="inline-flex flex-wrap gap-1">
      {roles.map((r) => (
        <Badge key={r} tone={r === 'admin' ? 'neg' : r === 'client' ? 'neutral' : 'accent'}>
          {t(`roles.${r}`)}
        </Badge>
      ))}
    </span>
  )
}

function RolesModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const { t } = useTranslation()
  const setRoles = useSetUserRoles()
  const [selected, setSelected] = useState<UserRole[]>(user.roles)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setSelected(user.roles), [user])

  const toggle = (role: UserRole) =>
    setSelected((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    )

  const save = async () => {
    setError(null)
    try {
      await setRoles.mutateAsync({ userId: user.user_id, roles: selected })
      onClose()
    } catch {
      setError(t('common.saveFailed'))
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('admin.rolesFor', { email: user.email })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={setRoles.isPending}>
            {setRoles.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-slate-500">{t('admin.rolesHint')}</p>
      <div className="flex flex-col gap-2">
        {USER_ROLES.map((role) => (
          <label
            key={role}
            className="flex items-start gap-2.5 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50"
          >
            <input
              type="checkbox"
              checked={selected.includes(role)}
              onChange={() => toggle(role)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-sm font-medium text-slate-800">
                {t(`roles.${role}`)}
              </span>
              <span className="block text-xs text-slate-500">
                {t(`roles.descriptions.${role}`)}
              </span>
            </span>
          </label>
        ))}
      </div>
      {selected.includes('client') && selected.some((r) => STAFF_ROLES.includes(r)) && (
        <p className="mt-3 rounded-md border border-warn-500/30 bg-warn-50 px-3 py-2 text-[13px] text-warn-500">
          {t('admin.clientAndStaffWarning')}
        </p>
      )}
      {error && (
        <p className="mt-2 text-[13px] text-neg-500" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
