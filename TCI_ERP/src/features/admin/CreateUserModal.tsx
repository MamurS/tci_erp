/** «Create user» — admin form (any roles) and the client-only variant sales
 * and commercial underwriting use from a company card.
 *
 * The role restriction is enforced by the service; this form simply does not
 * offer what the caller may not do, so a denial is a bug rather than a
 * routine outcome.
 */

import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Field, Input, Modal, Select } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { EM_DASH } from '../../lib/format'
import { USER_ROLES } from '../../lib/roles'
import type { UserRole } from '../../lib/roles'
import { canProvisionAnyRole } from './provisioningAccess'
import { useEntities } from '../entities/api'
import { useCreateUser } from './provisioningApi'
import { provisioningErrorKey } from './provisioningErrors'
import { TempPasswordPanel } from './TempPasswordPanel'
import type { ProvisionedUser } from '../../lib/provisioning'

interface CreateUserModalProps {
  open: boolean
  onClose: () => void
  /** Locks the form to a client user of this company (the company card
   * flow). Omit for the admin flow, which chooses roles freely. */
  lockedEntityId?: string
  onCreated?: (user: ProvisionedUser) => void
}

export function CreateUserModal({
  open,
  onClose,
  lockedEntityId,
  onCreated,
}: CreateUserModalProps) {
  const { t } = useTranslation()
  const { roles: callerRoles } = useAuth()
  const { data: entities } = useEntities()
  const createUser = useCreateUser()

  // Sales and commercial underwriting may create client users only, so the
  // role picker is not shown to them at all. Same rule as the service.
  const clientOnly = Boolean(lockedEntityId) || !canProvisionAnyRole(callerRoles)

  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [selectedRoles, setSelectedRoles] = useState<UserRole[]>(['client'])
  const [entityId, setEntityId] = useState('')
  const [entitySearch, setEntitySearch] = useState('')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [result, setResult] = useState<ProvisionedUser | null>(null)

  useEffect(() => {
    if (!open) return
    setEmail('')
    setFullName('')
    setSelectedRoles(clientOnly ? ['client'] : ['client'])
    setEntityId(lockedEntityId ?? '')
    setEntitySearch('')
    setErrorKey(null)
    setResult(null)
  }, [open, clientOnly, lockedEntityId])

  const needsEntity = selectedRoles.includes('client')
  const candidates = useMemo(() => {
    const query = entitySearch.trim().toLowerCase()
    return (entities ?? []).filter((e) => !query || e.name.toLowerCase().includes(query))
  }, [entities, entitySearch])

  const valid =
    /.+@.+\..+/.test(email.trim()) &&
    selectedRoles.length > 0 &&
    (!needsEntity || Boolean(entityId))

  const submit = async () => {
    if (!valid) return
    setErrorKey(null)
    try {
      const created = await createUser.mutateAsync({
        email: email.trim(),
        full_name: fullName.trim() || null,
        roles: selectedRoles,
        entity_id: needsEntity ? entityId : null,
      })
      setResult(created)
      onCreated?.(created)
    } catch (error) {
      setErrorKey(provisioningErrorKey(error))
    }
  }

  // Once the credentials are on screen the form is done: the only action
  // left is to acknowledge them.
  if (result) {
    return (
      <Modal open={open} onClose={onClose} title={t('provisioning.userCreated')}>
        <TempPasswordPanel user={result} onDismiss={onClose} />
      </Modal>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={clientOnly ? t('provisioning.inviteClient') : t('provisioning.createUser')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || createUser.isPending}>
            {createUser.isPending ? t('common.saving') : t('provisioning.create')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('provisioning.fields.email')}>
          <Input
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@mosaic.uz"
          />
        </Field>
        <Field label={t('provisioning.fields.fullName')}>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </Field>

        {clientOnly ? (
          <p className="text-[13px] text-slate-500">{t('provisioning.clientOnlyHint')}</p>
        ) : (
          <Field label={t('provisioning.fields.roles')}>
            <div className="flex flex-wrap gap-1.5">
              {USER_ROLES.map((role) => {
                const active = selectedRoles.includes(role)
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() =>
                      setSelectedRoles((prev) =>
                        prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
                      )
                    }
                    className={`rounded-md border px-2.5 py-1 text-[13px] font-medium transition-colors ${
                      active
                        ? 'border-accent-600 bg-accent-50 text-accent-700'
                        : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    {t(`roles.${role}`)}
                  </button>
                )
              })}
            </div>
          </Field>
        )}

        {/* A client user is meaningless without its company; the service
            rejects the pair being wrong either way. */}
        {needsEntity && !lockedEntityId && (
          <Field label={t('provisioning.fields.company')}>
            <Input
              value={entitySearch}
              onChange={(e) => setEntitySearch(e.target.value)}
              placeholder={t('entities.searchPlaceholder')}
            />
            <Select
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              className="mt-1.5"
            >
              <option value="">{t('common.notSelected')}</option>
              {candidates.slice(0, 50).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.registration_number ?? EM_DASH}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <p className="text-xs text-slate-400">{t('provisioning.noEmailHint')}</p>

        {errorKey && (
          <p className="text-[13px] text-neg-500" role="alert">
            {t(`provisioning.errors.${errorKey}`)}
          </p>
        )}
      </div>
    </Modal>
  )
}
