/** Shown when a signed-in user opens a section their ACTING role does not
 * cover (direct URL, a link from a colleague or the Agenda). The sidebar
 * hides such sections; this is the guard. When another role the person
 * holds opens the section, the page offers to switch to it (0063). */

import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button, Card } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { rolesOpening } from '../auth/actingRole'
import { rememberWorkspace, workspaceForRole } from '../components/layout/workspaces'
import { refusalKey } from '../lib/refusals'
import type { UserRole } from '../lib/roles'

export function NoAccessPage() {
  const { t } = useTranslation()
  const { heldRoles, actingRole, switchActingRole } = useAuth()
  const { pathname } = useLocation()
  const [switching, setSwitching] = useState<UserRole | null>(null)
  const [error, setError] = useState<string | null>(null)
  const others = rolesOpening(heldRoles, actingRole, pathname)

  const switchTo = async (role: UserRole) => {
    setError(null)
    setSwitching(role)
    try {
      const workspace = workspaceForRole(role)
      if (workspace) rememberWorkspace(workspace.key)
      await switchActingRole(role)
    } catch (failure) {
      setError(t(refusalKey(failure)))
    } finally {
      setSwitching(null)
    }
  }

  return (
    <Card className="mx-auto mt-10 max-w-lg p-8 text-center">
      <p className="text-3xl" aria-hidden>
        🔒
      </p>
      <h1 className="mt-3 text-lg font-semibold text-slate-900">{t('access.denied')}</h1>
      <p className="mt-2 text-[0.8125rem] text-slate-500">
        {others.length > 0 ? t('access.otherRoleOpens') : t('access.deniedHint')}
      </p>
      <p className="mt-3 text-[0.8125rem] text-slate-500">
        {t('access.yourRoles')}:{' '}
        {heldRoles.length ? (
          heldRoles.map((r) => t(`roles.${r}`)).join(', ')
        ) : (
          <span className="text-slate-400">{t('roles.unassigned')}</span>
        )}
      </p>
      {others.length > 0 && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {others.map((role) => (
            <Button key={role} loading={switching === role} onClick={() => void switchTo(role)}>
              {t('access.openAs', { role: t(`roles.${role}`) })}
            </Button>
          ))}
        </div>
      )}
      {error && (
        <p className="mt-3 text-[0.8125rem] text-neg-500" role="alert">
          {error}
        </p>
      )}
      <Link
        to="/"
        className="mt-5 inline-block text-sm font-medium text-accent-700 hover:underline"
      >
        {t('access.backToDashboard')}
      </Link>
    </Card>
  )
}
