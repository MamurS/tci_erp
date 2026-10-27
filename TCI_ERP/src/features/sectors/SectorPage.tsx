/**
 * One sector (/sectors/:sectorId): its grade in force with the outlook, the
 * review it rests on (seven scored factors, the narrative, the sources), a
 * review waiting for a second analyst, every version, the grade over time,
 * and the book — the sector's companies by rating grade and the active
 * limits on them. A credit analyst writes the next review here and another
 * approves it (four eyes, when the setting asks); credit underwriting and
 * admin read. Graded C or D, the buyers with active limits come first: they
 * are what the downgrade task in the Agenda asks credit underwriting to
 * review.
 */

import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import {
  Badge,
  Button,
  Callout,
  Card,
  COL,
  EmptyState,
  KeyFigures,
  Panel,
  PanelGrid,
  Spinner,
  Table,
  DetailHeader,
  GradeBadge,
  HumanAmount,
} from '../../components/ui'
import { formatAmount, formatDate, formatMoment, formatPeriod } from '../../lib/format'
import { refusalKey } from '../../lib/refusals'
import { useStaffDirectory } from '../data/api'
import { staffName } from '../data/staff'
import { useDecideSectorReview, useRiskSettings, useSectorBuyers, useSectorGrades, useSectorReviews } from '../risk/api'
import type { SectorReview, SectorRow } from '../risk/api'
import { SectorBadge } from '../risk/badges'
import { useSectorLimitBook } from './api'
import {
  exposureByMonth,
  gradeHistory,
  industryName,
  isWeakGrade,
  mayWriteReview,
  quarterEnd,
  reviewDecisionState,
  uiLang,
} from './model'
import { ReasonModal } from './ReasonModal'
import { ReviewBody } from './ReviewBody'
import { ReviewFormModal } from './ReviewForm'
import { ExposureChart, GradeHistoryChart } from './SectorCharts'
import { GradeDistribution, SectorBuyersTable } from './SectorBuyers'
import { SectorStateBadges } from './SectorStateBadges'

const STATUS_TONE: Record<SectorReview['status'], 'pos' | 'accent' | 'neg'> = {
  approved: 'pos',
  pending: 'accent',
  rejected: 'neg',
}

