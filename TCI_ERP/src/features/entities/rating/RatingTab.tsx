/**
 * Rating & Limit tab: pick a statement, calculate via the analytics
 * service, persist the assessment (history preserved), show the grade on
 * the GradeScale with factor traffic lights, component breakdown, limit
 * trace, score history chart and report generation. Degrades gracefully
 * when the analytics service is down.
 */

import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Plus } from 'lucide-react'

import {
  Badge,
  Button,
  Card,
  COL,
  EmptyState,
  GradeScale,
  labelCol,
  LinkButton,
  RatingGauge,
  RatingLegend,
  SectionTitle,
  Select,
  Spinner,
  Table,
} from '../../../components/ui'
import { useAuth } from '../../../auth/AuthContext'
import {
  AnalyticsUnavailableError,
  postCreditLimit,
  postRating,
} from '../../../lib/analytics'
import type {
  CreditLimitResponse,
  RatingResponse,
  StatementPayload,
} from '../../../lib/analytics'
import { EM_DASH, formatAmount, formatDate, formatMoment, formatPercent } from '../../../lib/format'
import { gradeTone } from '../../../lib/grade'
import { gradeChange, useGradeScale } from '../../../lib/gradeScale'
import type { GradeBand } from '../../../lib/gradeScale'
import { tci } from '../../../lib/supabase'
import { DEEP_LINK_SCROLL_MARGIN, useDeepLinkFocus } from '../../../lib/useDeepLinkFocus'
import { AdtSection } from '../../limits/AdtSection'
import { ADT_FOCUS } from '../../limits/adt'
import { useEntity, useStatements } from '../api'
import type { StatementBundle } from '../types'
import { statementPeriodLabel } from '../types'
import { sortChronological } from '../financials/analysis'
import { useFxRates, usdRateFor } from '../financials/fxApi'
import { useAssessments } from './assessmentsApi'
import type { AssessmentRow } from './assessmentsApi'
import { buildFactorChips, formatFactorValue, isUnchangedDynamic } from './chips'
import type { FactorChip } from './chips'
import { FactorChipList } from './FactorChips'
import { limitReason } from './limitReasons'
import { ScoreChangeNote } from './ScoreChangeNote'
import { mayEnterStatements } from '../financials/access'
import { mayRate } from '../access'
import { useCreditAnalysisMode } from '../../../lib/creditAnalysis'
import { RatingConfirmation } from './RatingConfirmation'
import { CHART_COLORS } from '../report/DynamicCharts'
import { ReportModal } from './ReportModal'

/** id of the factor breakdown table — dashboard chips deep-link here. */
export const FACTOR_TABLE_ANCHOR_ID = 'rating-factor-table'

/** id of the statement selector + Calculate row — `?statement=` lands here. */
const STATEMENT_ROW_ANCHOR_ID = 'rating-statement'

/** Company age in years at the statement date (activates the age factor). */
function ageAt(foundedDate: string | null | undefined, periodEnd: string): number | null {
  if (!foundedDate) return null
  const days =
    (new Date(periodEnd).getTime() - new Date(foundedDate).getTime()) / 86_400_000
  return days > 0 ? days / 365.2425 : null
}

