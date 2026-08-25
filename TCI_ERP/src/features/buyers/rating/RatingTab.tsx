/**
 * Rating & Limit tab: pick a statement, calculate via the analytics
 * service, persist the assessment (history preserved), show the grade on
 * the GradeScale with factor traffic lights, component breakdown, limit
 * trace, score history chart and report generation. Degrades gracefully
 * when the analytics service is down.
 */

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Badge, Button, Card, GradeScale, Select, Spinner, Table } from '../../../components/ui'
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
import { EM_DASH, formatAmount, formatPercent } from '../../../lib/format'
import { gradeTone } from '../../../lib/grade'
import { gradeChange, useGradeScale } from '../../../lib/gradeScale'
import type { GradeBand } from '../../../lib/gradeScale'
import { tci } from '../../../lib/supabase'
import { useBuyer, useStatements } from '../api'
import type { StatementBundle } from '../types'
import { statementPeriodLabel } from '../types'
import { sortChronological } from '../financials/analysis'
import { useFxRates, usdRateFor } from '../financials/fxApi'
import { useAssessments } from './assessmentsApi'
import type { AssessmentRow } from './assessmentsApi'
import { buildFactorChips } from './chips'
import { FactorChipList } from './FactorChips'
import { ReportModal } from './ReportModal'

/** id of the factor breakdown table — dashboard chips deep-link here. */
export const FACTOR_TABLE_ANCHOR_ID = 'rating-factor-table'

/** Company age in years at the statement date (activates the age factor). */
function ageAt(foundedDate: string | null | undefined, periodEnd: string): number | null {
  if (!foundedDate) return null
  const days =
    (new Date(periodEnd).getTime() - new Date(foundedDate).getTime()) / 86_400_000
  return days > 0 ? days / 365.2425 : null
}

