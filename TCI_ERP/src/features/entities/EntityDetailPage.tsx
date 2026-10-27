/** Entity card: merged buyer + policyholder cards. Financials/rating are
 * available for EVERY entity (prospect analysis); the Limits tab appears
 * when the entity is a buyer, Policies & portfolio when a policyholder. */

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { Info } from 'lucide-react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'

import {
  BadgeSizeContext,
  Button,
  CountryFlag,
  DescriptionList,
  EmptyState,
  GradeBadge,
  gradeSolid,
  HeroBand,
  HumanAmount,
  KpiCard,
  LinkButton,
  SidePanel,
  Spinner,
  Tabs,
} from '../../components/ui'
import type { Fact } from '../../components/ui'
import { useEntity, useEntityRoles } from './api'
import type { EntityWithRefs } from './types'
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
import { OPEN_STATUSES } from '../limits/machine'
import { isOpen as isClaimOpen } from '../claims/machine'
import { isTerminal } from '../requests/machine'
import { CardStickyBar } from './CardStickyBar'
import { firstTabOf, SECTION_OF, sectionsFor } from './cardTabs'
import type { CardTab } from './cardTabs'
import { rememberEntity } from '../../components/layout/recentEntities'
import { CountryRiskBadges, IndustrySectorBadge } from '../risk/badges'
import { CountryWithRisk, IndustryWithSector } from '../risk/integrationBadges'

