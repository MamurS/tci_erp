/** Admin → «Безопасность»: alerts, lockouts (with unlock), per-user MFA and
 * session state, live sessions (with revoke), the recent auth trail, and
 * the policy numbers. Everything comes from the 0044 admin views; the
 * screen never computes a security fact itself. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, EmptyState, Spinner, Table } from '../../components/ui'
import { formatMoment } from '../../lib/format'
import {
  useAdminSessions,
  useAuthEvents,
  useAuthPolicy,
  useLockouts,
  useSetLoginGateEnforced,
  useRevokeSessions,
  useSecurityAlerts,
  useUnlockAccount,
  useUserSecurity,
} from './securityApi'
import type { AuthEventRow } from './securityApi'

export function SecurityTab() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const policy = useAuthPolicy()
  const alerts = useSecurityAlerts()
  const lockouts = useLockouts()
  const setGate = useSetLoginGateEnforced()
  const users = useUserSecurity()
  const sessions = useAdminSessions()
  const events = useAuthEvents()
  const unlock = useUnlockAccount()
  const revoke = useRevokeSessions()
  const [actionError, setActionError] = useState<string | null>(null)

  const when = (v: string | null | undefined) => (v ? formatMoment(v, locale) : '—')

  const activeLockouts = (lockouts.data ?? []).filter((l) => l.active)
  const pastLockouts = (lockouts.data ?? []).filter((l) => !l.active)

  return (
    <div className="flex flex-col gap-5">
      {/* --- policy + hook notice --------------------------------------- */}
      <Card className="p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{t('admin.security.policy.title')}</h2>
        {policy.data ? (
          <ul className="grid gap-1 text-[13px] text-slate-600 sm:grid-cols-2">
            <li>
              {policy.data.login_free_attempts !== undefined
                ? t('admin.security.policy.loginSchedule', {
                    free: policy.data.login_free_attempts,
                    base: policy.data.login_base_lock_seconds,
                    max: Math.round((policy.data.login_max_lock_seconds ?? 3600) / 60),
                  })
                : t('admin.security.policy.lockout', {
                    failures: policy.data.lockout_max_failures,
                    window: policy.data.lockout_window_minutes,
                    duration: policy.data.lockout_duration_minutes,
                  })}
            </li>
            <li>
              {policy.data.mfa_required_for_admin
                ? t('admin.security.policy.mfaAdminOn')
                : t('admin.security.policy.mfaAdminOff')}
            </li>
            <li>
              {policy.data.mfa_staff_enforced_from
                ? t('admin.security.policy.mfaStaffFrom', {
                    date: formatMoment(policy.data.mfa_staff_enforced_from, locale),
                  })
                : t('admin.security.policy.mfaStaffGrace')}
            </li>
            <li>{t('admin.security.policy.retention', { days: policy.data.auth_events_retention_days })}</li>
          </ul>
        ) : (
          <Spinner label={t('common.loading')} />
        )}
        {policy.data?.login_gate_enforced !== undefined ? (
          <div
            className={`mt-3 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-[13px] ${
              policy.data.login_gate_enforced
                ? 'border-pos-500/30 bg-pos-50 text-slate-700'
                : 'border-warn-500/30 bg-warn-50 text-slate-700'
            }`}
          >
            <span className="flex-1">
              <strong>
                {policy.data.login_gate_enforced
                  ? t('admin.security.gate.enforcedOn')
                  : t('admin.security.gate.enforcedOff')}
              </strong>{' '}
              {t('admin.security.gate.hookSteps')}
            </span>
            <Button
              size="sm"
              variant={policy.data.login_gate_enforced ? 'secondary' : 'primary'}
              disabled={setGate.isPending}
              onClick={() => setGate.mutate(!policy.data!.login_gate_enforced)}
            >
              {policy.data.login_gate_enforced ? t('admin.security.gate.disable') : t('admin.security.gate.enable')}
            </Button>
          </div>
        ) : (
          <p className="mt-3 rounded-md border border-warn-500/30 bg-warn-50 px-3 py-2 text-[13px] text-warn-500">
            {t('admin.security.hookNotice')}
          </p>
        )}
      </Card>

      {/* --- alerts ----------------------------------------------------- */}
      {(alerts.data?.length ?? 0) > 0 && (
        <Card className="border-neg-500/30 p-4">
          <h2 className="mb-2 text-sm font-semibold text-neg-500">{t('admin.security.alerts.title')}</h2>
          <ul className="flex flex-col gap-1 text-[13px] text-slate-700">
            {alerts.data!.map((a) => (
              <li key={a.alert} className="flex items-center gap-2">
                <Badge tone={a.severity === 'high' ? 'neg' : 'accent'}>{a.severity}</Badge>
                {t(`admin.security.alerts.${a.alert}`, { count: a.n, since: when(a.since) })}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {actionError && (
        <p className="text-[13px] text-neg-500" role="alert">
          {actionError}
        </p>
      )}

      {/* --- lockouts --------------------------------------------------- */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{t('admin.security.lockouts.title')}</h2>
        {lockouts.isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : !activeLockouts.length && !pastLockouts.length ? (
          <EmptyState title={t('admin.security.lockouts.none')} hint={t('admin.security.lockouts.noneHint')} />
        ) : (
          <Table dense>
            <thead>
              <tr>
                <th>{t('admin.fields.email')}</th>
                <th>{t('admin.security.lockouts.lockedAt')}</th>
                <th>{t('admin.security.lockouts.until')}</th>
                <th>{t('admin.security.lockouts.failures')}</th>
                <th>{t('admin.security.lockouts.state')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {[...activeLockouts, ...pastLockouts].map((l) => (
                <tr key={l.user_id + l.locked_at}>
                  <td>{l.email ?? l.user_id}</td>
                  <td>{when(l.locked_at)}</td>
                  <td>{when(l.locked_until)}</td>
                  <td>
                    {l.reason === 'bypass' ? (
                      <span className="text-[13px] text-neg-500">{t('admin.security.lockouts.reasonBypass')}</span>
                    ) : (
                      l.failures
                    )}
                  </td>
                  <td>
                    {l.active ? (
                      <Badge tone="neg">{t('admin.security.lockouts.active')}</Badge>
                    ) : l.cleared_at ? (
                      <span className="text-[13px] text-slate-500">
                        {t('admin.security.lockouts.clearedBy', { email: l.cleared_by_email ?? '—' })}
                      </span>
                    ) : (
                      <span className="text-[13px] text-slate-500">{t('admin.security.lockouts.expired')}</span>
                    )}
                  </td>
                  <td className="text-right">
                    {l.active && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={unlock.isPending}
                        onClick={() => {
                          setActionError(null)
                          unlock.mutate(l.user_id, {
                            onError: () => setActionError(t('common.saveFailed')),
                          })
                        }}
                      >
                        {t('admin.security.lockouts.unlock')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      {/* --- per-user state --------------------------------------------- */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{t('admin.security.users.title')}</h2>
        {users.isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : (
          <Table dense>
            <thead>
              <tr>
                <th>{t('admin.fields.email')}</th>
                <th>{t('admin.security.users.mfa')}</th>
                <th>{t('admin.security.users.sessions')}</th>
                <th>{t('admin.security.users.failures')}</th>
                <th>{t('admin.security.users.lastFailure')}</th>
                <th>{t('admin.security.users.lastSuccess')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(users.data ?? []).map((u) => (
                <tr key={u.user_id}>
                  <td>
                    {u.email}
                    {u.locked && (
                      <Badge tone="neg">
                        <span className="ml-1">{t('admin.security.lockouts.active')}</span>
                      </Badge>
                    )}
                  </td>
                  <td>
                    <Badge tone={u.mfa_factors > 0 ? 'pos' : 'neutral'}>
                      {u.mfa_factors > 0 ? t('account.mfa.on') : t('account.mfa.off')}
                    </Badge>
                  </td>
                  <td>{u.sessions}</td>
                  <td>{u.failures_in_window}</td>
                  <td>{when(u.last_failure_at)}</td>
                  <td>{when(u.last_success_at)}</td>
                  <td className="text-right">
                    {u.sessions > 0 && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={revoke.isPending}
                        onClick={() => {
                          if (!window.confirm(t('admin.security.sessions.confirmRevoke', { email: u.email }))) return
                          setActionError(null)
                          revoke.mutate(
                            { userId: u.user_id, keepCurrent: true },
                            { onError: () => setActionError(t('common.saveFailed')) },
                          )
                        }}
                      >
                        {t('admin.security.sessions.revoke')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      {/* --- sessions --------------------------------------------------- */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{t('admin.security.sessions.title')}</h2>
        <p className="mb-2 text-[13px] text-slate-500">{t('admin.security.sessions.hint')}</p>
        {sessions.isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : !sessions.data?.length ? (
          <EmptyState title={t('admin.security.sessions.none')} />
        ) : (
          <Table dense>
            <thead>
              <tr>
                <th>{t('admin.fields.email')}</th>
                <th>{t('admin.security.sessions.started')}</th>
                <th>{t('admin.security.sessions.lastActive')}</th>
                <th>{t('admin.security.sessions.aal')}</th>
                <th>{t('admin.security.sessions.network')}</th>
                <th>{t('admin.security.sessions.agent')}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.data.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.email}
                    {s.is_current && (
                      <span className="ml-1 text-xs text-accent-700">{t('admin.security.sessions.current')}</span>
                    )}
                  </td>
                  <td>{when(s.created_at)}</td>
                  <td>{when(s.refreshed_at ?? s.updated_at)}</td>
                  <td>
                    <Badge tone={s.aal === 'aal2' ? 'pos' : 'neutral'}>{s.aal ?? '—'}</Badge>
                  </td>
                  <td className="font-mono text-xs">{s.ip_network ?? '—'}</td>
                  <td className="max-w-[24rem] truncate text-xs text-slate-500" title={s.user_agent ?? ''}>
                    {s.user_agent ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      {/* --- trail ------------------------------------------------------ */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">{t('admin.security.events.title')}</h2>
        {events.isLoading ? (
          <Spinner label={t('common.loading')} />
        ) : !events.data?.length ? (
          <EmptyState title={t('admin.security.events.none')} hint={t('admin.security.events.noneHint')} />
        ) : (
          <Table dense>
            <thead>
              <tr>
                <th>{t('admin.security.events.at')}</th>
                <th>{t('admin.security.events.type')}</th>
                <th>{t('admin.security.events.user')}</th>
                <th>{t('admin.security.events.actor')}</th>
                <th>{t('admin.security.events.details')}</th>
              </tr>
            </thead>
            <tbody>
              {events.data.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap">{when(e.at)}</td>
                  <td>
                    <Badge tone={eventTone(e.event_type)}>{eventLabel(e, t)}</Badge>
                  </td>
                  <td>{e.email ?? (e.user_id ? e.user_id.slice(0, 8) : '—')}</td>
                  <td>{e.actor_email ?? '—'}</td>
                  <td className="text-xs text-slate-500">{detailsText(e)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  )
}

function eventTone(type: string): 'neutral' | 'accent' | 'pos' | 'neg' {
  if (type.endsWith('.failure') || type === 'lockout.started' || type === 'sign_in.locked') return 'neg'
  if (type.endsWith('.success') || type === 'lockout.cleared') return 'pos'
  if (type.startsWith('user.') || type.startsWith('session.')) return 'accent'
  return 'neutral'
}

function eventLabel(e: AuthEventRow, t: (k: string, o?: Record<string, unknown>) => string): string {
  const key = `admin.security.eventTypes.${e.event_type.replace(/\./g, '_')}`
  const label = t(key)
  return label === key ? e.event_type : label
}

function detailsText(e: AuthEventRow): string {
  const d = e.details ?? {}
  const parts: string[] = []
  if (typeof d.role === 'string') parts.push(d.role)
  if (typeof d.recent_failures === 'number') parts.push(`×${d.recent_failures}`)
  if (typeof d.sessions === 'number') parts.push(`${d.sessions}`)
  if (typeof d.duration_minutes === 'number') parts.push(`${d.duration_minutes} min`)
  if (typeof d.factor_type === 'string') parts.push(d.factor_type)
  return parts.join(' · ')
}