export function RatingTab({ buyerId }: { buyerId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const queryClient = useQueryClient()

  const { data: buyer } = useBuyer(buyerId)
  const { data: statements, isLoading } = useStatements(buyerId)
  const { data: gradeBands } = useGradeScale()
  const ordered = useMemo(
    () => sortChronological(statements ?? []).reverse(),
    [statements],
  )

  const [statementId, setStatementId] = useState<string | null>(null)
  const selected: StatementBundle | null =
    ordered.find((s) => s.id === (statementId ?? ordered[0]?.id)) ?? null

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

  const assessments = useAssessments(buyerId)

  // ?anchor=factors (dashboard chip click) → scroll to the factor table.
  const [searchParams] = useSearchParams()
  const anchor = searchParams.get('anchor')
  const hasResult = Boolean(result ?? assessments.data?.[0]?.calculation_trace)
  useEffect(() => {
    if (anchor !== 'factors' || !hasResult) return
    document
      .getElementById(FACTOR_TABLE_ANCHOR_ID)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [anchor, hasResult])

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
        buyer_id: buyerId,
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
      void queryClient.invalidateQueries({ queryKey: ['buyers', buyerId, 'assessments'] })
      void queryClient.invalidateQueries({ queryKey: ['buyers', buyerId, 'latest-grade'] })
    },
    onError: (error) => {
      if (error instanceof AnalyticsUnavailableError) setServiceDown(true)
    },
  })

  if (isLoading) return <Spinner label={t('common.loading')} />

  if (!ordered.length) {
    return <Card className="p-5 text-sm text-slate-500">{t('rating.needStatements')}</Card>
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
        <Button
          onClick={() => selected && calculate.mutate(selected)}
          disabled={calculate.isPending || !selected}
        >
          {calculate.isPending ? t('rating.calculating') : t('rating.calculate')}
        </Button>
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

      {shown ? (
        <ResultView
          result={shown}
          locale={locale}
          bands={gradeBands}
          change={change}
        />
      ) : (
        <Card className="p-5 text-sm text-slate-500">{t('rating.notAssessed')}</Card>
      )}

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
        buyerId={buyerId}
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
}: {
  result: { rating: RatingResponse; limit: CreditLimitResponse }
  locale: string
  bands: GradeBand[] | undefined
  change: ReturnType<typeof gradeChange> | null
}) {
  const { t } = useTranslation()
  const { rating, limit } = result
  const chips = buildFactorChips(rating.components, t, locale)

  return (
    <>
      <Card className="flex flex-col gap-4 p-5">
        {rating.score !== null && rating.grade && (
          <GradeScale
            score={rating.score}
            grade={rating.grade}
            bands={bands}
            change={change}
          />
        )}
        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <h4 className="mb-1.5 text-[13px] font-semibold text-slate-600">
              {t('rating.strengths')}
            </h4>
            <FactorChipList chips={chips.strengths} />
          </div>
          <div>
            <h4 className="mb-1.5 text-[13px] font-semibold text-slate-600">
              {t('rating.weaknesses')}
            </h4>
            <FactorChipList chips={chips.weaknesses} />
          </div>
        </div>
        <p className="text-[13px] text-slate-500">
          {t('rating.coverage', { pct: formatPercent(rating.data_coverage, locale, 0) })}
        </p>
        {rating.adjustments.length > 0 && (
          <div className="flex flex-col gap-1">
            {rating.adjustments.map((a) => (
              <span key={a.code} className="text-[13px] text-warn-500">
                {t(`rating.adjustments.${a.code}`, { defaultValue: a.code })}:{' '}
                {formatAmount(a.rating_before, locale, 1)} →{' '}
                {formatAmount(a.rating_after, locale, 1)}
              </span>
            ))}
          </div>
        )}
      </Card>

      {/* Limit card */}
      <Card className="flex flex-col items-start gap-2 p-5">
        <h3 className="text-sm font-semibold text-slate-900">{t('rating.limitTitle')}</h3>
        <span className="num text-3xl font-bold text-slate-900">
          {formatAmount(limit.suggested_limit, locale)}{' '}
          <span className="text-lg font-medium text-slate-500">{limit.currency}</span>
        </span>
        <Badge tone="neutral">
          {t('rating.model')}: {t(`rating.models.${limit.model_used}`, { defaultValue: limit.model_used })}
        </Badge>
        {limit.reasons.length > 0 && (
          <ul className="list-inside list-disc text-[13px] text-slate-500">
            {limit.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
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
                  <span className="num">{formatAmount(m.limit, locale)}</span>
                </p>
                <ul className="mt-0.5 grid grid-cols-2 gap-x-4 text-slate-500">
                  {Object.entries(m.components).map(([k, v]) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span>{k}</span>
                      <span className="num">{formatAmount(v, locale, 2)}</span>
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
        <Table dense>
        <thead>
          <tr>
            <th>{t('rating.componentsTitle')}</th>
            <th className="text-right">{t('rating.value')}</th>
            <th className="text-right">{t('rating.score')}</th>
            <th className="text-right">{t('rating.weight')}</th>
            <th>{t('rating.band')}</th>
          </tr>
        </thead>
        <tbody>
          {rating.components.map((c) => (
            <tr key={c.factor} className={c.status !== 'scored' ? 'opacity-50' : ''}>
              <td>{t(`rating.factors.${c.factor}`, { defaultValue: c.factor })}</td>
              <td>
                <span className="num block">
                  {c.value === null ? EM_DASH : formatAmount(c.value, locale, 3)}
                </span>
              </td>
              <td>
                <span
                  className={`num block ${
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
                </span>
              </td>
              <td>
                <span className="num block">{formatAmount(c.weight, locale, 1)}</span>
              </td>
              <td className="text-slate-500">
                {c.band ? t(`rating.bands.${c.band}`, { defaultValue: c.band }) : EM_DASH}
              </td>
            </tr>
          ))}
          </tbody>
        </Table>
      </div>
    </>
  )
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
  if (assessments.length < 2) return null

  const data = [...assessments]
    .reverse()
    .map((a) => ({
      date: a.created_at.slice(0, 10),
      score: Number(a.rating_score),
      grade: a.rating_grade,
      statement: statements.find((s) => s.id === a.statement_id),
      engine: a.engine_version,
    }))

  return (
    <Card className="p-5">
      <h3 className="mb-3 text-sm font-semibold text-slate-900">{t('rating.historyChart')}</h3>
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} />
            <YAxis
              reversed
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: '#64748b' }}
              width={32}
            />
            <Tooltip
              formatter={(value) => [formatAmount(Number(value), locale, 1), t('rating.score')]}
              labelFormatter={(label, payload) => {
                const point = payload?.[0]?.payload as (typeof data)[number] | undefined
                if (!point) return String(label)
                const period = point.statement ? statementPeriodLabel(point.statement) : ''
                return `${point.date} · ${period} · ${point.grade} · v${point.engine}`
              }}
            />
            <Line
              type="monotone"
              dataKey="score"
              stroke="#4f46e5"
              strokeWidth={2}
              dot={{ r: 3 }}
              label={{
                dataKey: 'grade',
                position: 'top',
                fontSize: 10,
                fill: '#64748b',
              }}
            />
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
  const { t } = useTranslation()
  if (!assessments.length) return null

  const periodOf = (statementId: string): string => {
    const s = statements.find((x) => x.id === statementId)
    return s ? statementPeriodLabel(s) : EM_DASH
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-slate-900">{t('rating.historyTitle')}</h3>
      <Table dense>
        <thead>
          <tr>
            <th>{t('rating.historyDate')}</th>
            <th>{t('rating.statement')}</th>
            <th className="text-right">{t('rating.score')}</th>
            <th>{t('rating.gradeTitle')}</th>
            <th className="text-right">{t('rating.limitTitle')}</th>
            <th>{t('rating.engine')}</th>
          </tr>
        </thead>
        <tbody>
          {assessments.map((a) => (
            <tr key={a.id}>
              <td className="text-slate-500">{a.created_at.slice(0, 16).replace('T', ' ')}</td>
              <td>{periodOf(a.statement_id)}</td>
              <td>
                <span className="num block">{formatAmount(Number(a.rating_score), locale, 1)}</span>
              </td>
              <td>
                <Badge tone={gradeTone(a.rating_grade)}>{a.rating_grade}</Badge>
              </td>
              <td>
                <span className="num block">
                  {formatAmount(Number(a.suggested_limit), locale)} {a.limit_currency}
                </span>
              </td>
              <td className="text-slate-400">{a.engine_version}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}
