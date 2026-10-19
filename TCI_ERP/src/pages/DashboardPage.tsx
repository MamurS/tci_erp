import type { ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  AlarmClock,
  ArrowRight,
  Banknote,
  Building2,
  CircleAlert,
  ClipboardCheck,
  ClipboardList,
  FileText,
  FileWarning,
  Hourglass,
  Scale,
  Users,
} from 'lucide-react'

import { useAuth } from '../auth/AuthContext'
import { Card, SectionTitle, StatCard } from '../components/ui'
import { useAgendaTasks } from '../features/agenda/api'
import { agendaCounts } from '../features/agenda/catalogue'
import { useDeclarations } from '../features/declarations/api'
import { declarationCompliance, premiumAccrual } from '../features/declarations/summary'
import { useEntities, useEntityRoles } from '../features/entities/api'
import { useClaims } from '../features/claims'
import { isOpen as claimIsOpen } from '../features/claims/machine'
import { useOverdueNotifications } from '../features/overdue/api'
import { usePolicies } from '../features/policies/api'
import { useAllPolicyPremium } from '../features/policies/premiumApi'
import { hasRole, isStaff } from '../lib/roles'
import { EM_DASH, formatAmount, formatLongDate } from '../lib/format'

export function DashboardPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { session, roles } = useAuth()
  const { data: policies } = usePolicies()
  const { data: entities } = useEntities()
  const entityRoles = useEntityRoles()
  const { data: agendaTasks } = useAgendaTasks({ enabled: isStaff(roles) })

  // Phase 4 summaries, shown to the roles that act on them: commercial
  // underwriting accepts declarations and bills premium, sales chases the
  // periods, credit underwriting works the overdue queue. A claims-only user
  // sees neither, because neither is theirs to move.
  const seesDeclarations = hasRole(roles, 'admin', 'sales', 'commercial_underwriter')
  const seesOverdues = hasRole(roles, 'admin', 'credit_underwriter', 'commercial_underwriter')
  // Phase 5. Claims belongs to the claims department; credit and commercial
  // underwriting read it because an approved claim moves a limit and consumes
  // the policy's maximum liability.
  const seesClaims = hasRole(
    roles,
    'admin',
    'claims',
    'credit_underwriter',
    'commercial_underwriter',
  )
  const { data: declarations } = useDeclarations()
  const { data: overdues } = useOverdueNotifications()
  const { data: policyPremium } = useAllPolicyPremium()
  const { data: claims } = useClaims()

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
  // "This period" is the calendar month: it is what a monthly report asks for
  // and what the policy's own declaration frequency defaults to.
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
  const paidThisPeriod = claims?.filter(
    (c) => c.status === 'paid' && c.assessed_at !== null && c.assessed_at >= monthStart,
  ).length
  const locale = i18n.language
  const agenda = agendaCounts(agendaTasks ?? [], new Date())
  const value = (v: number | undefined) => (v === undefined ? EM_DASH : formatAmount(v, locale))

  return (
    <div className="flex flex-col gap-7">
      {/* Hero: who you are, what is waiting */}
      <section className="relative overflow-hidden rounded-xl bg-gradient-to-br from-accent-600 via-accent-700 to-accent-800 px-6 py-6 text-white shadow-card sm:px-8">
        <HeroPixels />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold tracking-[0.16em] text-accent-200 uppercase">
              {formatLongDate(new Date(), locale)}
            </div>
            <h1 className="mt-1 font-display text-[28px] leading-tight font-bold tracking-wide uppercase">
              {t('nav.dashboard')}
            </h1>
            <p className="mt-1 text-[14px] text-white/80">
              {t('dashboard.welcome', { email: session?.user.email })}
            </p>
            <p className="mt-0.5 text-[12.5px] text-white/55">
              {t('dashboard.roleLabel')}:{' '}
              {roles.length ? roles.map((r) => t(`roles.${r}`)).join(' · ') : t('roles.unassigned')}
            </p>
          </div>
          {isStaff(roles) && (
            <Link
              to="/agenda"
              className="group flex min-w-[240px] items-center gap-4 rounded-lg bg-white/10 px-4 py-3 ring-1 ring-white/15 backdrop-blur transition-colors hover:bg-white/15"
            >
              <span className="font-display text-[40px] leading-none font-bold">{agenda.open}</span>
              <span className="flex flex-col">
                <span className="text-[13px] font-semibold">
                  {agenda.open ? t('dashboard.agendaOpen') : t('dashboard.allClear')}
                </span>
                {agenda.overdue > 0 && (
                  <span className="text-[12px] font-semibold text-brand-amber">
                    {t('dashboard.agendaOverdue', { count: agenda.overdue })}
                  </span>
                )}
                <span className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-white/70 group-hover:text-white">
                  {t('dashboard.openAgenda')}
                  <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
              </span>
            </Link>
          )}
        </div>
      </section>

      <DashboardSection title={t('nav.groups.portfolio')}>
        <StatCard
          label={t('dashboard.activePolicies')}
          value={value(activePolicies)}
          icon={<FileText />}
          onClick={() => navigate('/policies')}
        />
        <StatCard
          label={t('dashboard.policyholders')}
          value={value(policyholders)}
          icon={<Users />}
          onClick={() => navigate('/entities')}
        />
        <StatCard
          label={t('dashboard.entities')}
          value={value(entities?.length)}
          icon={<Building2 />}
          onClick={() => navigate('/entities')}
        />
      </DashboardSection>

      {seesDeclarations && (
        <DashboardSection title={t('nav.declarations')}>
          <StatCard
            label={t('dashboard.declarationsAwaiting')}
            value={value(compliance?.awaitingAcceptance)}
            icon={<ClipboardCheck />}
            onClick={() => navigate('/declarations')}
          />
          <StatCard
            label={t('dashboard.declarationsDisputed')}
            value={value(compliance?.disputed)}
            icon={<Scale />}
            tone={compliance?.disputed ? 'warn' : 'default'}
            onClick={() => navigate('/declarations')}
          />
        </DashboardSection>
      )}

      {seesClaims && (
        <DashboardSection title={t('nav.claims')}>
          <StatCard
            label={t('dashboard.claimsOpen')}
            value={value(openClaims)}
            icon={<FileWarning />}
            onClick={() => navigate('/claims')}
          />
          <StatCard
            label={t('dashboard.claimsAwaitingInfo')}
            value={value(awaitingInfo)}
            icon={<Hourglass />}
            tone={awaitingInfo ? 'warn' : 'default'}
            onClick={() => navigate('/claims')}
          />
          <StatCard
            label={t('dashboard.claimsPaidThisPeriod')}
            value={value(paidThisPeriod)}
            icon={<Banknote />}
            tone={paidThisPeriod ? 'pos' : 'default'}
            onClick={() => navigate('/claims')}
          />
        </DashboardSection>
      )}

      {seesOverdues && (
        <DashboardSection title={t('nav.overdues')}>
          <StatCard
            label={t('dashboard.overduesOpen')}
            value={value(openOverdues?.length)}
            icon={<AlarmClock />}
            onClick={() => navigate('/overdues')}
          />
          <StatCard
            label={t('dashboard.overduesLate')}
            value={value(lateOverdues)}
            icon={<CircleAlert />}
            tone={lateOverdues ? 'neg' : 'default'}
            onClick={() => navigate('/overdues')}
          />
        </DashboardSection>
      )}

      {seesDeclarations && accrual && (
        <section className="flex flex-col gap-3">
          <SectionTitle rule>{t('dashboard.premiumAccrual')}</SectionTitle>
          <Card className="p-5">
            <div className="grid gap-5 sm:grid-cols-3">
              <PremiumFigure
                icon={<ClipboardList className="size-4" />}
                label={t('premium.fields.earnedPremium')}
                value={formatAmount(accrual.earned, locale)}
              />
              <PremiumFigure
                label={t('premium.fields.minimumPremium')}
                value={formatAmount(accrual.minimum, locale)}
              />
              <PremiumFigure
                label={t('premium.fields.adjustment')}
                value={formatAmount(accrual.adjustment, locale)}
              />
            </div>
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
              {t('dashboard.premiumAccrualHint')}
            </p>
          </Card>
        </section>
      )}
    </div>
  )
}

function DashboardSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionTitle rule>{title}</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{children}</div>
    </section>
  )
}

function PremiumFigure({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[12px] font-medium text-slate-500">
        {icon && <span className="text-accent-500">{icon}</span>}
        {label}
      </p>
      <p className="num mt-1 font-display text-[24px] leading-none font-bold text-accent-600">
        {value}
      </p>
    </div>
  )
}

/** The brand's pixel motif, top-right of the hero (decorative). */
function HeroPixels() {
  const cells: [number, number, number][] = [
    [0, 0, 0.55],
    [1, 0, 0.25],
    [2, 0, 0.4],
    [3, 0, 0.15],
    [1, 1, 0.45],
    [2, 1, 0.2],
    [3, 1, 0.35],
    [2, 2, 0.3],
    [3, 2, 0.12],
    [3, 3, 0.25],
  ]
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 4 4"
      className="pointer-events-none absolute top-0 right-0 h-14 w-14 text-accent-300 opacity-70"
    >
      {cells.map(([x, y, o]) => (
        <rect
          key={`${x}-${y}`}
          x={x + 0.06}
          y={y + 0.06}
          width={0.88}
          height={0.88}
          fill="currentColor"
          opacity={o}
        />
      ))}
    </svg>
  )
}
