/**
 * Buyer dashboard — the Overview tab as a one-screen living report,
 * composed ENTIRELY from existing modules (no new calculations):
 * requisites + compact GradeScale, factor chips, key-figure strip,
 * narrative conclusion and the two dynamics charts. Bullets and chips
 * drill into the relevant tab via the central target mapping (targets.ts).
 * Growth Δ% is computed from original statement-currency values (the
 * dashboard never converts currencies).
 */

import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button, Card, EmptyState, GradeScale } from '../../../components/ui'
import { EM_DASH, formatAmount } from '../../../lib/format'
import { gradeChange, useGradeScale } from '../../../lib/gradeScale'
import { countryFlag } from '../../../lib/countryFlag'
import { refName, useBuyer, useStatements, useUpdateBuyer } from '../api'
import { BuyerFormModal } from '../BuyerFormModal'
import type { StatementBundle } from '../types'
import { statementPeriodLabel } from '../types'
import { findLikeForLikeBase, relativeChange, sortChronological } from '../financials/analysis'
import { buildCashFlowColumns } from '../financials/cashflow'
import { DeltaCell } from '../financials/cells'
import type { LineDirection } from '../financials/lines'
import { buildRiskPeriods } from '../financials/risk'
import { useBuyerExposure } from '../../limits/api'
import type { BuyerExposure } from '../../limits/types'
import { useAssessments } from '../rating/assessmentsApi'
import { buildFactorChips } from '../rating/chips'
import { FactorChipList } from '../rating/FactorChips'
import { ReportModal } from '../rating/ReportModal'
import { DynamicCharts } from '../report/DynamicCharts'
import { buildNarrative } from '../report/narrative'
import { formatNarrativeParams } from '../report/narrativeParams'
import type { BuyerPageTarget } from '../report/targets'
import { factorChipTarget, narrativeTarget, targetSearchParams } from '../report/targets'

