/** Entity card: merged buyer + policyholder cards. Financials/rating are
 * available for EVERY entity (prospect analysis); the Limits tab appears
 * when the entity is a buyer, Policies & portfolio when a policyholder. */

import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'

import {
  BadgeSizeContext,
  Button,
  CountryFlag,
  EmptyState,
  GradeBadge,
  gradeSolid,
  HeroBand,
  HumanAmount,
  KpiCard,
  LinkButton,
  Spinner,
  Tabs,
} from '../../components/ui'
import { useEntity, useEntityRoles } from './api'
import { BuyerLimitsTab } from '../limits/BuyerLimitsTab'
import { RequestStatementsButton } from '../data/RequestStatementsButton'
import { mayWriteEntities } from './access'
import { EntityFormModal } from './EntityFormModal'
import { RoleBadges } from './EntitiesPage'
import { FinancialsTab } from './financials/FinancialsTab'
import { OverviewTab } from './overview/OverviewTab'
import { PoliciesTab } from './PoliciesTab'
import { EntityRequestsSection } from '../requests'
import { EntityOffersList } from '../offers/EntityOffersList'
import { ClaimsSection } from '../claims'
import { GroupTab } from '../groups'
import { useRequestsForEntity } from '../requests/api'
import { EntityClientAccessSection } from '../admin'
import { useAuth } from '../../auth/AuthContext'
import { hasRole } from '../../lib/roles'
import { RatingTab } from './rating/RatingTab'
import { EM_DASH, formatAmount, formatDate } from '../../lib/format'
import { useBuyerExposure } from '../limits/api'
import { rememberEntity } from '../../components/layout/recentEntities'

type TabKey =
  | 'overview'
  | 'financials'
  | 'rating'
  | 'limits'
  | 'policies'
  | 'requests'
  | 'claims'
  | 'group'
  | 'access'

export function EntityDetailPage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()

  const { data: entity, isLoading } = useEntity(id)
  const rolesMap = useEntityRoles()
  const roles = rolesMap.data?.get(id)
  const { roles: callerRoles } = useAuth()
  const { data: submissions } = useRequestsForEntity(id)
  const [editOpen, setEditOpen] = useState(false)

  // Client access is offered where sales actually work, but only once the
  // company is someone we would give a portal login to: a policyholder, or
  // an applicant with a submission in flight.
  const mayProvision = hasRole(callerRoles, 'admin', 'sales', 'commercial_underwriter')
  const hasOwnSubmission = (submissions ?? []).some((row) => row.asApplicant)
  const showClientAccess = mayProvision && (roles?.is_policyholder === true || hasOwnSubmission)

  const availableTabs: TabKey[] = [
    'overview',
    'financials',
    'rating',
    ...(roles?.is_buyer ? (['limits'] as const) : []),
    ...(roles?.is_policyholder ? (['policies'] as const) : []),
    // Submissions are relevant to every company: as applicant or as a
    // buyer inside someone else's package.
    'requests',
    // Claims hang off the buyer: this is the company that did not pay.
    ...(roles?.is_buyer ? (['claims'] as const) : []),
    // The group is a property of the company itself, not of a role it plays:
    // a policyholder's parent matters as much as a buyer's.
    'group',
    ...(showClientAccess ? (['access'] as const) : []),
  ]

  // The command palette offers the companies opened last.
  useEffect(() => {
    if (!entity) return
    rememberEntity({
      id: entity.id,
      name: entity.name,
      sub: [entity.registration_number, entity.country_code].filter(Boolean).join(' · '),
    })
  }, [entity])

  const requested = searchParams.get('tab') as TabKey | null
  const activeTab: TabKey = requested && availableTabs.includes(requested) ? requested : 'overview'

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!entity) {
    return (
      <EmptyState
        title={t('entities.notFound')}
        action={
          <LinkButton variant="secondary" to="/entities">
            {t('entities.backToList')}
          </LinkButton>
        }
      />
    )
  }

  return (
    <div>
      <HeroBand
        eyebrow={
          <Link to="/entities" className="hover:text-white">
            {t('nav.entities')}
          </Link>
        }
        title={
          <span className="inline-flex items-center">
            <CountryFlag code={entity.country_code} className="mr-3" />
            {entity.name}
          </span>
        }
        // Beside the title, not inside the heading: `md` badges in the body
        // font, centred on the title (DESIGN.md «Badges»).
        status={
          <BadgeSizeContext.Provider value="md">
            <GradeHeaderBadge
              entityId={id}
              onClick={() => setSearchParams({ tab: 'rating' }, { replace: true })}
            />
            <RoleBadges roles={roles} />
          </BadgeSizeContext.Provider>
        }
        subtitle={
          <span className="tabular-nums">
            {entity.registration_number ?? t('entities.noRegNumber')}
          </span>
        }
        actions={
          <>
            <RequestStatementsButton entityId={entity.id} />
            {mayWriteEntities(callerRoles) && (
              <Button variant="secondary" onClick={() => setEditOpen(true)}>
                {t('common.edit')}
              </Button>
            )}
          </>
        }
      >
        <EntityHeroFigures
          entity={entity}
          isBuyer={roles?.is_buyer === true}
          onRating={() => setSearchParams({ tab: 'rating' }, { replace: true })}
        />
      </HeroBand>

      <Tabs
        tabs={availableTabs.map((key) => ({ key, label: t(`entities.tabs.${key}`) }))}
        active={activeTab}
        onChange={(key) => setSearchParams({ tab: key }, { replace: true })}
      />

      <div className="mt-5">
        {activeTab === 'overview' && (
          <OverviewTab entityId={id} isPolicyholder={roles?.is_policyholder ?? false} />
        )}
        {activeTab === 'financials' && <FinancialsTab entityId={id} />}
        {activeTab === 'rating' && <RatingTab entityId={id} />}
        {activeTab === 'limits' && <BuyerLimitsTab entityId={id} />}
        {activeTab === 'policies' && <PoliciesTab entityId={id} />}
        {activeTab === 'requests' && (
          <div className="flex flex-col gap-5">
            <EntityRequestsSection entityId={id} />
            <EntityOffersList entityId={id} />
          </div>
        )}
        {activeTab === 'claims' && <ClaimsSection entityId={id} />}
        {activeTab === 'group' && <GroupTab entityId={id} entityName={entity.name} />}
        {activeTab === 'access' && <EntityClientAccessSection entityId={id} />}
      </div>

      <EntityFormModal open={editOpen} onClose={() => setEditOpen(false)} initial={entity} />
    </div>
  )
}

