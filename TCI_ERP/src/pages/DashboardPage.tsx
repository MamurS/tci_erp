import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { Card, PageHeader } from '../components/ui'
import { useDeclarations } from '../features/declarations/api'
import { declarationCompliance, premiumAccrual } from '../features/declarations/summary'
import { useEntities, useEntityRoles } from '../features/entities/api'
import { useClaims } from '../features/claims'
import { isOpen as claimIsOpen } from '../features/claims/machine'
import { useOverdueNotifications } from '../features/overdue/api'
import { usePolicies } from '../features/policies/api'
import { useAllPolicyPremium } from '../features/policies/premiumApi'
import { hasRole } from '../lib/roles'
import { EM_DASH, formatAmount } from '../lib/format'

export function DashboardPage() {
  const { t, i18n } = useTranslation()
  const { session, roles } = useAuth()
  const { data: policies } = usePolicies()
  const { data: entities } = useEntities()
  const entityRoles = useEntityRoles()

  // Phase 4 summaries, shown to the roles that act on them: commercial
  // underwriting accepts declarations and bills premium, sales chases the
  // periods, credit underwriting works the overdue queue. A claims-only user
  // sees neither, because neither is theirs to move.
  const seesDeclarations = hasRole(roles, 'admin', 'sales', 'commercial_underwriter')
  const seesOverdues = hasRole(roles, 'admin', 'credit_underwriter', 'commercial_underwriter')
  // Phase 5. Claims belongs to the claims department; credit and commercial
  // underwriting read it because an approved claim moves a limit and consumes
  // the policy's maximum liability.
  const seesClaims = hasRole(roles, 'admin', 'claims', 'credit_underwriter', 'commercial_underwriter')
  const { data: declarations } = useDeclarations()
  const { data: overdues } = useOverdueNotifications()
  const { data: policyPremium } = useAllPolicyPremium()
  const { data: claims } = useClaims()

  const activePolicies = policies?.filter((p) => p.status === 'active').length
  const policyholders = entityRoles.data
    ? [...entityRoles.data.values()].filter((r) => r.is_policyholder).length
    : undefined
  const stats: { key: string; label: string; value: number | undefined; to: string }[] = [
    {
      key: 'active-policies',
      label: t('dashboard.activePolicies'),
      value: activePolicies,
      to: '/policies',
    },
    {
      key: 'policyholders',
      label: t('dashboard.policyholders'),
      value: policyholders,
      to: '/entities',
    },
    {
      key: 'entities',
      label: t('dashboard.entities'),
      value: entities?.length,
      to: '/entities',
    },
  ]

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

  return (
    <div>
      <PageHeader title={t('nav.dashboard')} />
      <div className="mb-5 grid gap-4 sm:grid-cols-3 lg:max-w-3xl">
        {stats.map((stat) => (
          <Link key={stat.key} to={stat.to}>
            <Card className="p-4 transition-colors hover:bg-slate-50">
              <p className="text-xs text-slate-500">{stat.label}</p>
              <p className="mt-1">
                <span className="num text-2xl font-semibold text-slate-900">
                  {stat.value ?? EM_DASH}
                </span>
              </p>
            </Card>
          </Link>
        ))}
      </div>
      {(seesDeclarations || seesOverdues || seesClaims) && (
        <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:max-w-3xl lg:grid-cols-4">
          {seesDeclarations && (
            <>
              <Link to="/declarations">
                <Card className="p-4 transition-colors hover:bg-slate-50">
                  <p className="text-xs text-slate-500">{t('dashboard.declarationsAwaiting')}</p>
                  <p className="num mt-1 text-2xl font-semibold text-slate-900">
                    {compliance?.awaitingAcceptance ?? EM_DASH}
                  </p>
                </Card>
              </Link>
              <Link to="/declarations">
                <Card
                  className={`p-4 transition-colors hover:bg-slate-50 ${
                    compliance?.disputed ? 'border-warn-500/40 bg-warn-50' : ''
                  }`}
                >
                  <p className="text-xs text-slate-500">{t('dashboard.declarationsDisputed')}</p>
                  <p className="num mt-1 text-2xl font-semibold text-slate-900">
                    {compliance?.disputed ?? EM_DASH}
                  </p>
                </Card>
              </Link>
            </>
          )}
          {seesClaims && (
            <>
              <Link to="/claims">
                <Card className="p-4 transition-colors hover:bg-slate-50">
                  <p className="text-xs text-slate-500">{t('dashboard.claimsOpen')}</p>
                  <p className="num mt-1 text-2xl font-semibold text-slate-900">
                    {openClaims ?? EM_DASH}
                  </p>
                </Card>
              </Link>
              <Link to="/claims">
                <Card
                  className={`p-4 transition-colors hover:bg-slate-50 ${
                    awaitingInfo ? 'border-warn-500/40 bg-warn-50' : ''
                  }`}
                >
                  <p className="text-xs text-slate-500">{t('dashboard.claimsAwaitingInfo')}</p>
                  <p className="num mt-1 text-2xl font-semibold text-slate-900">
                    {awaitingInfo ?? EM_DASH}
                  </p>
                </Card>
              </Link>
              <Link to="/claims">
                <Card className="p-4 transition-colors hover:bg-slate-50">
                  <p className="text-xs text-slate-500">{t('dashboard.claimsPaidThisPeriod')}</p>
                  <p className="num mt-1 text-2xl font-semibold text-slate-900">
                    {paidThisPeriod ?? EM_DASH}
                  </p>
                </Card>
              </Link>
            </>
          )}
          {seesOverdues && (
            <>
              <Link to="/overdues">
                <Card className="p-4 transition-colors hover:bg-slate-50">
                  <p className="text-xs text-slate-500">{t('dashboard.overduesOpen')}</p>
                  <p className="num mt-1 text-2xl font-semibold text-slate-900">
                    {openOverdues?.length ?? EM_DASH}
                  </p>
                </Card>
              </Link>
              <Link to="/overdues">
                <Card
                  className={`p-4 transition-colors hover:bg-slate-50 ${
                    lateOverdues ? 'border-neg-500/40 bg-neg-50' : ''
                  }`}
                >
                  <p className="text-xs text-slate-500">{t('dashboard.overduesLate')}</p>
                  <p className="num mt-1 text-2xl font-semibold text-slate-900">
                    {lateOverdues ?? EM_DASH}
                  </p>
                </Card>
              </Link>
            </>
          )}
        </div>
      )}

      {seesDeclarations && accrual && (
        <Card className="mb-5 p-5 lg:max-w-3xl">
          <p className="text-sm font-semibold text-slate-800">{t('dashboard.premiumAccrual')}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-slate-500">{t('premium.fields.earnedPremium')}</p>
              <p className="num mt-1 font-semibold">{formatAmount(accrual.earned, locale)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">{t('premium.fields.minimumPremium')}</p>
              <p className="num mt-1 font-semibold">{formatAmount(accrual.minimum, locale)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">{t('premium.fields.adjustment')}</p>
              <p className="num mt-1 font-semibold">{formatAmount(accrual.adjustment, locale)}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">{t('dashboard.premiumAccrualHint')}</p>
        </Card>
      )}

      <Card className="p-5">
        <p className="text-sm font-medium text-slate-800">
          {t('dashboard.welcome', { email: session?.user.email })}
        </p>
        <p className="mt-1 text-[13px] text-slate-500">
          {t('dashboard.roleLabel')}:{' '}
          {roles.length ? roles.map((r) => t(`roles.${r}`)).join(' · ') : t('roles.unassigned')}
        </p>
      </Card>
    </div>
  )
}