export function SectorPage() {
  const { sectorId } = useParams<{ sectorId: string }>()
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const lang = uiLang(locale)
  const { actingRole } = useAuth()
  const sectors = useSectorGrades()
  const sector = sectors.data?.find((s) => s.sector_id === sectorId)
  const reviews = useSectorReviews(sectorId)
  const buyers = useSectorBuyers(sector?.industry_code)
  const book = useSectorLimitBook(sectorId, buyers.data?.map((b) => b.entity_id))
  const settings = useRiskSettings()
  const staff = useStaffDirectory()
  const [writing, setWriting] = useState(false)

  const all = useMemo(() => reviews.data ?? [], [reviews.data])
  const current = useMemo(
    () => (sector?.review_id ? (all.find((r) => r.id === sector.review_id) ?? null) : null),
    [all, sector?.review_id],
  )
  const pending = all.find((r) => r.status === 'pending') ?? null

  if (sectors.isLoading) return <Spinner label={t('common.loading')} />
  if (!sector)
    return (
      <Card className="p-6">
        <EmptyState
          pictogram="search"
          title={t('risk.sectors.page.notFound')}
          action={
            <Link to="/sectors" className="font-medium text-accent-600 hover:underline">
              {t('risk.sectors.page.backToList')}
            </Link>
          }
        />
      </Card>
    )

  const name = industryName(sector, lang)
  const weak = isWeakGrade(sector.grade)
  const writer = mayWriteReview(actingRole)
  const fourEyes = settings.data?.sector_review_four_eyes ?? false
  const name_ = (id: string | null) => staffName(staff.data, id)

  const buyersPanel = (
    <Panel
      title={t(weak ? 'risk.sectors.buyers.titleWeak' : 'risk.sectors.buyers.title')}
      hint={t(weak ? 'risk.sectors.buyers.hintWeak' : 'risk.sectors.buyers.hint')}
    >
      <div className="grid gap-4">
        {buyers.data && buyers.data.length > 0 && <GradeDistribution buyers={buyers.data} />}
        <SectorBuyersTable buyers={buyers.data} loading={buyers.isLoading} defaultScope={weak ? 'limits' : undefined} />
      </div>
    </Panel>
  )

  return (
    <div>
      <DetailHeader
        eyebrow={`${t('risk.sectors.page.eyebrow')} · ${sector.industry_code}`}
        title={name}
        status={
          sector.grade ? (
            <SectorBadge
              grade={sector.grade}
              outlook={sector.outlook}
              stale={sector.stale}
              reviewedAt={sector.reviewed_at}
              industryName={name}
            />
          ) : (
            <Badge>{t('risk.sectors.page.notGraded')}</Badge>
          )
        }
        meta={[
          sector.outlook && t(`risk.sectors.outlooks.${sector.outlook}`),
          sector.reviewed_at && t('risk.sectors.page.reviewedOn', { date: formatDate(sector.reviewed_at, locale) }),
          sector.analyst_id
            ? t('risk.sectors.page.analyst', { name: name_(sector.analyst_id) })
            : t('risk.sectors.list.noAnalyst'),
        ]}
        actions={
          writer ? (
            <Button
              onClick={() => setWriting(true)}
              disabled={sector.pending || Boolean(pending)}
              title={sector.pending || pending ? t('risk.sectors.page.writeBlocked') : undefined}
            >
              {t('risk.sectors.page.write')}
            </Button>
          ) : undefined
        }
      />

      <div className="grid gap-6">
        <Notices sector={sector} pendingBlocksWriter={writer && Boolean(pending)} />

        <SectorFigures sector={sector} />

        {pending && <PendingReview review={pending} sectorName={name} />}

        {/* A C/D sector: its buyers with limits are the work, so they come first. */}
        {weak && buyersPanel}

        <Panel
          title={t('risk.sectors.page.current')}
          hint={current ? <ReviewMeta review={current} /> : undefined}
        >
          {reviews.isLoading ? (
            <Spinner />
          ) : current ? (
            <ReviewBody review={current} />
          ) : (
            <EmptyState
              pictogram="chart"
              title={t('risk.sectors.page.noReview')}
              hint={t(writer ? 'risk.sectors.page.noReviewWriter' : 'risk.sectors.page.noReviewHint')}
            />
          )}
        </Panel>

        <Trends sectorId={sector.sector_id} reviews={all} loadingBook={book.isLoading || buyers.isLoading} book={book.data} />

        <HistoryPanel reviews={all} loading={reviews.isLoading} />

        {!weak && buyersPanel}
      </div>

      {writing && (
        <ReviewFormModal
          sectorId={sector.sector_id}
          sectorName={name}
          current={current}
          fourEyes={fourEyes}
          onClose={() => setWriting(false)}
        />
      )}
    </div>
  )
}

/** Amber for what can wait (an old or overdue review); nothing when in order. */
function Notices({ sector, pendingBlocksWriter }: { sector: SectorRow; pendingBlocksWriter: boolean }) {
  const { t } = useTranslation()
  const items = [
    sector.overdue && (
      <Callout key="overdue" tone="warn" title={t('risk.sectors.page.overdue')}>
        {t('risk.sectors.page.overdueHint')}
      </Callout>
    ),
    sector.stale && (
      <Callout key="stale" tone="warn" title={t('risk.sectors.page.stale')}>
        {t('risk.sectors.page.staleHint')}
      </Callout>
    ),
    pendingBlocksWriter && (
      <Callout key="blocked" tone="info" title={t('risk.sectors.page.writeBlocked')} />
    ),
  ].filter(Boolean)
  if (!items.length) return null
  return <div className="grid gap-3">{items}</div>
}

/** The book in the sector, from v_sector_grades (missing rates counted). */
function SectorFigures({ sector }: { sector: SectorRow }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  return (
    <KeyFigures
      className=""
      items={[
        { label: t('risk.sectors.fields.companies'), value: formatAmount(sector.companies, locale) },
        { label: t('risk.sectors.fields.buyersWithLimits'), value: formatAmount(sector.buyers_with_limits, locale) },
        {
          label: t('risk.sectors.fields.exposure'),
          value:
            sector.buyers_with_limits > 0 || sector.exposure_missing_rates > 0 ? (
              <HumanAmount value={sector.exposure_uzs} currency="UZS" />
            ) : (
              '—'
            ),
          meta:
            sector.exposure_missing_rates > 0
              ? t('risk.sectors.missingRates', { count: sector.exposure_missing_rates })
              : undefined,
          tone: sector.exposure_missing_rates > 0 ? 'warn' : 'default',
        },
        {
          label: t('risk.sectors.fields.state'),
          value: <SectorStateBadges row={sector} />,
          text: true,
        },
      ]}
    />
  )
}

