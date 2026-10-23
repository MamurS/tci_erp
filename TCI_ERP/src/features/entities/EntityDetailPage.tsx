/** Entity card: merged buyer + policyholder cards. Financials/rating are
 * available for EVERY entity (prospect analysis); the Limits tab appears
 * when the entity is a buyer, Policies & portfolio when a policyholder. */

import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'

import { Badge, Button, CountryFlag, EmptyState, LinkButton, PageHeader, Spinner, Tabs } from '../../components/ui'
import { useEntity, useEntityRoles } from './api'
import { BuyerLimitsTab } from '../limits/BuyerLimitsTab'
import { RequestStatementsButton } from '../data/RequestStatementsButton'
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
import { formatAmount } from '../../lib/format'
import { rememberEntity } from '../../components/layout/recentEntities'
import { gradeTone } from '../../lib/grade'

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
  const activeTab: TabKey =
    requested && availableTabs.includes(requested) ? requested : 'overview'

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
      <PageHeader
        title={
          <>
            <CountryFlag code={entity.country_code} className="mr-2.5" />
            {entity.name}
          </>
        }
        // Beside the title, not inside the heading: `md` badges in the body
        // font, centred on the title (DESIGN.md «Badges»).
        status={
          <>
            <GradeHeaderBadge
              entityId={id}
              onClick={() => setSearchParams({ tab: 'rating' }, { replace: true })}
            />
            <RoleBadges roles={roles} />
          </>
        }
        subtitle={
          <span>
            <Link to="/entities" className="text-accent-700 hover:underline">
              {t('nav.entities')}
            </Link>
            {' / '}
            {entity.registration_number ?? t('entities.noRegNumber')}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <RequestStatementsButton entityId={entity.id} />
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              {t('common.edit')}
            </Button>
          </div>
        }
      />

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
function GradeHeaderBadge({ entityId, onClick }: { entityId: string; onClick: () => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data } = useQuery({
    queryKey: ['entities', entityId, 'latest-grade'],
    queryFn: async (): Promise<{ rating_grade: string; rating_score: number } | null> => {
      const { data: rows, error } = await tci()
        .from('credit_assessments')
        .select('rating_grade, rating_score')
        .eq('entity_id', entityId)
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw error
      return (rows?.[0] as { rating_grade: string; rating_score: number } | undefined) ?? null
    },
  })

  if (!data) return null
  return (
    <button type="button" onClick={onClick} title={t('rating.gradeTitle')} className="inline-flex rounded-full">
      <Badge tone={gradeTone(data.rating_grade)}>
        {data.rating_grade} · {formatAmount(Number(data.rating_score), locale, 0)}
      </Badge>
    </button>
  )
}
