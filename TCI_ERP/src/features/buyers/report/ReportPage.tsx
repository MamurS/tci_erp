/**
 * Risk Report: print-optimized route /buyers/:id/report?lang=&type=&ccy=.
 * Clean paginated A4 HTML generated to PDF via the browser print dialog.
 * Report language is independent of the UI language (i18n getFixedT).
 */

import { useMemo } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button, Spinner } from '../../../components/ui'
import { GradeScale } from '../../../components/ui/GradeScale'
import { EM_DASH, formatAmount, formatPercent, formatRatio } from '../../../lib/format'
import { gradeChange, useGradeScale } from '../../../lib/gradeScale'
import { refName, useBuyer, useStatements } from '../api'
import type { StatementBundle } from '../types'
import { statementPeriodLabel } from '../types'
import {
  applyDisplayCurrency,
  balanceSheetColumns,
  incomeStatementColumns,
  relativeChange,
  sortChronological,
  verticalShare,
} from '../financials/analysis'
import { buildCashFlowColumns, hasPersistentNegativeCfo } from '../financials/cashflow'
import { convertStatements, requiredRates, rateKey } from '../financials/fx'
import type { DisplayCurrency } from '../financials/fx'
import { useFxRates } from '../financials/fxApi'
import { BALANCE_SHEET_SECTIONS, INCOME_STATEMENT_SECTIONS, bsVerticalBase } from '../financials/lines'
import type { SectionDef } from '../financials/lines'
import { RATIO_DEFS, computeRatios } from '../financials/ratios'
import { RISK_ROWS, buildRiskPeriods } from '../financials/risk'
import { useBuyerExposure } from '../../limits/api'
import { useAssessments } from '../rating/assessmentsApi'
import { buildFactorChips } from '../rating/chips'
import { FactorChipList } from '../rating/FactorChips'
import { DynamicCharts } from './DynamicCharts'
import { buildNarrative } from './narrative'
import { formatNarrativeParams } from './narrativeParams'