/** «Q3 2026 · quarterly · written by A · approved by B on …». */
function ReviewMeta({ review }: { review: SectorReview }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const staff = useStaffDirectory()
  const parts = [
    formatPeriod(review.quarter_start, quarterEnd(review.quarter_start), locale),
    t(`risk.sectors.kinds.${review.kind}`),
    t('risk.sectors.page.writtenBy', { name: staffName(staff.data, review.created_by) }),
    review.decided_at &&
      (review.decided_by && review.decided_by !== review.created_by
        ? t('risk.sectors.page.approvedBy', {
            name: staffName(staff.data, review.decided_by),
            date: formatDate(review.decided_at, locale),
          })
        : t('risk.sectors.page.inForceFrom', { date: formatDate(review.decided_at, locale) })),
  ].filter(Boolean)
  return <>{parts.join(' · ')}</>
}

/** A review waiting for a second analyst: who may answer sees the buttons,
 * its author sees that a colleague must, everyone else that it waits. */
function PendingReview({ review, sectorName }: { review: SectorReview; sectorName: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { actingRole, session } = useAuth()
  const staff = useStaffDirectory()
  const decide = useDecideSectorReview()
  const [rejecting, setRejecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const state = reviewDecisionState({ actingRole, userId: session?.user.id, review })

  const approve = () => {
    setError(null)
    decide.mutateAsync({ reviewId: review.id, approve: true }).catch((e: unknown) => setError(t(refusalKey(e))))
  }

  return (
    <div id="pending-review">
      <Panel
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {t('risk.sectors.pending.title')}
            <SectorBadge grade={review.grade} outlook={review.outlook} industryName={sectorName} />
          </span>
        }
        hint={t('risk.sectors.pending.hint', {
          name: staffName(staff.data, review.created_by),
          date: formatMoment(review.created_at, locale),
        })}
        footer={
          state === 'decide' ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="dangerOutline" onClick={() => setRejecting(true)}>
                {t('risk.sectors.pending.reject')}
              </Button>
              <Button loading={decide.isPending && !rejecting} onClick={approve}>
                {t('risk.sectors.pending.approve')}
              </Button>
            </div>
          ) : undefined
        }
      >
        <div className="grid gap-4">
          {error && <Callout tone="neg" title={error} />}
          {state === 'own' && <Callout tone="info" title={t('risk.sectors.pending.own')} />}
          {state === 'readonly' && <Callout tone="info" title={t('risk.sectors.pending.readonly')} />}
          <ReviewBody review={review} />
        </div>
      </Panel>
      {rejecting && (
        <ReasonModal
          title={t('risk.sectors.pending.rejectTitle')}
          label={t('risk.sectors.pending.rejectReason')}
          hint={t('risk.sectors.pending.rejectHint')}
          missingMessage={t('risk.errors.sectorReviewRejectReason')}
          submitLabel={t('risk.sectors.pending.reject')}
          pending={decide.isPending}
          onSubmit={(comment) => decide.mutateAsync({ reviewId: review.id, approve: false, comment })}
          onClose={() => setRejecting(false)}
        />
      )}
    </div>
  )
}

