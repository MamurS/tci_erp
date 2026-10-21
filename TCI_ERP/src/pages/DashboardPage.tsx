/**
 * The dashboard answers two questions, in this order: what needs me now,
 * and how does the book look. So it is one KPI strip, one work list (the
 * caller's own Agenda, worst first) and one column of signals — not a wall
 * of equal cards. Every number links to the screen where it is worked.
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlarmClock,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileText,
  FileWarning,
  Hourglass,
  Scale,
  ShieldAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { useAuth } from '../auth/AuthContext'
import { Card, Skeleton } from '../components/ui'
import { useAgendaTasks, useTaskSubjects, subjectFor } from '../features/agenda/api'
import { compareTasks, formatTaskParams, isOverdue, taskLink } from '../features/agenda/catalogue'
import type { Task } from '../features/agenda/types'
import { useDeclarations } from '../features/declarations/api'
import { declarationCompliance, premiumAccrual } from '../features/declarations/summary'
import { useEntities, useEntityRoles } from '../features/entities/api'
import { useClaims } from '../features/claims'
import { isOpen as claimIsOpen } from '../features/claims/machine'
import { useEscalatedCount } from '../features/limits/api'
import { useOverdueNotifications } from '../features/overdue/api'
import { usePolicies } from '../features/policies/api'
import { useAllPolicyPremium } from '../features/policies/premiumApi'
import { hasRole, isStaff } from '../lib/roles'
import { EM_DASH, formatAmount, formatCompact, formatLongDate, formatPercent, formatDue } from '../lib/format'
import { buildSignals, dayPart } from './dashboard'
import type { Signal } from './dashboard'

const TASKS_SHOWN = 7

const SIGNAL_ICONS: Record<Signal['key'], LucideIcon> = {
  overduesLate: AlarmClock,
  escalatedLimits: ShieldAlert,
  declarationsDisputed: Scale,
  claimsAwaitingInfo: Hourglass,
  declarationsAwaiting: ClipboardList,
}

export function DashboardPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { roles } = useAuth()
  const now = new Date()

  // Who sees what is unchanged from the card dashboard: commercial
  // underwriting and sales move declarations and premium, credit and
  // commercial underwriting work overdues, claims belongs to claims (and the
  // underwriters read it, because an approved claim moves a limit).
  const seesDeclarations = hasRole(roles, 'admin', 'sales', 'commercial_underwriter')
  const seesOverdues = hasRole(roles, 'admin', 'credit_underwriter', 'commercial_underwriter')
  const seesClaims = hasRole(roles, 'admin', 'claims', 'credit_underwriter', 'commercial_underwriter')
  const canDecide = hasRole(roles, 'admin', 'credit_underwriter')

  const { data: policies } = usePolicies()
  const { data: entities } = useEntities()
  const entityRoles = useEntityRoles()
  const { data: declarations } = useDeclarations()
  const { data: overdues } = useOverdueNotifications()
  const { data: policyPremium } = useAllPolicyPremium()
  const { data: claims } = useClaims()
  const { data: escalated } = useEscalatedCount(canDecide)
  const agenda = useAgendaTasks({ enabled: isStaff(roles) })

  const tasks = [...(agenda.data ?? [])].sort(compareTasks)
  const shownTasks = tasks.slice(0, TASKS_SHOWN)
  const subjects = useTaskSubjects(shownTasks)

  const activePolicies = policies?.filter((p) => p.status === 'active').length
  const policyholders = entityRoles.data
    ? [...entityRoles.data.values()].filter((r) => r.is_policyholder).length
    : undefined
  const compliance = declarations ? declarationCompliance(declarations) : null
  const openOverdues = overdues?.filter((n) => n.status === 'open')
  const lateOverdues = openOverdues?.filter((n) => n.reported_late).length
  const accrual = policyPremium ? premiumAccrual(policyPremium) : null
  const openClaims = claims?.filter((c) => claimIsOpen(c.status)).length
  const awaitingInfo = claims?.filter((c) => c.status === 'info_requested').length
  // "This period" is the calendar month: what a monthly report asks for.
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const paidThisMonth = claims?.filter(
    (c) => c.status === 'paid' && c.assessed_at !== null && c.assessed_at >= monthStart,
  ).length

  const signals = buildSignals({
    overduesLate: seesOverdues ? (lateOverdues ?? 0) : null,
    escalatedLimits: canDecide ? (escalated ?? 0) : null,
    declarationsDisputed: seesDeclarations ? (compliance?.disputed ?? 0) : null,
    claimsAwaitingInfo: seesClaims ? (awaitingInfo ?? 0) : null,
    declarationsAwaiting: seesDeclarations ? (compliance?.awaitingAcceptance ?? 0) : null,
  })

  const count = (v: number | undefined) => (v === undefined ? EM_DASH : formatAmount(v, locale))

  return (
    <div className="flex flex-col gap-6">
      {/* Greeting */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold tracking-[0.14em] text-accent-500 uppercase">
            {formatLongDate(now, locale)}
          </div>
          <h1 className="mt-1 font-display text-[28px] leading-tight font-bold tracking-wide text-accent-600 uppercase">
            {t(`dashboard.greeting.${dayPart(now)}`)}
          </h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {roles.length ? roles.map((r) => t(`roles.${r}`)).join(' · ') : t('roles.unassigned')}
          </p>
        </div>
      </div>

      {/* One strip of key figures */}
      <Card className="overflow-hidden">
        <div className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:auto-cols-fr lg:grid-flow-col lg:divide-x">
          <Kpi
            to="/policies?view=registry"
            icon={FileText}
            label={t('dashboard.activePolicies')}
            value={count(activePolicies)}
          />
          <Kpi
            to="/entities"
            icon={Building2}
            label={t('dashboard.entities')}
            value={count(entities?.length)}
            sub={policyholders !== undefined ? t('dashboard.policyholdersSub', { count: policyholders }) : null}
          />
          {seesClaims && (
            <Kpi
              to="/claims"
              icon={FileWarning}
              label={t('dashboard.claimsOpen')}
              value={count(openClaims)}
              sub={paidThisMonth ? t('dashboard.paidSub', { count: paidThisMonth }) : null}
            />
          )}
          {seesOverdues && (
            <Kpi
              to="/overdues"
              icon={AlarmClock}
              label={t('dashboard.overduesOpen')}
              value={count(openOverdues?.length)}
              sub={lateOverdues ? t('dashboard.lateSub', { count: lateOverdues }) : null}
              subTone="neg"
            />
          )}
          {seesDeclarations && accrual && (
            <Kpi
              to="/declarations"
              icon={ClipboardList}
              label={t('dashboard.premiumEarned')}
              value={formatCompact(accrual.earned, locale, 1)}
              sub={
                accrual.minimum > 0
                  ? t('dashboard.premiumOfMinimum', {
                      pct: formatPercent(accrual.earned / accrual.minimum, locale, 0),
                    })
                  : null
              }
            >
              {accrual.minimum > 0 && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-accent-500"
                    style={{ width: `${Math.min(100, (accrual.earned / accrual.minimum) * 100)}%` }}
                  />
                </div>
              )}
            </Kpi>
          )}
        </div>
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        {/* The caller's own work, worst first */}
        {isStaff(roles) && (
          <Panel
            title={t('dashboard.needsAttention')}
            action={
              <Link
                to="/agenda"
                className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-600 hover:text-accent-500"
              >
                {t('dashboard.allTasks', { count: tasks.length })}
                <ArrowRight className="size-3.5" />
              </Link>
            }
          >
            {agenda.isLoading ? (
              <div className="flex flex-col gap-2 p-4">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : tasks.length === 0 ? (
              <AllClear text={t('dashboard.noTasks')} />
            ) : (
              <ul className="divide-y divide-slate-100">
                {shownTasks.map((task) => (
                  <TaskLine
                    key={task.id}
                    task={task}
                    subject={subjectFor(task, subjects.data)}
                    now={now}
                    locale={locale}
                  />
                ))}
                {tasks.length > TASKS_SHOWN && (
                  <li className="px-5 py-2.5 text-[12.5px] text-slate-500">
                    <Link to="/agenda" className="hover:text-accent-600">
                      {t('dashboard.tasksMore', { count: tasks.length - TASKS_SHOWN })}
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </Panel>
        )}

        {/* Everything else that is not zero */}
        <Panel title={t('dashboard.signals')}>
          {signals.length === 0 ? (
            <AllClear text={t('dashboard.noSignals')} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {signals.map((signal) => {
                const Icon = SIGNAL_ICONS[signal.key]
                return (
                  <li key={signal.key}>
                    <Link
                      to={signal.to}
                      className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-accent-50/60"
                    >
                      <span
                        className={`flex size-8 shrink-0 items-center justify-center rounded-md ${
                          signal.tone === 'neg'
                            ? 'bg-neg-50 text-neg-500'
                            : signal.tone === 'warn'
                              ? 'bg-warn-50 text-warn-500'
                              : 'bg-accent-50 text-accent-600'
                        }`}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="flex-1 text-[13.5px] text-slate-700">
                        {t(`dashboard.signalLabels.${signal.key}`)}
                      </span>
                      <span className="num font-display text-[20px] font-bold text-accent-600">
                        {formatAmount(signal.count, locale)}
                      </span>
                      <ChevronRight className="size-4 text-slate-300 group-hover:text-accent-500" />
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  )
}

function Kpi({
  to,
  icon: Icon,
  label,
  value,
  sub,
  subTone,
  children,
}: {
  to: string
  icon: LucideIcon
  label: string
  value: string
  sub?: string | null
  subTone?: 'neg'
  children?: ReactNode
}) {
  return (
    <Link to={to} className="group block px-5 py-4 transition-colors hover:bg-accent-50/50">
      <div className="flex items-start gap-2 text-[12.5px] leading-snug font-medium text-slate-500">
        <Icon className="mt-px size-4 shrink-0 text-accent-500" />
        <span>{label}</span>
      </div>
      <div className="num mt-1.5 text-left font-display text-[30px] leading-none font-bold text-accent-600 group-hover:text-accent-500">
        {value}
      </div>
      {sub && (
        <div className={`mt-1 text-[12px] ${subTone === 'neg' ? 'font-medium text-neg-500' : 'text-slate-500'}`}>
          {sub}
        </div>
      )}
      {children}
    </Link>
  )
}

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <h2 className="flex items-center gap-2 font-display text-[16px] font-bold tracking-wide text-accent-600 uppercase">
          <span aria-hidden="true" className="inline-block size-2 bg-accent-500" />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Card>
  )
}

function AllClear({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 px-5 py-6 text-[13.5px] text-slate-500">
      <CheckCircle2 className="size-5 shrink-0 text-pos-500" />
      {text}
    </div>
  )
}

const PRIORITY_DOT: Record<Task['priority'], string> = {
  urgent: 'bg-neg-500',
  high: 'bg-brand-orange',
  normal: 'bg-accent-300',
}

function TaskLine({
  task,
  subject,
  now,
  locale,
}: {
  task: Task
  subject: string | null
  now: Date
  locale: string
}) {
  const { t, i18n } = useTranslation()
  const href = taskLink(task)
  const overdue = isOverdue(task, now)
  const body = (
    <>
      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${overdue ? 'bg-neg-500' : PRIORITY_DOT[task.priority]}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-slate-800">
          {t(task.title_key, { ...formatTaskParams(task.params, i18n.language), subject: subject ?? EM_DASH })}
        </span>
        <span className="mt-0.5 flex flex-wrap gap-x-2 text-[12px] text-slate-500">
          <span>{t(`agenda.taskTypes.${task.task_type}`)}</span>
          {task.due_at && (
            <span className={overdue ? 'font-medium text-neg-500' : undefined}>
              · {t(overdue ? 'agenda.overdueSince' : 'agenda.dueBy', { moment: formatDue(task.due_at, locale) })}
            </span>
          )}
        </span>
      </span>
      {href && <ChevronRight className="mt-1 size-4 shrink-0 text-slate-300 group-hover:text-accent-500" />}
    </>
  )
  return (
    <li>
      {href ? (
        <Link to={href} className="group flex items-start gap-3 px-5 py-3 transition-colors hover:bg-accent-50/60">
          {body}
        </Link>
      ) : (
        <div className="flex items-start gap-3 px-5 py-3">{body}</div>
      )}
    </li>
  )
}