export function ReportPage() {
  const { id = '' } = useParams()
  const [searchParams] = useSearchParams()
  const lang = ['en', 'ru', 'uz'].includes(searchParams.get('lang') ?? '')
    ? (searchParams.get('lang') as string)
    : 'ru'
  const reportType = searchParams.get('type') === 'management' ? 'management' : 'statutory'
  const ccyParam = searchParams.get('ccy')
  const displayCurrency: DisplayCurrency =
    ccyParam === 'UZS' || ccyParam === 'USD' || ccyParam === 'EUR' ? ccyParam : 'original'

  const { i18n } = useTranslation()
  const t = useMemo(() => i18n.getFixedT(lang), [i18n, lang])
  const locale = lang

  const { data: buyer, isLoading: buyerLoading } = useBuyer(id)
  const { data: statements, isLoading: stLoading } = useStatements(id)
  const { data: gradeBands } = useGradeScale()

  const assessments = useAssessments(id)
  const exposure = useBuyerExposure(id)

  const all = useMemo(() => statements ?? [], [statements])
  const sameType = useMemo(
    () => sortChronological(all.filter((s) => s.report_type === reportType)),
    [all, reportType],
  )
  const displayedRaw = useMemo(() => sameType.slice(-3), [sameType])

  const rateNeeds = useMemo(
    () => (displayCurrency === 'original' ? [] : requiredRates(sameType, displayCurrency)),
    [sameType, displayCurrency],
  )
  const { data: rates } = useFxRates(rateNeeds)
  const rateFor = useMemo(
    () => (ccy: string, date: string) => rates?.[rateKey(ccy, date)] ?? null,
    [rates],
  )

  const convertedAll = useMemo(
    () => convertStatements(sameType, displayCurrency, rateFor),
    [sameType, displayCurrency, rateFor],
  )
  const converted = useMemo(
    () => convertStatements(displayedRaw, displayCurrency, rateFor),
    [displayedRaw, displayCurrency, rateFor],
  )
  const displayed = converted.statements
  const allConverted = convertedAll.statements

  const cashFlowColumns = useMemo(
    () => buildCashFlowColumns(allConverted, allConverted),
    [allConverted],
  )
  const riskPeriods = useMemo(
    () => buildRiskPeriods(displayed, allConverted),
    [displayed, allConverted],
  )
  const narrative = useMemo(
    () =>
      buildNarrative({
        statements: displayed,
        all: allConverted,
        riskPeriods,
        cashFlowColumns,
        // Growth %: always from original statement-currency values.
        originalAll: sameType,
      }),
    [displayed, allConverted, riskPeriods, cashFlowColumns, sameType],
  )

  if (buyerLoading || stLoading) return <Spinner label="…" />
  if (!buyer) return null

  const latestAssessment = assessments.data?.[0] ?? null
  const previousAssessment = assessments.data?.[1] ?? null
  const rating = latestAssessment?.calculation_trace?.rating ?? null
  const change =
    latestAssessment && previousAssessment && gradeBands
      ? gradeChange(
          gradeBands,
          {
            score: Number(latestAssessment.rating_score),
            grade: latestAssessment.rating_grade,
          },
          {
            score: Number(previousAssessment.rating_score),
            grade: previousAssessment.rating_grade,
          },
        )
      : null
  const chips = rating ? buildFactorChips(rating.components, t, locale) : null
  const reportDate = new Date().toISOString().slice(0, 10)
  const latestRisk = riskPeriods[riskPeriods.length - 1] ?? null

  return (
    <div className="report-root min-h-screen bg-white text-slate-900">
      {/* Screen-only toolbar */}
      <div className="no-print sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <Link to={`/buyers/${id}?tab=rating`} className="text-sm text-accent-700 hover:underline">
          ← {t('report.backToBuyer')}
        </Link>
        <Button onClick={() => window.print()}>{t('report.print')}</Button>
      </div>

      {/* Single-cell layout table: the repeating tfoot reserves a bottom band
       * on EVERY printed page so content never collides with the fixed
       * footer (Chrome prints fixed elements inside the page area). */}
      <div className="mx-auto max-w-[210mm] p-8 print:p-0">
        <table className="report-layout">
          <tbody>
            <tr>
              <td>
        {/* 1. Cover / general information */}
        <section className="report-section">
          <p className="text-xs font-semibold tracking-[0.3em] text-accent-700">
            {t('report.title')}
          </p>
          <h1 className="mt-1 text-2xl font-bold">{buyer.name}</h1>
          <p className="text-sm text-slate-500">
            {t('report.reportDate')}: {reportDate}
          </p>

          <h2 className="report-h2">{t('report.generalInfo')}</h2>
          <dl className="grid grid-cols-[240px_1fr] gap-y-1.5 text-sm">
            <dt className="text-slate-500">{t('buyers.fields.legalForm')}</dt>
            <dd>{buyer.legal_form ?? EM_DASH}</dd>
            <dt className="text-slate-500">{t('buyers.fields.registrationNumber')}</dt>
            <dd>{buyer.registration_number}</dd>
            <dt className="text-slate-500">{t('buyers.fields.country')}</dt>
            <dd>{refName(buyer.countries, locale)}</dd>
            <dt className="text-slate-500">{t('buyers.fields.industry')}</dt>
            <dd>{refName(buyer.industries, locale) || EM_DASH}</dd>
            <dt className="text-slate-500">{t('buyers.fields.foundedDate')}</dt>
            <dd>{buyer.founded_date ?? EM_DASH}</dd>
            {latestAssessment && (
              <>
                <dt className="text-slate-500">{t('report.calculatedLimit')}</dt>
                <dd>
                  <span className="num font-semibold">
                    {formatAmount(Number(latestAssessment.suggested_limit), locale)}{' '}
                    {latestAssessment.limit_currency}
                  </span>
                  <span className="ml-2 text-xs text-slate-400">
                    {t('report.limitDisclaimer')}
                  </span>
                </dd>
              </>
            )}
            {exposure.data?.exposure_uzs != null && (
              <>
                <dt className="text-slate-500">{t('report.approvedAggregateLimit')}</dt>
                <dd>
                  <span className="num font-semibold">
                    {formatAmount(Number(exposure.data.exposure_uzs), locale, 0)} UZS
                  </span>
                </dd>
              </>
            )}
          </dl>

          {latestAssessment ? (
            <div className="mt-5">
              <GradeScale
                score={Number(latestAssessment.rating_score)}
                grade={latestAssessment.rating_grade}
                bands={gradeBands}
                change={change}
              />
              {chips && (
                <div className="mt-4 grid grid-cols-2 gap-3">
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
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">{t('report.noAssessment')}</p>
          )}
        </section>

        {/* 2. Conclusion */}
        {narrative.length > 0 && (
          <section className="report-section">
            <h2 className="report-h2">{t('report.sections.conclusion')}</h2>
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed">
              {narrative.map((bullet) => (
                <li key={bullet.key}>
                  {t(`report.narrative.${bullet.key}`, formatNarrativeParams(bullet, t, locale))}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* 3-4. Statement tables */}
        <section className="report-section">
          <h2 className="report-h2">{t('report.sections.balanceSheet')}</h2>
          <StatementTable
            t={t}
            locale={locale}
            columns={applyDisplayCurrency(balanceSheetColumns(displayedRaw), displayed)}
            sections={BALANCE_SHEET_SECTIONS}
            getValues={(s) => s.balance_sheets}
            verticalBaseFor={bsVerticalBase}
          />
        </section>

        <section className="report-section">
          <h2 className="report-h2">{t('report.sections.pnl')}</h2>
          <StatementTable
            t={t}
            locale={locale}
            columns={applyDisplayCurrency(incomeStatementColumns(displayedRaw, sameType), displayed)}
            sections={INCOME_STATEMENT_SECTIONS}
            getValues={(s) => s.income_statements}
            verticalBaseFor={() => 'revenue'}
          />
        </section>

        {/* 5. Ratios */}
        <section className="report-section">
          <h2 className="report-h2">{t('report.sections.ratios')}</h2>
          <RatioReportTable t={t} locale={locale} displayed={displayed} />
        </section>

        {/* 6. Risk summary */}
        <section className="report-section">
          <h2 className="report-h2">{t('report.sections.riskSummary')}</h2>
          <RiskSummary
            t={t}
            latestRisk={latestRisk}
            negativeCfo={hasPersistentNegativeCfo(cashFlowColumns)}
          />
        </section>

        {/* 7. Dynamic graphs */}
        {allConverted.length >= 2 && (
          <section className="report-section">
            <h2 className="report-h2">{t('report.sections.dynamicGraphs')}</h2>
            <DynamicCharts statements={allConverted} variant="print" t={t} />
          </section>
        )}

        {/* FX footnotes */}
        {displayCurrency !== 'original' && (
          <p className="mt-4 text-xs text-slate-400">{t('fin.fx.growthFootnote')}</p>
        )}
        {displayCurrency !== 'original' && converted.footnotes.length > 0 && (
          <p className="mt-4 text-xs text-slate-400">
            {t('report.fxFootnote')}:{' '}
            {converted.footnotes
              .map(
                (f) =>
                  `${statementPeriodLabel(f.statement)}: ${f.rates
                    .map(
                      (r) =>
                        `${r.currency_code} = ${formatAmount(r.rate_to_uzs, locale, 2)} UZS (${r.rate_date})`,
                    )
                    .join(', ')}`,
              )
              .join('; ')}
          </p>
        )}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>
                <div className="report-footer-space" />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Print footer (repeats on each printed page) */}
      <div className="report-footer">
        {buyer.name} · {reportDate} · {t('report.generatedBy')}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Tf = ReturnType<typeof useTranslation>['t']

// ---------------------------------------------------------------------------
// Statement table (amounts + % of base, compact for print)
// ---------------------------------------------------------------------------

type Values = Partial<Record<string, number | null>> | null

function StatementTable<K extends string>({
  t,
  locale,
  columns,
  sections,
  getValues,
  verticalBaseFor,
}: {
  t: Tf
  locale: string
  columns: { statement: StatementBundle }[]
  sections: SectionDef<K>[]
  getValues: (s: StatementBundle) => Values
  verticalBaseFor: (key: K) => string
}) {
  const valueOf = (s: StatementBundle, key: K): number | null =>
    (getValues(s)?.[key] as number | null | undefined) ?? null

  return (
    <table className="report-table">
      <thead>
        <tr>
          <th className="text-left">{t('fin.lineHeader')}</th>
          {columns.map((c) => (
            <th key={c.statement.id} colSpan={2} className="border-l border-slate-200 text-center">
              {statementPeriodLabel(c.statement)}
              <span className="ml-1 font-normal text-slate-400">
                {c.statement.currency_code}
              </span>
            </th>
          ))}
        </tr>
        <tr className="text-[10px] font-normal text-slate-400">
          <th />
          {columns.map((c) => (
            <>
              <th key={`${c.statement.id}-a`} className="border-l border-slate-200 text-right">
                {t('fin.amount')}
              </th>
              <th key={`${c.statement.id}-s`} className="text-right">
                {t('fin.shareOfBase')}
              </th>
            </>
          ))}
        </tr>
      </thead>
      <tbody>
        {sections.map((section) =>
          section.lines
            .filter((line) => columns.some((c) => valueOf(c.statement, line.key) !== null))
            .map((line) => (
              <tr
                key={line.key}
                className={
                  line.level === 'grand'
                    ? 'bg-slate-100 font-semibold'
                    : line.level === 'subtotal'
                      ? 'bg-slate-50 font-medium'
                      : ''
                }
              >
                <td>{t(`fin.lines.${line.key}`)}</td>
                {columns.map((c) => {
                  const value = valueOf(c.statement, line.key)
                  const base = valueOf(c.statement, verticalBaseFor(line.key) as K)
                  return (
                    <>
                      <td key={`${c.statement.id}-a`} className="border-l border-slate-100">
                        <span className={`num block ${value !== null && value < 0 ? 'text-neg-500' : ''}`}>
                          {value === null ? EM_DASH : formatAmount(value, locale)}
                        </span>
                      </td>
                      <td key={`${c.statement.id}-s`}>
                        <span className="num block text-slate-400">
                          {formatPercent(verticalShare(value, base), locale)}
                        </span>
                      </td>
                    </>
                  )
                })}
              </tr>
            )),
        )}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Ratio table with Δ per period
// ---------------------------------------------------------------------------

function RatioReportTable({
  t,
  locale,
  displayed,
}: {
  t: Tf
  locale: string
  displayed: StatementBundle[]
}) {
  const sets = displayed.map((s) =>
    computeRatios(s.statement_kind, s.balance_sheets, s.income_statements),
  )

  const fmt = (format: 'percent' | 'ratio' | 'days', value: number | null): string => {
    if (value === null) return EM_DASH
    if (format === 'percent') return formatPercent(value, locale)
    if (format === 'days') return formatAmount(value, locale, 0)
    return formatRatio(value, locale)
  }

  const groups = ['profitability', 'solvency', 'efficiency'] as const

  return (
    <table className="report-table">
      <thead>
        <tr>
          <th className="text-left">{t('fin.ratioHeader')}</th>
          {displayed.map((s) => (
            <>
              <th key={`${s.id}-v`} className="border-l border-slate-200 text-right">
                {statementPeriodLabel(s)}
              </th>
              <th key={`${s.id}-d`} className="text-right text-[10px] font-normal text-slate-400">
                Δ%
              </th>
            </>
          ))}
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <>
            <tr key={group}>
              <td
                colSpan={1 + displayed.length * 2}
                className="pt-2 text-[10px] font-semibold tracking-wide text-slate-400 uppercase"
              >
                {t(`fin.ratioGroups.${group}`)}
              </td>
            </tr>
            {RATIO_DEFS.filter((d) => d.group === group).map((def) => (
              <tr key={def.key}>
                <td>{t(`fin.ratios.${def.key}`)}</td>
                {displayed.map((s, idx) => {
                  const value = sets[idx][def.key].value
                  const prev = idx > 0 ? sets[idx - 1][def.key].value : null
                  const delta = relativeChange(value, prev)
                  return (
                    <>
                      <td key={`${s.id}-v`} className="border-l border-slate-100">
                        <span className="num block">{fmt(def.format, value)}</span>
                      </td>
                      <td key={`${s.id}-d`}>
                        <span
                          className={`num block text-[10px] ${
                            delta === null || Math.abs(delta) < 0.0005
                              ? 'text-slate-300'
                              : delta > 0
                                ? 'text-pos-500'
                                : 'text-neg-500'
                          }`}
                        >
                          {delta === null ? EM_DASH : formatPercent(delta, locale)}
                        </span>
                      </td>
                    </>
                  )
                })}
              </tr>
            ))}
          </>
        ))}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// Risk summary
// ---------------------------------------------------------------------------

function RiskSummary({
  t,
  latestRisk,
  negativeCfo,
}: {
  t: Tf
  latestRisk: ReturnType<typeof buildRiskPeriods>[number] | null
  negativeCfo: boolean
}) {
  if (!latestRisk) return null
  const breached = RISK_ROWS.filter((row) => latestRisk.breaches[row.key])

  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
      {latestRisk.zBand && (
        <li>
          {t('report.risk.zZone')}: <strong>{t(`fin.risk.bands.${latestRisk.zBand}`)}</strong>
        </li>
      )}
      <li>
        {breached.length
          ? `${t('report.risk.breaches')}: ${breached
              .map((row) => t(`fin.risk.rows.${row.key}`))
              .join(', ')}`
          : t('report.risk.noBreaches')}
      </li>
      {negativeCfo && <li className="text-neg-500">{t('report.risk.negativeCfo')}</li>}
    </ul>
  )
}