function Trends({
  sectorId,
  reviews,
  book,
  loadingBook,
}: {
  sectorId: string
  reviews: readonly SectorReview[]
  book: Parameters<typeof exposureByMonth>[0] | undefined
  loadingBook: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const grades = useMemo(() => gradeHistory(reviews), [reviews])
  const exposure = useMemo(() => exposureByMonth(book ?? []), [book])
  const reviewsInForce = grades.filter((p) => !p.carried).length

  return (
    <PanelGrid key={sectorId}>
      <Panel title={t('risk.sectors.charts.gradeTitle')} hint={t('risk.sectors.charts.gradeHint')}>
        {reviewsInForce === 0 ? (
          <EmptyState pictogram="chart" title={t('risk.sectors.charts.gradeEmpty')} />
        ) : (
          <GradeHistoryChart points={grades} />
        )}
      </Panel>
      <Panel title={t('risk.sectors.charts.exposureTitle')} hint={t('risk.sectors.charts.exposureHint')}>
        {loadingBook ? (
          <Spinner />
        ) : !exposure.points.length ? (
          <EmptyState
            pictogram="limits"
            title={t('risk.sectors.charts.exposureEmpty')}
            hint={exposure.missingRates > 0 ? t('risk.sectors.missingRates', { count: exposure.missingRates }) : undefined}
          />
        ) : (
          <div className="grid gap-2">
            <ExposureChart points={exposure.points} />
            {(exposure.missingRates > 0 || exposure.undated > 0) && (
              <p className="text-caption text-warning-700">
                {[
                  exposure.missingRates > 0 && t('risk.sectors.charts.missingRates', { count: exposure.missingRates }),
                  exposure.undated > 0 && t('risk.sectors.charts.undated', { count: exposure.undated }),
                ]
                  .filter(Boolean)
                  .join(' ')}
              </p>
            )}
            <p className="text-caption text-slate-500">
              {t('risk.sectors.charts.exposureTotal', { amount: formatAmount(exposure.total, locale) })}
            </p>
          </div>
        )}
      </Panel>
    </PanelGrid>
  )
}

function HistoryPanel({ reviews, loading }: { reviews: readonly SectorReview[]; loading: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const staff = useStaffDirectory()
  const [open, setOpen] = useState<string | null>(null)
  const columns = [COL.date, '9rem', '5rem', '10rem', COL.person, COL.fill, '9rem', '7rem']

  return (
    <Panel title={t('risk.sectors.history.title')} hint={t('risk.sectors.history.hint')}>
      {loading ? (
        <Spinner />
      ) : !reviews.length ? (
        <EmptyState pictogram="documents" title={t('risk.sectors.history.empty')} hint={t('risk.sectors.history.emptyHint')} />
      ) : (
        <Table columns={columns}>
          <thead>
            <tr>
              <th>{t('risk.sectors.history.written')}</th>
              <th>{t('risk.sectors.fields.kind')}</th>
              <th>{t('risk.sectors.fields.grade')}</th>
              <th>{t('risk.sectors.fields.outlook')}</th>
              <th>{t('risk.sectors.history.author')}</th>
              <th>{t('risk.sectors.history.decided')}</th>
              <th>{t('risk.sectors.history.status')}</th>
              <th>
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {reviews.map((r) => (
              <HistoryRow
                key={r.id}
                review={r}
                open={open === r.id}
                onToggle={() => setOpen(open === r.id ? null : r.id)}
                author={staffName(staff.data, r.created_by)}
                decider={r.decided_by ? staffName(staff.data, r.decided_by) : null}
                locale={locale}
                span={columns.length}
              />
            ))}
          </tbody>
        </Table>
      )}
    </Panel>
  )
}

function HistoryRow({
  review: r,
  open,
  onToggle,
  author,
  decider,
  locale,
  span,
}: {
  review: SectorReview
  open: boolean
  onToggle: () => void
  author: string
  decider: string | null
  locale: string
  span: number
}) {
  const { t } = useTranslation()
  return (
    <>
      <tr>
        <td className="text-slate-600">{formatDate(r.created_at, locale)}</td>
        <td className="text-slate-600">{t(`risk.sectors.kinds.${r.kind}`)}</td>
        <td>
          <GradeBadge grade={r.grade} />
        </td>
        <td className="text-slate-600">{t(`risk.sectors.outlooks.${r.outlook}`)}</td>
        <td className="text-slate-600">{author}</td>
        <td className="text-slate-600">
          {r.decided_at
            ? decider && r.decided_by !== r.created_by
              ? t('risk.sectors.history.decidedBy', { name: decider, date: formatDate(r.decided_at, locale) })
              : formatDate(r.decided_at, locale)
            : '—'}
        </td>
        <td>
          <Badge tone={STATUS_TONE[r.status]}>{t(`risk.sectors.reviewStatus.${r.status}`)}</Badge>
        </td>
        <td className="text-right">
          <Button size="sm" variant="ghost" aria-expanded={open} onClick={onToggle}>
            {t(open ? 'risk.sectors.history.hide' : 'risk.sectors.history.show')}
          </Button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={span} className="bg-slate-50/60 whitespace-normal">
            <div className="grid gap-4 py-2">
              {r.decision_comment && (
                <Callout tone={r.status === 'rejected' ? 'warn' : 'info'} title={t('risk.sectors.history.comment')}>
                  {r.decision_comment}
                </Callout>
              )}
              <ReviewBody review={r} />
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