export function RatingTab({ entityId }: { entityId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const queryClient = useQueryClient()

  const { data: buyer } = useEntity(entityId)
  const { roles: myRoles } = useAuth()
  const { data: statements, isLoading } = useStatements(entityId)
  const { data: gradeBands } = useGradeScale()
  const mode = useCreditAnalysisMode()
  const ordered = useMemo(
    () => sortChronological(statements ?? []).reverse(),
    [statements],
  )

  // ?statement=<id> (the Agenda's «rate this statement») pre-selects the
  // statement and brings the Calculate row into view. An id this company does
  // not hold falls back to the latest, as with no parameter at all.
  const [searchParams] = useSearchParams()
  const linkedStatement = searchParams.get('statement')
  const [statementId, setStatementId] = useState<string | null>(linkedStatement)
  const selected: StatementBundle | null =
    ordered.find((s) => s.id === statementId) ?? ordered[0] ?? null
  useDeepLinkFocus(linkedStatement ? STATEMENT_ROW_ANCHOR_ID : null)
  // ?focus=adt (the Agenda's «review the buyer / renew the ADT») lands on the
  // ADT block, which only the credit desk gets; for anyone else it is never
  // found and the tab is as usual.
  useDeepLinkFocus(searchParams.get('focus') === ADT_FOCUS ? ADT_FOCUS : null, { ready: !isLoading })

  const [result, setResult] = useState<{
    rating: RatingResponse
    limit: CreditLimitResponse
  } | null>(null)
  const [serviceDown, setServiceDown] = useState(false)
  const [reportModalOpen, setReportModalOpen] = useState(false)

  const fxNeeds = useMemo(() => {
    if (!selected) return []
    const needs = [{ currency_code: 'USD', rate_date: selected.period_end_date }]
    if (selected.currency_code !== 'UZS' && selected.currency_code !== 'USD') {
      needs.push({ currency_code: selected.currency_code, rate_date: selected.period_end_date })
    }
    return needs
  }, [selected])
  const { data: fxRates } = useFxRates(fxNeeds)

  const assessments = useAssessments(entityId)

  // ?anchor=factors (dashboard chip click) → scroll to the factor table.
  const anchor = searchParams.get('anchor')
  const hasResult = Boolean(result ?? assessments.data?.[0]?.calculation_trace)
  useDeepLinkFocus(anchor === 'factors' ? FACTOR_TABLE_ANCHOR_ID : null, {
    ready: hasResult,
    highlight: false,
  })

  const calculate = useMutation({
    mutationFn: async (statement: StatementBundle) => {
      // Up to 3 chronological periods of the SAME kind and report type.
      const chronological = sortChronological(statements ?? [])
      const upTo = chronological.filter(
        (s) =>
          s.period_end_date <= statement.period_end_date &&
          s.statement_kind === statement.statement_kind &&
          s.report_type === statement.report_type,
      )
      const windowed = upTo.slice(-3)

      const usdRate = usdRateFor(statement.currency_code, statement.period_end_date, fxRates)
      const payload: StatementPayload = {
        buyer: {
          name: buyer?.name ?? null,
          country_code: buyer?.country_code ?? null,
          age_years: ageAt(buyer?.founded_date, statement.period_end_date),
        },
        currency: statement.currency_code,
        unit: statement.unit,
        ...(usdRate !== null ? { exchange_rate_usd: usdRate } : {}),
        report_type: statement.report_type,
        periods: windowed.map((s) => ({
          fiscal_year: s.fiscal_year,
          statement_kind: s.statement_kind,
          balance_sheet: (s.balance_sheets ?? {}) as Record<string, number | null>,
          income_statement: (s.income_statements ?? {}) as Record<string, number | null>,
        })),
      }

      const rating = await postRating(payload)
      if (rating.score === null) {
        return { rating, limit: null as CreditLimitResponse | null }
      }
      const limit = await postCreditLimit({ ...payload, rating_score: rating.score })

      // Persist (history preserved - always insert).
      const { error } = await tci().from('credit_assessments').insert({
        entity_id: entityId,
        statement_id: statement.id,
        rating_score: rating.score,
        rating_grade: rating.grade,
        suggested_limit: limit.suggested_limit,
        limit_currency: limit.currency,
        inputs_snapshot: payload,
        calculation_trace: { rating, limit },
        engine_version: rating.engine_version,
      })
      if (error) throw error
      return { rating, limit }
    },
    onSuccess: (data) => {
      setServiceDown(false)
      if (data.limit) setResult({ rating: data.rating, limit: data.limit })
      void queryClient.invalidateQueries({ queryKey: ['buyers', entityId, 'assessments'] })
      void queryClient.invalidateQueries({ queryKey: ['buyers', entityId, 'latest-grade'] })
    },
    onError: (error) => {
      if (error instanceof AnalyticsUnavailableError) setServiceDown(true)
    },
  })

  if (isLoading) return <Spinner label={t('common.loading')} />

  if (!ordered.length) {
    // Nothing to rate on yet: say what is needed, and offer the one step to
    // whoever may take it (the data and credit desks enter statements).
    return (
      <div className="flex flex-col gap-5">
        <EmptyState
          title={t('rating.needStatementsTitle')}
          hint={t('rating.needStatements')}
          action={
            mayEnterStatements(myRoles) ? (
              <LinkButton to={`/entities/${entityId}/statements/new`}>
                <Plus />
                {t('fin.addStatement')}
              </LinkButton>
            ) : undefined
          }
        />
        {/* A live ADT stays visible (and can be disabled) even when the
            statements it was set on are gone (no_financials, 0061). */}
        <AdtSection entityId={entityId} />
      </div>
    )
  }

  // Fresh result wins; otherwise the latest stored assessment.
  const latestStored = assessments.data?.[0] ?? null
  const shown = result ?? latestStored?.calculation_trace ?? null
  const previousRow = result ? latestStored && assessments.data?.[1] : assessments.data?.[1]
  const change =
    shown?.rating.score !== null && shown?.rating.grade && previousRow && gradeBands
      ? gradeChange(
          gradeBands,
          { score: shown.rating.score ?? 0, grade: shown.rating.grade },
          { score: Number(previousRow.rating_score), grade: previousRow.rating_grade },
        )
      : null

  return (
    <div className="flex flex-col gap-5">
      <div id={STATEMENT_ROW_ANCHOR_ID} className={`rounded-lg ${DEEP_LINK_SCROLL_MARGIN}`}>
        <Card className="flex flex-wrap items-end gap-3 p-5">
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-slate-600">{t('rating.statement')}</span>
            <Select
              value={selected?.id ?? ''}
              onChange={(e) => setStatementId(e.target.value)}
              className="min-w-48"
            >
              {ordered.map((s) => (
                <option key={s.id} value={s.id}>
                  {statementPeriodLabel(s)} · {s.currency_code}
                </option>
              ))}
            </Select>
          </label>
          {mayRate(myRoles, mode) && (
            <Button
              onClick={() => selected && calculate.mutate(selected)}
              disabled={!selected}
              loading={calculate.isPending}
              title={calculate.isPending ? t('rating.calculating') : undefined}
            >
              {t('rating.calculate')}
            </Button>
          )}
          <Button variant="secondary" onClick={() => setReportModalOpen(true)}>
            {t('rating.generateReport')}
          </Button>
          {serviceDown && (
            <span className="text-[13px] text-neg-500" role="alert">
              {t('rating.serviceUnavailable')}
            </span>
          )}
          {calculate.isError && !serviceDown && (
            <span className="text-[13px] text-neg-500" role="alert">
              {t('common.saveFailed')}
            </span>
          )}
        </Card>
      </div>

      {/* The grade in force and its confirmation (0069). */}
      {latestStored && (
        <RatingConfirmation
          key={latestStored.id}
          entityId={entityId}
          current={latestStored}
          bands={gradeBands}
          mode={mode}
          locale={locale}
        />
      )}

      {shown ? (
        <ResultView
          result={shown}
          locale={locale}
          bands={gradeBands}
          change={change}
          previousScore={previousRow ? Number(previousRow.rating_score) : null}
        />
      ) : (
        <Card className="p-5">
          <EmptyState title={t('rating.notAssessed')} hint={t('rating.notAssessedHint')} />
        </Card>
      )}

      {/* The buyer's auto decision threshold (0061): set at the review, on
          the rating above. The credit desk only. */}
      <AdtSection entityId={entityId} />

      <ScoreHistoryChart
        assessments={assessments.data ?? []}
        statements={ordered}
        locale={locale}
      />

      <HistoryCard
        assessments={assessments.data ?? []}
        statements={ordered}
        locale={locale}
      />

      <ReportModal
        open={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        entityId={entityId}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Result view: grade scale + factor chips + limit + component table
// ---------------------------------------------------------------------------

function ResultView({
  result,
  locale,
  bands,
  change,
  previousScore,
}: {
  result: { rating: RatingResponse; limit: CreditLimitResponse }
  locale: string
  bands: GradeBand[] | undefined
  change: ReturnType<typeof gradeChange> | null
  previousScore: number | null
}) {
  const { t } = useTranslation()
  const { rating, limit } = result
  const chips = buildFactorChips(rating.components, t, locale)

  return (
    <>
      <Card className="flex flex-col gap-4 p-5">
        <div className="grid items-center gap-5 lg:grid-cols-[240px_1fr]">
          <div className="flex flex-col items-center rounded-lg bg-accent-50/60 px-3 pt-3 pb-2">
            {/* The change is said in words below, not as an arrow on a
                lower-is-better scale. */}
            <RatingGauge score={rating.score} />
            <ScoreChangeNote score={rating.score} previousScore={previousScore} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {rating.score !== null && rating.grade && (
              <GradeScale
                score={rating.score}
                grade={rating.grade}
                bands={bands}
                change={change}
              />
            )}
            <RatingLegend score={rating.score} />
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <FactorGroup title={t('rating.strengths')} chips={chips.strengths} none={t('rating.noStrengths')} />
          <FactorGroup title={t('rating.weaknesses')} chips={chips.weaknesses} none={t('rating.noWeaknesses')} />
        </div>
        <p className="text-[13px] text-slate-500">
          {rating.data_coverage >= 0.995
            ? t('rating.coverageFull')
            : t('rating.coverage', { pct: formatPercent(rating.data_coverage, locale, 0) })}
        </p>
        {rating.adjustments.length > 0 && (
          <div className="flex flex-col gap-1">
            {rating.adjustments.map((a) => (
              <span key={a.code} className="text-[13px] text-warn-500">
                {t(`rating.adjustments.${a.code}`, { defaultValue: t('rating.adjustments.other') })}:{' '}
                {formatAmount(a.rating_before, locale, 1)} →{' '}
                {formatAmount(a.rating_after, locale, 1)}
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* Limit card */}
      <Card className="flex flex-col items-start gap-2 p-5">
        <SectionTitle>{t('rating.limitTitle')}</SectionTitle>
        <span className="num text-3xl font-bold text-slate-900">
          {formatAmount(limit.suggested_limit, locale)}{' '}
          <span className="text-lg font-medium text-slate-500">{limit.currency}</span>
        </span>
        <span className="text-[13px] text-slate-500">
          {t('rating.model')}: {t(`rating.models.${limit.model_used}`, { defaultValue: t('rating.models.none') })}
        </span>
        {limit.reasons.length > 0 && (
          <ul className="list-inside list-disc text-[13px] text-slate-500">
            {limit.reasons.map((r) => {
              const reason = limitReason(r)
              return <li key={r}>{t(`rating.limitReasons.${reason.key}`, reason.params)}</li>
            })}
          </ul>
        )}
        <details className="mt-1 w-full text-[13px] text-slate-600">
          <summary className="cursor-pointer font-medium text-accent-700">
            {t('rating.trace')}
          </summary>
          <div className="mt-2 flex flex-col gap-3">
            {limit.trace.map((m) => (
              <div key={m.model}>
                <p className="font-medium">
                  {t(`rating.models.${m.model}`, { defaultValue: m.model })}:{' '}
                  <span className="num">
                    {formatAmount(m.limit, locale)} {limit.currency}
                  </span>
                </p>
                <ul className="mt-0.5 grid gap-x-6 text-slate-500 sm:grid-cols-2">
                  {Object.entries(m.components).map(([k, v]) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span>{t(`rating.traceComponents.${k}`, { defaultValue: k })}</span>
                      <span className="num">{traceValue(k, v, limit.currency, locale)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      </Card>

      {/* Component breakdown */}
      <div id={FACTOR_TABLE_ANCHOR_ID} className="scroll-mt-4">
        <Table dense columns={[COL.fill, COL.amount, COL.count, COL.count, labelCol('ratingBand')]}>
          <thead>
            <tr>
              <th>{t('rating.componentsTitle')}</th>
              <th className="num">{t('rating.value')}</th>
              <th className="num">{t('rating.score')}</th>
              <th className="num">{t('rating.weight')}</th>
              <th>{t('rating.band')}</th>
            </tr>
          </thead>
          <tbody>
            {rating.components.map((c) => (
              <tr key={c.factor} className={c.status !== 'scored' ? 'opacity-50' : ''}>
                <td>{t(`rating.factors.${c.factor}`, { defaultValue: c.factor })}</td>
                {/* The same formatting as the chips above: 37.4%, 4.60x, −9 days. */}
                <td className="num">{c.value === null ? EM_DASH : formatFactorValue(c.factor, c.value, t, locale)}</td>
                <td
                  className={`num ${
                    c.score === null
                      ? 'text-slate-400'
                      : c.score <= 40
                        ? 'text-pos-500'
                        : c.score >= 60
                          ? 'text-neg-500'
                          : ''
                  }`}
                >
                  {c.score === null ? EM_DASH : formatAmount(c.score, locale, 0)}
                </td>
                <td className="num">{formatAmount(c.weight, locale, 1)}</td>
                <td className="text-slate-500">
                  {c.value !== null && isUnchangedDynamic(c.factor, c.value)
                    ? t('rating.bands.unchanged')
                    : c.band
                      ? t(`rating.bands.${c.band}`, { defaultValue: c.band })
                      : EM_DASH}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </>
  )
}

/** A strengths / weaknesses column: the chips, or a calm line when none. */
function FactorGroup({ title, chips, none }: { title: string; chips: FactorChip[]; none: string }) {
  return (
    <div>
      <h4 className="mb-1.5 text-[13px] font-semibold text-slate-600">{title}</h4>
      {chips.length > 0 ? <FactorChipList chips={chips} /> : <p className="text-[13px] text-slate-500">{none}</p>}
    </div>
  )
}

/** A limit-trace component, read as what it is: a coefficient, days, money. */
function traceValue(key: string, value: number, currency: string, locale: string): string {
  if (key === 'risk_coefficient') return formatAmount(value, locale, 2)
  if (key === 'dso_days') return formatAmount(value, locale, 0)
  if (key.endsWith('_usd')) return `${formatAmount(value, locale, 0)} USD`
  return `${formatAmount(value, locale, 0)} ${currency}`
}

// ---------------------------------------------------------------------------
// Score history chart (hidden when fewer than two assessments)
// ---------------------------------------------------------------------------

function ScoreHistoryChart({
  assessments,
  statements,
  locale,
}: {
  assessments: AssessmentRow[]
  statements: StatementBundle[]
  locale: string
}) {
  const { t } = useTranslation()
  // Nothing to draw before the first assessment (the result card says so).
  if (assessments.length === 0) return null
  if (assessments.length < 2) {
    return (
      <Card className="p-5">
        <SectionTitle className="mb-2">{t('rating.historyChart')}</SectionTitle>
        <p className="text-[13px] text-slate-500">{t('rating.historyChartEmpty')}</p>
      </Card>
    )
  }

  // A TIME axis: two assessments months apart sit months apart, and every
  // point gets its own date under it (a category axis of formatted dates
  // drops labels and cannot space them).
  const data = [...assessments].reverse().map((a) => ({
    at: new Date(a.created_at).getTime(),
    score: Number(a.rating_score),
    grade: a.rating_grade,
    statement: statements.find((s) => s.id === a.statement_id),
  }))

  return (
    <Card className="p-5">
      <SectionTitle className="mb-3" hint={t('rating.scaleHint')}>
        {t('rating.historyChart')}
      </SectionTitle>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 20, right: 28, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e3ecf2" vertical={false} />
            <XAxis
              dataKey="at"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              ticks={data.map((d) => d.at)}
              tickFormatter={(value: number) => formatDate(new Date(value), locale)}
              padding={{ left: 28, right: 28 }}
              minTickGap={16}
              tick={{ fontSize: 11, fill: '#64748b' }}
            />
            <YAxis
              reversed
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fontSize: 11, fill: '#64748b' }}
              width={32}
            />
            <Tooltip
              formatter={(value) => [formatAmount(Number(value), locale, 1), t('rating.score')]}
              labelFormatter={(_label, payload) => {
                const point = payload?.[0]?.payload as (typeof data)[number] | undefined
                if (!point) return ''
                const period = point.statement ? ` · ${statementPeriodLabel(point.statement)}` : ''
                return `${formatDate(new Date(point.at), locale)}${period} · ${point.grade}`
              }}
            />
            <Line
              type="linear"
              dataKey="score"
              stroke={CHART_COLORS[0]}
              strokeWidth={2}
              // Drawn at once: an animation caught half-way reads as a broken
              // line (and is what a screenshot or the PDF would capture).
              isAnimationActive={false}
              dot={{ r: 4, fill: '#fff', stroke: CHART_COLORS[0], strokeWidth: 2 }}
              activeDot={{ r: 5 }}
            >
              <LabelList dataKey="grade" position="top" offset={10} fontSize={11} fill="#475569" />
            </Line>
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Assessment history table
// ---------------------------------------------------------------------------

function HistoryCard({
  assessments,
  statements,
  locale,
}: {
  assessments: AssessmentRow[]
  statements: StatementBundle[]
  locale: string
}) {
  const { t, i18n } = useTranslation()
  if (!assessments.length) return null

  const versions = [...new Set(assessments.map((a) => a.engine_version).filter(Boolean))]

  const periodOf = (statementId: string): string => {
    const s = statements.find((x) => x.id === statementId)
    return s ? statementPeriodLabel(s) : EM_DASH
  }

  return (
    <div>
      <SectionTitle className="mb-2">{t('rating.historyTitle')}</SectionTitle>
      {/* The grade column is sized for its header («Кредитный рейтинг» wraps to
          two lines; one word must still fit with the CI runner's wider fonts). */}
      <Table dense columns={[COL.moment, COL.fill, COL.count, '7.5rem', COL.money]}>
        <thead>
          <tr>
            <th>{t('rating.historyDate')}</th>
            <th>{t('rating.statement')}</th>
            <th className="num">{t('rating.score')}</th>
            <th>{t('rating.gradeTitle')}</th>
            <th className="num">{t('rating.limitTitle')}</th>
          </tr>
        </thead>
        <tbody>
          {assessments.map((a) => (
            <tr key={a.id}>
              <td className="whitespace-nowrap text-slate-500">{formatMoment(a.created_at, i18n.language)}</td>
              <td>{periodOf(a.statement_id)}</td>
              <td className="num">{formatAmount(Number(a.rating_score), locale, 1)}</td>
              <td>
                <Badge tone={gradeTone(a.rating_grade)}>{a.rating_grade}</Badge>
              </td>
              <td className="num">
                {formatAmount(Number(a.suggested_limit), locale)} {a.limit_currency}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {/* Which version of the scoring model produced these — an audit
          detail, so a footnote rather than a column. */}
      {versions.length > 0 && (
        <p className="mt-2 text-xs text-slate-400">{t('rating.engineFootnote', { versions: versions.join(', ') })}</p>
      )}
    </div>
  )
}
