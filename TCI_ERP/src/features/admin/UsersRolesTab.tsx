/** Admin > Users & roles: every auth user with their role chips, their
 * direct manager (0060: offered first as the validator of their limit
 * decisions), last sign-in, and a multi-select role editor. Writes are
 * admin-only in RLS and in the functions. */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'

import {
  actionsCol,
  Badge,
  Button,
  COL,
  Combobox,
  EmptyState,
  Field,
  Modal,
  RowActions,
  Spinner,
  Table,
} from '../../components/ui'
import { refusalOr } from '../../lib/optimistic'
import { EM_DASH, formatMoment } from '../../lib/format'
import { STAFF_ROLES, USER_ROLES, clientRoleBlocked } from '../../lib/roles'
import type { UserRole } from '../../lib/roles'
import { useAuth } from '../../auth/AuthContext'
import { canDisableUser, canManageUser } from './provisioningAccess'
import {
  useAdminUsers,
  useSeniorAnalysts,
  useSetSeniorAnalyst,
  useSetUserManager,
  useSetUserRoles,
  useUserManagers,
} from './api'
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
  const { t, i18n } = useTranslation()
  const { session, roles: callerRoles } = useAuth()
  const { data: users, isLoading } = useAdminUsers()
  const { data: managers } = useUserManagers()
  const { data: seniors } = useSeniorAnalysts()
  const setSenior = useSetSeniorAnalyst()
  const [managerFor, setManagerFor] = useState<AdminUser | null>(null)
  const [managerError, setManagerError] = useState<string | null>(null)
  const { data: provisioningUp } = useProvisioningAvailable()
  const resetPassword = useResetUserPassword()
  const setDisabled = useSetUserDisabled()

  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [credentials, setCredentials] = useState<ProvisionedUser | null>(null)
  const [actionErrorKey, setActionErrorKey] = useState<string | null>(null)
  // The roles dialog closes at once (the chips repaint optimistically), so
  // a refusal is said here, beside the list it rolled back.
  const [rolesError, setRolesError] = useState<string | null>(null)

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
        <span className="text-small text-slate-500">
          {t('admin.usersCount', { count: users?.length ?? 0 })}
        </span>
        {/* Disabled says why: the notice below, and on the button itself. */}
        <Button
          onClick={() => setCreateOpen(true)}
          disabled={provisioningUp === false}
          title={provisioningUp === false ? t('provisioning.serviceUnavailable') : undefined}
        >
          <Plus />
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
        <p className="mb-3 text-small text-neg-500" role="alert">
          {t(`provisioning.errors.${actionErrorKey}`)}
        </p>
      )}
      {rolesError && (
        <p className="mb-3 text-small text-neg-500" role="alert">
          {rolesError}
        </p>
      )}
      {managerError && (
        <p className="mb-3 text-small text-neg-500" role="alert">
          {managerError}
        </p>
      )}

      {!users?.length ? (
        <EmptyState title={t('admin.noUsers')} />
      ) : (
      <Table columns={[COL.fill, '22rem', COL.person, COL.moment, actionsCol(['editRoles', 'resetPassword', 'disableEnable'])]}>
        <thead>
          <tr>
            <th>{t('admin.fields.email')}</th>
            <th>{t('admin.fields.roles')}</th>
            <th>{t('admin.fields.manager')}</th>
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
                  <span className="block text-caption font-normal text-slate-500">{u.full_name}</span>
                )}
              </td>
              <td>
                <RoleChips roles={u.roles} />
                {/* A credit analyst may be marked senior: they set group
                    ratings (0074). Admin's flag, toggled here. */}
                {u.roles.includes('credit_analyst') && (
                  <button
                    type="button"
                    className="ml-1 text-caption text-accent-700 hover:underline disabled:opacity-60"
                    disabled={setSenior.isPending}
                    title={t('admin.senior.hint')}
                    onClick={(e) => {
                      e.stopPropagation()
                      setRolesError(null)
                      setSenior
                        .mutateAsync({ userId: u.user_id, senior: !seniors?.has(u.user_id) })
                        .catch((failure: unknown) => setRolesError(t(refusalOr(failure, 'common.saveFailed'))))
                    }}
                  >
                    {seniors?.has(u.user_id) ? `✓ ${t('admin.senior.marked')}` : t('admin.senior.mark')}
                  </button>
                )}
                <span className="ml-1 inline-flex gap-1">
                  {u.disabled && <Badge tone="neg">{t('provisioning.disabled')}</Badge>}
                  {u.must_change_password && (
                    <Badge tone="warn">{t('provisioning.awaitingPasswordChange')}</Badge>
                  )}
                </span>
              </td>
              <td>
                {/* Staff only: a client has no limit decisions to validate. */}
                {u.roles.some((r) => STAFF_ROLES.includes(r)) ? (
                  <button
                    type="button"
                    className="block max-w-full truncate text-left text-accent-700 hover:underline"
                    title={t('admin.manager.set')}
                    onClick={(e) => {
                      e.stopPropagation()
                      setManagerError(null)
                      setManagerFor(u)
                    }}
                  >
                    {managerName(users, managers?.[u.user_id]) ?? t('admin.manager.none')}
                  </button>
                ) : (
                  <span className="text-slate-500">{EM_DASH}</span>
                )}
              </td>
              <td className="text-slate-500">
                {u.last_sign_in_at ? formatMoment(u.last_sign_in_at, i18n.language) : EM_DASH}
              </td>
              <RowActions>
                <span className="inline-flex flex-wrap justify-end gap-2">
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
                      loading={resetPassword.isPending && resetPassword.variables === u.user_id}
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
                      loading={setDisabled.isPending && setDisabled.variables?.userId === u.user_id}
                      onClick={(e) => {
                        e.stopPropagation()
                        void toggleDisabled(u)
                      }}
                    >
                      {u.disabled ? t('provisioning.enable') : t('provisioning.disable')}
                    </Button>
                  )}
                </span>
              </RowActions>
            </tr>
          ))}
        </tbody>
      </Table>
      )}

      {managerFor && (
        <ManagerModal
          user={managerFor}
          users={users ?? []}
          current={managers?.[managerFor.user_id] ?? null}
          onClose={() => setManagerFor(null)}
          onFailed={setManagerError}
        />
      )}
      {editing && (
        <RolesModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaving={() => setRolesError(null)}
          onFailed={setRolesError}
        />
      )}
      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(user) => setCredentials(user)}
      />
    </>
  )
}