export function OverviewTab({ buyerId }: { buyerId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const [, setSearchParams] = useSearchParams()

  const { data: buyer } = useBuyer(buyerId)
  const { data: statements } = useStatements(buyerId)
  const assessments = useAssessments(buyerId)
  const exposure = useBuyerExposure(buyerId)
  const { data: gradeBands } = useGradeScale()

  const [editOpen, setEditOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const updateBuyer = useUpdateBuyer(buyerId)

  // Latest statement sets the discipline: trends never mix report types.
  const all = useMemo(() => sortChronological(statements ?? []), [statements])
  const latest = all[all.length - 1] ?? null
  const sameType = useMemo(
    () => (latest ? all.filter((s) => s.report_type === latest.report_type) : []),
    [all, latest],
  )
  const displayed = useMemo(() => sameType.slice(-3), [sameType])
  const cashFlowColumns = useMemo(() => buildCashFlowColumns(sameType, sameType), [sameType])
  const riskPeriods = useMemo(
    () => buildRiskPeriods(displayed, sameType),
    [displayed, sameType],
  )
  const narrative = useMemo(
    () => buildNarrative({ statements: displayed, all: sameType, riskPeriods, cashFlowColumns }),
    [displayed, sameType, riskPeriods, cashFlowColumns],
  )

  const latestAssessment = assessments.data?.[0] ?? null
  const previousAssessment = assessments.data?.[1] ?? null
  const rating = latestAssessment?.calculation_trace?.rating ?? null
  const change =
    latestAssessment && previousAssessment && gradeBands
      ? gradeChange(
          gradeBands,
          { score: Number(latestAssessment.rating_score), grade: latestAssessment.rating_grade },
          { score: Number(previousAssessment.rating_score), grade: previousAssessment.rating_grade },
        )
      : null
  const chips = rating ? buildFactorChips(rating.components, t, locale) : null

  const goTo = (target: BuyerPageTarget) => setSearchParams(targetSearchParams(target))

  if (!buyer) return null

  const requisites: { label: string; value: React.ReactNode }[] = [
    { label: t('buyers.fields.name'), value: buyer.name },
    { label: t('buyers.fields.legalForm'), value: buyer.legal_form || EM_DASH },
    { label: t('buyers.fields.registrationNumber'), value: buyer.registration_number },
    {
      label: t('buyers.fields.country'),
      value: `${countryFlag(buyer.country_code)} ${refName(buyer.countries, locale)}`,
    },
    { label: t('buyers.fields.industry'), value: refName(buyer.industries, locale) || EM_DASH },
    { label: t('buyers.fields.foundedDate'), value: buyer.founded_date || EM_DASH },
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Header row: requisites + grade summary */}
      <div className="grid items-start gap-5 lg:grid-cols-[1fr_auto]">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">{t('buyers.basicInfo')}</h2>
            <Button variant="secondary" size="sm" onClick={() => setEditOpen(true)}>
              {t('common.edit')}
            </Button>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            {requisites.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-slate-500">{row.label}</dt>
                <dd className="text-slate-800">{row.value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="flex flex-col gap-3 p-5 lg:min-w-72">
          <h2 className="text-sm font-semibold text-slate-900">
            {t('buyers.ratingSummary.title')}
          </h2>
          {latestAssessment ? (
            <GradeScale
              score={Number(latestAssessment.rating_score)}
              grade={latestAssessment.rating_grade}
              bands={gradeBands}
              change={change}
              size="compact"
            />
          ) : all.length > 0 ? (
            <div className="flex flex-col items-start gap-2">
              <p className="text-[13px] text-slate-500">{t('buyers.overview.noAssessmentHint')}</p>
              <Button size="sm" onClick={() => goTo({ tab: 'rating' })}>
                {t('buyers.overview.calculateRating')}
              </Button>
            </div>
          ) : (
            <p className="text-[13px] text-slate-500">{t('buyers.ratingSummary.pending')}</p>
          )}
          <Button variant="secondary" size="sm" onClick={() => setReportOpen(true)}>
            {t('rating.generateReport')}
          </Button>
        </Card>
      </div>

      {all.length === 0 ? (
        /* No statements: nothing below can be computed. */
        <EmptyState
          title={t('fin.noStatements')}
          hint={t('fin.noStatementsHint')}
          action={
            <Link to={`/buyers/${buyerId}/statements/new`}>
              <Button>{t('fin.addStatement')}</Button>
            </Link>
          }
        />
      ) : (
        <>
          {/* 2. Strengths / weaknesses chips */}
          {chips && (chips.strengths.length > 0 || chips.weaknesses.length > 0) && (
            <Card className="grid gap-3 p-5 lg:grid-cols-2">
              <div>
                <h4 className="mb-1.5 text-[13px] font-semibold text-slate-600">
                  {t('rating.strengths')}
                </h4>
                <FactorChipList
                  chips={chips.strengths}
                  onChipClick={() => goTo(factorChipTarget())}
                />
              </div>
              <div>
                <h4 className="mb-1.5 text-[13px] font-semibold text-slate-600">
                  {t('rating.weaknesses')}
                </h4>
                <FactorChipList
                  chips={chips.weaknesses}
                  onChipClick={() => goTo(factorChipTarget())}
                />
              </div>
            </Card>
          )}

          {/* 3. Key figures strip */}
          <KeyFigures
            latest={latest}
            sameType={sameType}
            cashFlowColumns={cashFlowColumns}
            latestAssessment={latestAssessment}
            previousAssessment={previousAssessment}
            exposure={exposure.data ?? null}
          />

          {/* 4. Conclusion (narrative bullets, clickable) */}
          {narrative.length > 0 && (
            <Card className="p-5">
              <h2 className="mb-2 text-sm font-semibold text-slate-900">
                {t('report.sections.conclusion')}
              </h2>
              <ul className="flex flex-col gap-1 text-sm leading-relaxed">
                {narrative.map((bullet) => (
                  <li key={bullet.key} className="flex">
                    <button
                      type="button"
                      onClick={() => goTo(narrativeTarget(bullet.key))}
                      className="cursor-pointer text-left underline-offset-2 transition-colors before:mr-2 before:text-slate-400 before:content-['•'] hover:text-accent-700 hover:underline"
                    >
                      {t(`report.narrative.${bullet.key}`, formatNarrativeParams(bullet, t, locale))}
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* 5. Dynamics charts (responsive) */}
          {sameType.length >= 2 && <DynamicCharts statements={sameType} variant="screen" />}
        </>
      )}

      <BuyerFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initial={buyer}
        onSubmit={async (input) => {
          await updateBuyer.mutateAsync(input)
        }}
      />
      <ReportModal open={reportOpen} onClose={() => setReportOpen(false)} buyerId={buyerId} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Key figures strip: values from the latest statement (statement currency),
// Δ% vs like-for-like prior period from ORIGINAL values. Missing → hidden.
// ---------------------------------------------------------------------------

interface KeyFigure {
  key: string
  label: string
  value: number
  /** e.g. "UZS · '000" or the limit currency. */
  caption: string
  delta: number | null
  deltaLabel: string | null
  direction: LineDirection
}

function KeyFigures({
  latest,
  sameType,
  cashFlowColumns,
  latestAssessment,
  previousAssessment,
  exposure,
}: {
  latest: StatementBundle | null
  sameType: StatementBundle[]
  cashFlowColumns: ReturnType<typeof buildCashFlowColumns>
  latestAssessment: { suggested_limit: number; limit_currency: string } | null
  previousAssessment: { suggested_limit: number; limit_currency: string } | null
  exposure: BuyerExposure | null
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  if (!latest) return null

  const figures: KeyFigure[] = []
  const unitCaption = `${latest.currency_code} · ${t(`fin.unitsShort.${latest.unit}`)}`

  // P&L flows: like-for-like prior-year base; BS stocks: previous statement.
  const pnlBase = findLikeForLikeBase(latest, sameType)
  const stockBase = sameType.length >= 2 ? sameType[sameType.length - 2] : null

  const push = (
    key: string,
    label: string,
    value: number | null | undefined,
    base: { value: number | null | undefined; label: string } | null,
  ) => {
    if (value === null || value === undefined) return // hidden, never zeros
    const delta = base ? relativeChange(value, base.value ?? null) : null
    figures.push({
      key,
      label,
      value,
      caption: unitCaption,
      delta,
      deltaLabel: delta !== null && base ? base.label : null,
      direction: 'up_good',
    })
  }

  push('revenue', t('fin.lines.revenue'), latest.income_statements?.revenue, pnlBase && {
    value: pnlBase.income_statements?.revenue,
    label: statementPeriodLabel(pnlBase),
  })
  push('total_assets', t('fin.lines.total_assets'), latest.balance_sheets?.total_assets, stockBase && {
    value: stockBase.balance_sheets?.total_assets,
    label: statementPeriodLabel(stockBase),
  })
  push('total_equity', t('fin.lines.total_equity'), latest.balance_sheets?.total_equity, stockBase && {
    value: stockBase.balance_sheets?.total_equity,
    label: statementPeriodLabel(stockBase),
  })
  push('net_profit', t('fin.lines.net_profit'), latest.income_statements?.net_profit, pnlBase && {
    value: pnlBase.income_statements?.net_profit,
    label: statementPeriodLabel(pnlBase),
  })

  // CFO — only when a consecutive-pair column exists for the latest period.
  const cfoIndex = cashFlowColumns.findIndex((c) => c.statement.id === latest.id)
  const cfoColumn = cfoIndex >= 0 ? cashFlowColumns[cfoIndex] : null
  if (cfoColumn && cfoColumn.operating.some((l) => l.hasData)) {
    const prevColumn = cfoIndex > 0 ? cashFlowColumns[cfoIndex - 1] : null
    push('cfo', t('buyers.overview.cfo'), cfoColumn.cfo, prevColumn && {
      value: prevColumn.cfo,
      label: statementPeriodLabel(prevColumn.statement),
    })
  }

  if (latestAssessment) {
    const sameCcy =
      previousAssessment && previousAssessment.limit_currency === latestAssessment.limit_currency
    figures.push({
      key: 'suggested_limit',
      label: t('rating.limitTitle'),
      value: Number(latestAssessment.suggested_limit),
      caption: latestAssessment.limit_currency,
      delta: sameCcy
        ? relativeChange(
            Number(latestAssessment.suggested_limit),
            Number(previousAssessment.suggested_limit),
          )
        : null,
      deltaLabel: null,
      direction: 'up_good',
    })
  }

  // Approved aggregate exposure across policies (v_buyer_exposure, UZS).
  if (exposure?.exposure_uzs != null) {
    figures.push({
      key: 'exposure',
      label: t('buyers.overview.exposure'),
      value: Number(exposure.exposure_uzs),
      caption:
        exposure.missing_rates > 0
          ? `UZS · ${t('limits.missingRates', { count: exposure.missing_rates })}`
          : `UZS · ${t('buyers.overview.exposurePolicies', { count: exposure.policies_count })}`,
      delta: null,
      deltaLabel: null,
      direction: 'up_good',
    })
  }

  if (!figures.length) return null

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {figures.map((figure) => (
        <Card key={figure.key} className="flex flex-col gap-1 p-4">
          <p className="text-xs text-slate-500">{figure.label}</p>
          <p>
            <span
              className={`num text-lg font-semibold ${
                figure.value < 0 ? 'text-neg-500' : 'text-slate-900'
              }`}
            >
              {formatAmount(figure.value, locale)}
            </span>
          </p>
          <p className="text-xs text-slate-400">{figure.caption}</p>
          {figure.delta !== null && (
            <div className="flex items-center gap-1.5 text-xs">
              <span className="w-fit">
                <DeltaCell value={figure.delta} direction={figure.direction} />
              </span>
              {figure.deltaLabel && (
                <span className="text-slate-400">
                  {t('buyers.overview.vsPrior', { period: figure.deltaLabel })}
                </span>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  )
}