/** Latest assessment grade, always visible in the header (legacy "Grade: 4"). */
/** The buyer's latest rating (grade in force and score). */
function useLatestGrade(entityId: string) {
  return useQuery({
    queryKey: ['entities', entityId, 'latest-grade'],
    queryFn: async (): Promise<{ rating_grade: string; rating_score: number | null } | null> => {
      const { data: rows, error } = await tci()
        .from('credit_assessments')
        .select('rating_grade, rating_score')
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw error
      return (
        (rows?.[0] as { rating_grade: string; rating_score: number | null } | undefined) ?? null
      )
    },
  })
}

/** The company's key figures on the band: its grade in the grade's own
 * colour, what we cover on it (a buyer), and how fresh its accounts are. */
function EntityHeroFigures({
  entity,
  isBuyer,
  onRating,
}: {
  entity: { id: string; financial_statements: { period_end_date: string }[] }
  isBuyer: boolean
  onRating: () => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const grade = useLatestGrade(entity.id)
  const exposure = useBuyerExposure(isBuyer ? entity.id : '')
  const periods = entity.financial_statements.map((p) => p.period_end_date).sort()
  const latest = periods.at(-1) ?? null
  const g = grade.data
  return (
    <>
      <KpiCard
        tone="inverse"
        ribbon={g ? gradeSolid(g.rating_grade) : undefined}
        label={t('entities.hero.grade')}
        value={g?.rating_grade ?? EM_DASH}
        unit={
          g && g.rating_score !== null
            ? t('entities.hero.score', { score: formatAmount(Number(g.rating_score), locale, 0) })
            : undefined
        }
        meta={
          g ? (
            <button type="button" onClick={onRating} className="underline-offset-2 hover:underline">
              {t('entities.hero.toRating')}
            </button>
          ) : (
            t('entities.hero.notRated')
          )
        }
      />
      {isBuyer && (
        <KpiCard
          tone="inverse"
          label={t('entities.hero.exposure')}
          value={
            exposure.data?.exposure_uzs != null ? (
              <HumanAmount value={Number(exposure.data.exposure_uzs)} decimals={1} />
            ) : (
              EM_DASH
            )
          }
          unit={exposure.data?.exposure_uzs != null ? 'UZS' : undefined}
          meta={
            exposure.data
              ? t('entities.hero.exposurePolicies', { count: exposure.data.policies_count })
              : t('entities.hero.noExposure')
          }
        />
      )}
      <KpiCard
        tone="inverse"
        label={t('entities.hero.statements')}
        value={latest ? formatDate(latest, locale) : EM_DASH}
        meta={
          periods.length
            ? t('entities.hero.periods', { count: periods.length })
            : t('entities.hero.noStatements')
        }
      />
    </>
  )
}

function GradeHeaderBadge({ entityId, onClick }: { entityId: string; onClick: () => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data } = useLatestGrade(entityId)

  if (!data) return null
  return (
    <button
      type="button"
      onClick={onClick}
      title={t('rating.gradeTitle')}
      className="inline-flex rounded-full"
    >
      <GradeBadge grade={data.rating_grade}>
        {/* a manual grade (0073) has no score */}
        {data.rating_score === null
          ? data.rating_grade
          : `${data.rating_grade} · ${formatAmount(Number(data.rating_score), locale, 0)}`}
      </GradeBadge>
    </button>
  )
}