/** A colleague as the column names them. */
function managerName(users: readonly AdminUser[], id: string | undefined | null): string | null {
  if (!id) return null
  const user = users.find((u) => u.user_id === id)
  return user ? user.full_name?.trim() || user.email : null
}

/** The direct manager of one person: any other staff member, or nobody. */
function ManagerModal({
  user,
  users,
  current,
  onClose,
  onFailed,
}: {
  user: AdminUser
  users: readonly AdminUser[]
  current: string | null
  onClose: () => void
  onFailed: (message: string) => void
}) {
  const { t } = useTranslation()
  const setManager = useSetUserManager()
  const [picked, setPicked] = useState<string | null>(current)

  const options = users
    .filter((u) => u.user_id !== user.user_id && !u.disabled && u.roles.some((r) => STAFF_ROLES.includes(r)))
    .map((u) => ({
      id: u.user_id,
      label: u.full_name?.trim() || u.email,
      keywords: [u.email],
      meta: u.roles.map((r) => t(`roles.${r}`)).join(' · '),
    }))

  // The column repaints at once (optimistic); a refusal is said in the list.
  const save = (managerId: string | null) => {
    onClose()
    setManager
      .mutateAsync({ userId: user.user_id, managerId })
      .catch((failure: unknown) => onFailed(t(refusalOr(failure, 'common.saveFailed'))))
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={t('admin.manager.title', { email: user.full_name?.trim() || user.email })}
      footer={
        <>
          {current && (
            <Button variant="ghost" onClick={() => save(null)}>
              {t('admin.manager.clear')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => save(picked)} disabled={!picked || picked === current}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <p className="text-small text-slate-500">{t('admin.manager.hint')}</p>
      <Field label={t('admin.fields.manager')}>
        <Combobox value={picked} onChange={setPicked} options={options} openOnFocus autoFocus placeholder={t('admin.manager.placeholder')} />
      </Field>
    </Modal>
  )
}

export function RoleChips({ roles }: { roles: readonly UserRole[] }) {
  const { t } = useTranslation()
  if (!roles.length) return <span className="text-caption text-slate-500">{t('roles.unassigned')}</span>
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

function RolesModal({
  user,
  onClose,
  onSaving,
  onFailed,
}: {
  user: AdminUser
  onClose: () => void
  onSaving: () => void
  onFailed: (message: string) => void
}) {
  const { t } = useTranslation()
  const setRoles = useSetUserRoles()
  const [selected, setSelected] = useState<UserRole[]>(user.roles)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setSelected(user.roles), [user])

  const toggle = (role: UserRole) =>
    setSelected((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    )
  // A portal client holds no other role (0062 refuses it): with the client
  // role ticked the staff roles are off, and with any staff role ticked the
  // client role is.
  const blocked = (role: UserRole) => clientRoleBlocked(selected, role)

  // The user's role chips change at once (optimistic, api.ts): the dialog
  // closes on the click and a refusal is reported in the list.
  const save = () => {
    setError(null)
    onSaving()
    onClose()
    setRoles
      .mutateAsync({ userId: user.user_id, roles: selected })
      .catch((failure: unknown) => onFailed(t(refusalOr(failure, 'common.saveFailed'))))
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
          <Button onClick={save} loading={setRoles.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-small text-slate-500">{t('admin.rolesHint')}</p>
      <div className="flex flex-col gap-2">
        {USER_ROLES.map((role) => (
          <label
            key={role}
            className={`flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2 ${
              blocked(role) ? 'cursor-not-allowed opacity-60' : 'hover:bg-slate-50'
            }`}
          >
            <input
              type="checkbox"
              checked={selected.includes(role)}
              disabled={blocked(role)}
              onChange={() => toggle(role)}
              className="mt-0.5"
            />
            <span>
              <span className="block text-body font-medium text-slate-800">
                {t(`roles.${role}`)}
              </span>
              <span className="block text-caption text-slate-500">
                {t(`roles.descriptions.${role}`)}
              </span>
            </span>
          </label>
        ))}
      </div>
      <p className="mt-3 text-small text-slate-500">{t('admin.clientAloneHint')}</p>
      {error && (
        <p className="mt-2 text-small text-neg-500" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