type TabKey = CardTab

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
  const [factsOpen, setFactsOpen] = useState(false)

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
  const sections = sectionsFor(availableTabs)
  // The sticky bar's height, for the rows that stick under it (financials).
  const [stickyHeight, setStickyHeight] = useState(0)
  const activeSection = sections.find((s) => s.section === SECTION_OF[activeTab])

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
    <div style={{ '--card-sticky-h': `${stickyHeight}px` } as CSSProperties}>
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
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tabular-nums">{entity.registration_number ?? t('entities.noRegNumber')}</span>
            {/* Prompt 31: the sector grade beside the industry, the country's
                category and any sanctions flag (staff only). */}
            <IndustrySectorBadge industryCode={entity.industry_id} />
            <CountryRiskBadges countryCode={entity.country_code} entityId={entity.id} />
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setFactsOpen(true)}>
              <Info aria-hidden />
              {t('entities.facts.open')}
            </Button>
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
          onTab={(tab) => setSearchParams({ tab }, { replace: true })}
          submissions={submissions}
        />
      </HeroBand>

      {/* Sections on top, the tabs of the active one under it (cardTabs.ts).
          The sections stick, with the company's name above them once the
          hero has scrolled away (CardStickyBar). */}
      <CardStickyBar
        onHeight={setStickyHeight}
        name={
          <>
            <CountryFlag code={entity.country_code} />
            <span className="min-w-0 truncate font-display text-title leading-tight font-bold">{entity.name}</span>
            <GradeHeaderBadge
              entityId={id}
              onClick={() => setSearchParams({ tab: 'rating' }, { replace: true })}
            />
          </>
        }
      >
        <Tabs
          tabs={sections.map(({ section }) => ({ key: section, label: t(`entities.sections.${section}`) }))}
          active={SECTION_OF[activeTab]}
          onChange={(section) => {
            const tab = firstTabOf(section as (typeof sections)[number]['section'], availableTabs)
            if (tab) setSearchParams({ tab }, { replace: true })
          }}
        />
      </CardStickyBar>
      {activeSection && activeSection.tabs.length > 1 && (
        // The tabs of the active section: tabs (not a view switch) — each is
        // its own content and its own URL.
        <div
          role="tablist"
          aria-label={t(`entities.sections.${activeSection.section}`)}
          className="mt-4 inline-flex rounded-md border border-slate-200 bg-slate-100/70 p-0.5"
        >
          {activeSection.tabs.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={key === activeTab}
              onClick={() => setSearchParams({ tab: key }, { replace: true })}
              className={`rounded-[5px] px-3 py-1 text-small font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:outline-none ${
                key === activeTab ? 'bg-white text-accent-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t(`entities.tabs.${key}`)}
            </button>
          ))}
        </div>
      )}

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
      <SidePanel
        open={factsOpen}
        title={entity.name}
        meta={<RoleBadges roles={roles} />}
        onClose={() => setFactsOpen(false)}
      >
        <EntityFacts entity={entity} />
      </SidePanel>
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
  onTab,
  submissions,
}: {
  entity: { id: string; financial_statements: { period_end_date: string }[] }
  isBuyer: boolean
  onTab: (tab: CardTab) => void
  submissions: { request: { status: Parameters<typeof isTerminal>[0] } }[] | undefined
}) {
  const onRating = () => onTab('rating')
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
      <OpenWorkFigure entityId={entity.id} isBuyer={isBuyer} submissions={submissions} onTab={onTab} />
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

/** What is open on this company right now (Prompt 30: the header as a
 * summary — grade, exposure, OPEN ITEMS): limit requests (a buyer), live
 * submissions and open claims, each a way to its tab. */
function OpenWorkFigure({
  entityId,
  isBuyer,
  submissions,
  onTab,
}: {
  entityId: string
  isBuyer: boolean
  submissions: { request: { status: Parameters<typeof isTerminal>[0] } }[] | undefined
  onTab: (tab: CardTab) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const limits = useQuery({
    queryKey: ['entities', entityId, 'open-limit-requests'],
    enabled: isBuyer,
    queryFn: async (): Promise<number> => {
      const { data, error } = await tci()
        .from('credit_limit_requests')
        .select('id, status')
        .eq('entity_id', entityId)
        .in('status', [...OPEN_STATUSES])
      if (error) throw error
      return (data ?? []).length
    },
  })
  const claims = useQuery({
    queryKey: ['entities', entityId, 'open-claims'],
    enabled: isBuyer,
    queryFn: async (): Promise<{ status: Parameters<typeof isClaimOpen>[0] }[]> => {
      const { data, error } = await tci().from('v_claims').select('id, status').eq('buyer_entity_id', entityId)
      if (error) throw error
      return (data ?? []) as { status: Parameters<typeof isClaimOpen>[0] }[]
    },
  })
  const openLimits = isBuyer ? (limits.data ?? null) : 0
  const openSubmissions = submissions ? submissions.filter((s) => !isTerminal(s.request.status)).length : null
  const openClaims = isBuyer
    ? claims.data
      ? claims.data.filter((c) => isClaimOpen(c.status)).length
      : null
    : 0
  const parts: { tab: CardTab; label: string }[] = [
    ...(openLimits ? [{ tab: 'limits' as const, label: t('entities.hero.openLimits', { count: openLimits }) }] : []),
    ...(openSubmissions
      ? [{ tab: 'requests' as const, label: t('entities.hero.openSubmissions', { count: openSubmissions }) }]
      : []),
    ...(openClaims ? [{ tab: 'claims' as const, label: t('entities.hero.openClaims', { count: openClaims }) }] : []),
  ]
  const known = openLimits !== null && openSubmissions !== null && openClaims !== null
  const total = (openLimits ?? 0) + (openSubmissions ?? 0) + (openClaims ?? 0)
  return (
    <KpiCard
      tone="inverse"
      label={t('entities.hero.openWork')}
      value={known ? formatAmount(total, locale, 0) : EM_DASH}
      meta={
        parts.length ? (
          <span className="flex flex-wrap gap-x-2">
            {parts.map((part, i) => (
              <span key={part.tab}>
                <button type="button" onClick={() => onTab(part.tab)} className="underline-offset-2 hover:underline">
                  {part.label}
                </button>
                {i < parts.length - 1 && ' ·'}
              </span>
            ))}
          </span>
        ) : known ? (
          t('entities.hero.nothingOpen')
        ) : undefined
      }
    />
  )
}

/** The company's particulars at a glance, beside whatever tab is open. */
function EntityFacts({ entity }: { entity: EntityWithRefs }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const lang = (i18n.resolvedLanguage ?? 'ru') as 'en' | 'ru' | 'uz'
  const name = (ref: { name_en: string; name_ru: string; name_uz: string } | null) =>
    ref ? (ref[`name_${lang}`] ?? ref.name_en) : EM_DASH
  const or = (v: string | null) => (v && v.trim() ? v : EM_DASH)
  const items: Fact[] = [
    { label: t('buyers.fields.legalForm'), value: or(entity.legal_form) },
    {
      label: t('buyers.fields.country'),
      value: <CountryWithRisk name={name(entity.countries)} countryCode={entity.country_code} entityId={entity.id} />,
    },
    {
      label: t('buyers.fields.industry'),
      value: <IndustryWithSector name={name(entity.industries)} industryCode={entity.industry_id} />,
    },
    { label: t('buyers.fields.registrationNumber'), value: or(entity.registration_number) },
    { label: t('buyers.fields.foundedDate'), value: entity.founded_date ? formatDate(entity.founded_date, locale) : EM_DASH },
    {
      label: t('buyers.fields.website'),
      value: entity.website ? (
        <a href={entity.website} target="_blank" rel="noreferrer" className="text-accent-700 hover:underline">
          {entity.website.replace(/^https?:\/\//, '')}
        </a>
      ) : (
        EM_DASH
      ),
    },
    { label: t('policyholders.fields.address'), value: <span className="whitespace-normal">{or(entity.address)}</span> },
    { label: t('policyholders.fields.contactPerson'), value: or(entity.contact_person) },
    { label: t('policyholders.fields.contactPhone'), value: or(entity.contact_phone) },
    { label: t('policyholders.fields.contactEmail'), value: or(entity.contact_email) },
  ]
  return (
    <div className="flex flex-col gap-5">
      <DescriptionList items={items} />
      {entity.notes && (
        <div>
          <p className="mb-1 text-small font-medium text-slate-600">{t('buyers.fields.notes')}</p>
          <p className="text-small whitespace-pre-line text-slate-700">{entity.notes}</p>
        </div>
      )}
    </div>
  )
}
