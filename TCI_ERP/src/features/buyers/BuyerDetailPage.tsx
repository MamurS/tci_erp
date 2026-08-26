import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'

import { Badge, EmptyState, PageHeader, Spinner, Tabs } from '../../components/ui'
import { useBuyer } from './api'
import { countryFlag } from '../../lib/countryFlag'
import { BuyerLimitsTab } from '../limits/BuyerLimitsTab'
import { FinancialsTab } from './financials/FinancialsTab'
import { OverviewTab } from './overview/OverviewTab'
import { RatingTab } from './rating/RatingTab'
import { formatAmount } from '../../lib/format'
import { gradeTone } from '../../lib/grade'

const TAB_KEYS = ['overview', 'financials', 'rating', 'limits'] as const

export function BuyerDetailPage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = TAB_KEYS.includes(searchParams.get('tab') as (typeof TAB_KEYS)[number])
    ? (searchParams.get('tab') as (typeof TAB_KEYS)[number])
    : 'overview'

  const { data: buyer, isLoading } = useBuyer(id)

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!buyer) {
    return (
      <EmptyState
        title={t('buyers.notFound')}
        action={
          <Link to="/buyers" className="text-sm font-medium text-accent-700 hover:underline">
            {t('buyers.backToList')}
          </Link>
        }
      />
    )
  }

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            <span>
              <span className="mr-2">{countryFlag(buyer.country_code)}</span>
              {buyer.name}
            </span>
            <GradeHeaderBadge
              buyerId={id}
              onClick={() => setSearchParams({ tab: 'rating' }, { replace: true })}
            />
          </span>
        }
        subtitle={
          <span>
            <Link to="/buyers" className="text-accent-700 hover:underline">
              {t('nav.buyers')}
            </Link>
            {' / '}
            {buyer.registration_number}
          </span>
        }
      />

      <Tabs
        tabs={[
          { key: 'overview', label: t('buyers.tabs.overview') },
          { key: 'financials', label: t('buyers.tabs.financials') },
          { key: 'rating', label: t('buyers.tabs.rating') },
          { key: 'limits', label: t('buyers.tabs.limits') },
        ]}
        active={activeTab}
        onChange={(key) => setSearchParams({ tab: key }, { replace: true })}
      />

      <div className="mt-5">
        {activeTab === 'overview' && <OverviewTab buyerId={id} />}
        {activeTab === 'financials' && <FinancialsTab buyerId={id} />}
        {activeTab === 'rating' && <RatingTab buyerId={id} />}
        {activeTab === 'limits' && <BuyerLimitsTab buyerId={id} />}
      </div>
    </div>
  )
}

/** Latest assessment grade, always visible in the header (legacy "Grade: 4"). */
function GradeHeaderBadge({ buyerId, onClick }: { buyerId: string; onClick: () => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data } = useQuery({
    queryKey: ['buyers', buyerId, 'latest-grade'],
    queryFn: async (): Promise<{ rating_grade: string; rating_score: number } | null> => {
      const { data: rows, error } = await tci()
        .from('credit_assessments')
        .select('rating_grade, rating_score')
        .eq('buyer_id', buyerId)
        .order('created_at', { ascending: false })
        .limit(1)
      if (error) throw error
      return (rows?.[0] as { rating_grade: string; rating_score: number } | undefined) ?? null
    },
  })

  if (!data) return null
  return (
    <button type="button" onClick={onClick} title={t('rating.gradeTitle')}>
      <Badge tone={gradeTone(data.rating_grade)} size="lg">
        {data.rating_grade} · {formatAmount(Number(data.rating_score), locale, 0)}
      </Badge>
    </button>
  )
}
