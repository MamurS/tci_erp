import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { tci } from '../../lib/supabase'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Spinner,
  Tabs,
} from '../../components/ui'
import { refName, useBuyer, useUpdateBuyer } from './api'
import { BuyerFormModal } from './BuyerFormModal'
import { countryFlag } from '../../lib/countryFlag'
import { FinancialsTab } from './financials/FinancialsTab'
import { RatingTab } from './rating/RatingTab'
import { EM_DASH, formatAmount } from '../../lib/format'
import { gradeTone } from '../../lib/grade'

const TAB_KEYS = ['overview', 'financials', 'rating'] as const

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
        ]}
        active={activeTab}
        onChange={(key) => setSearchParams({ tab: key }, { replace: true })}
      />

      <div className="mt-5">
        {activeTab === 'overview' && <OverviewTab buyerId={id} />}
        {activeTab === 'financials' && <FinancialsTab buyerId={id} />}
        {activeTab === 'rating' && <RatingTab buyerId={id} />}
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

function OverviewTab({ buyerId }: { buyerId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: buyer } = useBuyer(buyerId)
  const updateBuyer = useUpdateBuyer(buyerId)
  const [editOpen, setEditOpen] = useState(false)

  if (!buyer) return null

  const rows: { label: string; value: React.ReactNode }[] = [
    { label: t('buyers.fields.name'), value: buyer.name },
    {
      label: t('buyers.fields.country'),
      value: `${countryFlag(buyer.country_code)} ${refName(buyer.countries, locale)}`,
    },
    { label: t('buyers.fields.industry'), value: refName(buyer.industries, locale) || EM_DASH },
    { label: t('buyers.fields.registrationNumber'), value: buyer.registration_number },
    {
      label: t('buyers.fields.website'),
      value: buyer.website ? (
        <a
          href={buyer.website}
          target="_blank"
          rel="noreferrer"
          className="text-accent-700 hover:underline"
        >
          {buyer.website}
        </a>
      ) : (
        EM_DASH
      ),
    },
    { label: t('buyers.fields.notes'), value: buyer.notes || EM_DASH },
  ]

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">{t('buyers.basicInfo')}</h2>
          <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
            {t('common.edit')}
          </Button>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-slate-500">{row.label}</dt>
              <dd className="text-slate-800">{row.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="flex flex-col items-start gap-2 p-5">
        <h2 className="text-sm font-semibold text-slate-900">{t('buyers.ratingSummary.title')}</h2>
        <Badge tone="neutral">{t('buyers.ratingSummary.pending')}</Badge>
        <p className="text-[13px] text-slate-500">{t('buyers.ratingSummary.hint')}</p>
      </Card>

      <BuyerFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initial={buyer}
        onSubmit={async (input) => {
          await updateBuyer.mutateAsync(input)
        }}
      />
    </div>
  )
}
