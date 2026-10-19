/**
 * Risk Report: /entities/:id/report?lang=&type=&ccy=
 *
 * One document for the screen and for the PDF, laid out like the reference
 * credit-risk report: running header, general information beside the rating
 * gauge, the scale legend, key figures, conclusion and overall assessment,
 * then the group's key companies, the company and COMBINED group statements
 * with commentary, ratio tables, dynamics, glossary, group structure and
 * the disclaimer. Print gives the same page through report.css: the header
 * repeats on every page and the footer is drawn in the @page margin boxes
 * with "page x of y".
 *
 * The report language is independent of the UI language (getFixedT). Every
 * figure comes from report/model.ts (pure, tested); every sentence from
 * narrative.ts or commentary.ts through i18n templates.
 */

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Trans } from 'react-i18next'
import { useFixedT } from '../../../i18n/useFixedT'
import type { TFunction } from 'i18next'
import { ArrowLeft, Printer } from 'lucide-react'

import { BrandMark, RatingGauge, RatingLegend, Spinner } from '../../../components/ui'
import { BRAND } from '../../../lib/brand'
import {
  EM_DASH,
  formatAmount,
  formatCompact,
  formatLongDate,
  formatPercent,
  formatRatio,
  formatSignedPercent,
} from '../../../lib/format'
import { SCALE_LABEL_KEYS, placeScore } from '../../../lib/ratingScale'
import type { ScalePoint } from '../../../lib/ratingScale'
import { refName, useEntity, useStatements } from '../api'
import { statementPeriodLabel } from '../types'
import type { StatementBundle } from '../types'
import { buildCashFlowColumns, hasPersistentNegativeCfo } from '../financials/cashflow'
import { convertStatements, rateKey, requiredRates } from '../financials/fx'
import type { DisplayCurrency } from '../financials/fx'
import { useFxRates } from '../financials/fxApi'
import { RISK_ROWS, buildRiskPeriods } from '../financials/risk'
import { useBuyerExposure } from '../../limits/api'
import { useEntityGroup } from '../../groups/api'
import { useAssessments } from '../rating/assessmentsApi'
import { buildFactorBullets } from '../rating/chips'
import type { FactorBullet } from '../rating/chips'
import { useMemberEntities, useMemberStatements, useOwners } from './api'
import type { CommentaryParagraph, CommentarySentence, ValueFormat } from './commentary'
import { buildCommentary } from './commentary'
import { DynamicCharts } from './DynamicCharts'
import {
  BS_REPORT_ROWS,
  PL_REPORT_ROWS,
  annualSeries,
  bsBase,
  combineGroupSeries,
  isStale,
  keyFigures,
  memberFigures,
  plBase,
  ratioTables,
  statementRows,
} from './model'
import type { KeyFigure, MemberInfo } from './model'
import { buildNarrative } from './narrative'
import { formatNarrativeParams } from './narrativeParams'
import { pageCounterContent, cssString } from './printRules'
import { ReportGroupSection } from './ReportGroupSection'
import {
  GroupKeyCompanies,
  GroupStructureTable,
  RatioReportTable,
  StatementReportTable,
} from './ReportTables'
import './report.css'

type Lang = 'en' | 'ru' | 'uz'

export function ReportPage() {
  const { id = '' } = useParams()
  const [searchParams] = useSearchParams()
  const langParam = searchParams.get('lang')
  const lang: Lang = langParam === 'en' || langParam === 'uz' ? langParam : 'ru'
  const reportType = searchParams.get('type') === 'management' ? 'management' : 'statutory'
  const ccyParam = searchParams.get('ccy')
  const displayCurrency: DisplayCurrency =
    ccyParam === 'UZS' || ccyParam === 'USD' || ccyParam === 'EUR' ? ccyParam : 'original'

  const { t, ready: languageReady } = useFixedT(lang)
  const locale = lang

  const { data: entity, isLoading: entityLoading } = useEntity(id)
  const { data: statements, isLoading: statementsLoading } = useStatements(id)
  const assessments = useAssessments(id)
  const exposure = useBuyerExposure(id)
  const owners = useOwners(id)

  const group = useEntityGroup(id)
  const memberIds = useMemo(() => (group.data ?? []).map((m) => m.member_id), [group.data])
  const parentId = group.data?.[0]?.ultimate_parent_id ?? id
  const hasGroup = memberIds.length > 1
  const memberEntities = useMemberEntities(memberIds)
  const memberStatements = useMemberStatements(memberIds)

  // ---- company series (original currency, whole units) -------------------
  const companyAll = useMemo(
    () => annualSeries(statements ?? [], reportType),
    [statements, reportType],
  )
  const company = useMemo(() => companyAll.slice(-3), [companyAll])
  const latest = company[company.length - 1] ?? null
  const baseCurrency = latest?.currency_code ?? ''

  // ---- group COMBINED series, aligned to the company's years --------------
  const combined = useMemo(
    () =>
      hasGroup && baseCurrency
        ? combineGroupSeries(memberStatements.data ?? [], reportType, baseCurrency, parentId)
        : null,
    [hasGroup, baseCurrency, memberStatements.data, reportType, parentId],
  )
  const groupAll = useMemo(() => combined?.series ?? [], [combined])
  const groupSeries = useMemo(() => {
    const years = new Set(company.map((s) => s.fiscal_year))
    return groupAll.filter((s) => years.has(s.fiscal_year))
  }, [groupAll, company])

  // ---- display currency: amounts converted, every change read from the original
  const rateNeeds = useMemo(
    () =>
      displayCurrency === 'original'
        ? []
        : requiredRates([...companyAll, ...groupAll], displayCurrency),
    [companyAll, groupAll, displayCurrency],
  )
  const { data: rates } = useFxRates(rateNeeds)
  const rateFor = useMemo(
    () => (ccy: string, date: string) => rates?.[rateKey(ccy, date)] ?? null,
    [rates],
  )
  const convert = useMemo(
    () => (list: StatementBundle[]) => convertStatements(list, displayCurrency, rateFor),
    [displayCurrency, rateFor],
  )
  const companyAllShown = useMemo(() => convert(companyAll).statements, [convert, companyAll])
  const companyConverted = useMemo(() => convert(company), [convert, company])
  const companyShown = companyConverted.statements
  const groupAllShown = useMemo(() => convert(groupAll).statements, [convert, groupAll])
  const groupShown = useMemo(() => convert(groupSeries).statements, [convert, groupSeries])
  const currency = displayCurrency === 'original' ? baseCurrency : displayCurrency

  // ---- derived content ----------------------------------------------------
  const bsCompany = useMemo(
    () => statementRows(company, BS_REPORT_ROWS, bsBase, companyShown),
    [company, companyShown],
  )
  const plCompany = useMemo(
    () => statementRows(company, PL_REPORT_ROWS, plBase, companyShown),
    [company, companyShown],
  )
  const bsGroup = useMemo(
    () => statementRows(groupSeries, BS_REPORT_ROWS, bsBase, groupShown),
    [groupSeries, groupShown],
  )
  const plGroup = useMemo(
    () => statementRows(groupSeries, PL_REPORT_ROWS, plBase, groupShown),
    [groupSeries, groupShown],
  )
  const figures = useMemo(() => keyFigures(company, companyShown), [company, companyShown])
  const ratiosCompany = useMemo(
    () => ratioTables(company, companyAll, companyShown, companyAllShown),
    [company, companyAll, companyShown, companyAllShown],
  )
  const ratiosGroup = useMemo(
    () => ratioTables(groupSeries, groupAll, groupShown, groupAllShown),
    [groupSeries, groupAll, groupShown, groupAllShown],
  )
  const commentaryInput = useMemo(
    () => ({
      company,
      companyDisplay: companyShown,
      group: groupSeries,
      groupDisplay: groupShown,
    }),
    [company, companyShown, groupSeries, groupShown],
  )
  const bsCommentary = useMemo(
    () => buildCommentary('balanceSheet', commentaryInput),
    [commentaryInput],
  )
  const plCommentary = useMemo(() => buildCommentary('pnl', commentaryInput), [commentaryInput])
  const ratioCommentary = useMemo(
    () => buildCommentary('ratios', commentaryInput),
    [commentaryInput],
  )

  const cashFlowColumns = useMemo(
    () => buildCashFlowColumns(companyAllShown, companyAllShown),
    [companyAllShown],
  )
  const riskPeriods = useMemo(
    () => buildRiskPeriods(companyShown, companyAllShown),
    [companyShown, companyAllShown],
  )
  const narrative = useMemo(
    () =>
      buildNarrative({
        statements: companyShown,
        all: companyAllShown,
        riskPeriods,
        cashFlowColumns,
        originalAll: companyAll,
      }),
    [companyShown, companyAllShown, riskPeriods, cashFlowColumns, companyAll],
  )

  const members = useMemo(() => {
    const info: MemberInfo[] = (memberEntities.data ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      registration_number: m.registration_number ?? '',
      industry: m.industries ? refName(m.industries, locale) : null,
    }))
    return baseCurrency
      ? memberFigures(info, memberStatements.data ?? [], reportType, baseCurrency)
      : []
  }, [memberEntities.data, memberStatements.data, reportType, baseCurrency, locale])

  if (entityLoading || statementsLoading || !languageReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (!entity) return null

  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)
  const reportDate = formatLongDate(today, locale)
  const latestAssessment = assessments.data?.[0] ?? null
  const previousAssessment = assessments.data?.[1] ?? null
  const score = latestAssessment ? Number(latestAssessment.rating_score) : null
  const rating = latestAssessment?.calculation_trace?.rating ?? null
  const bullets = rating ? buildFactorBullets(rating.components, t, locale) : []
  const stale = latest ? isStale(latest.period_end_date, todayIso) : false
  const latestYear = latest?.fiscal_year ?? null
  const showGroupTables = hasGroup && members.length > 1 && latestYear !== null

  const money = (v: number | null) =>
    v === null ? EM_DASH : `${formatCompact(v, locale, 2)} ${currency}`

  return (
    <div className="rpt min-h-screen" lang={lang}>
      <PrintPageRules t={t} />

      <div className="rpt-toolbar">
        <Link
          to={`/entities/${id}?tab=rating`}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] text-white/85 hover:bg-white/10 hover:text-white"
        >
          <ArrowLeft className="size-4" />
          {t('report.backToBuyer')}
        </Link>
        <div className="flex-1 truncate text-center font-display text-[15px] tracking-wide uppercase">
          {entity.name}
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand-orange px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm hover:brightness-105"
        >
          <Printer className="size-4" />
          {t('report.print')}
        </button>
      </div>

      <div className="rpt-viewport">
        <article className="rpt-sheet">
          <table className="rpt-layout">
            <thead>
              <tr>
                <td>
                  <ReportHeader
                    t={t}
                    name={entity.name}
                    registration={entity.registration_number}
                    date={reportDate}
                  />
                </td>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  {/* 1. General information ---------------------------------- */}
                  <section className="rpt-section" style={{ marginTop: 4 }}>
                    <h2 className="rpt-h2">{t('report.sections2.generalInfo')}</h2>
                    <div className="rpt-general">
                      <table className="rpt-kv">
                        <tbody>
                          <Kv label={t('report.general.companyName')} strong>
                            {entity.name}
                          </Kv>
                          {entity.legal_form && (
                            <Kv label={t('report.general.legalForm')}>{entity.legal_form}</Kv>
                          )}
                          <Kv label={t('report.general.registrationDate')} strong>
                            {entity.founded_date ?? EM_DASH}
                          </Kv>
                          <Kv label={t('report.general.country')}>
                            {refName(entity.countries, locale) || EM_DASH}
                          </Kv>
                          <Kv label={t('report.general.owners')}>
                            {owners.data && owners.data.length > 0
                              ? owners.data.map((o) => ownerText(o, locale)).join('; ')
                              : EM_DASH}
                          </Kv>
                          <Kv label={t('report.general.lineOfBusiness')}>
                            {refName(entity.industries, locale) || EM_DASH}
                          </Kv>
                          <Kv label={t('report.general.registrationCodes')}>{''}</Kv>
                          <Kv label={t('report.registrationId')} sub>
                            {entity.registration_number ?? EM_DASH}
                          </Kv>
                          <Kv label={t('report.general.address')}>{entity.address ?? EM_DASH}</Kv>
                          {entity.website && (
                            <Kv label={t('report.general.website')}>{entity.website}</Kv>
                          )}
                          <Kv label={t('report.general.affiliatedCompanies')}>
                            {hasGroup ? memberIds.length - 1 : EM_DASH}
                          </Kv>
                          <Kv label={t('report.general.latestStatements')}>
                            {latestYear !== null ? (
                              <>
                                <span className={stale ? 'is-neg' : ''} style={{ fontWeight: 700 }}>
                                  {t('report.general.fy', { year: latestYear })}
                                </span>
                                {stale && (
                                  <span className="is-neg">
                                    {' '}
                                    – {t('report.general.olderThanYear')}
                                  </span>
                                )}
                              </>
                            ) : (
                              EM_DASH
                            )}
                          </Kv>
                          <tr className="is-limit is-limit-first">
                            <td>{t('report.general.recommendedLimit')}:</td>
                            <td>
                              <span className="rpt-big">
                                {latestAssessment
                                  ? `${formatAmount(Number(latestAssessment.suggested_limit), locale, 0)} ${latestAssessment.limit_currency}`
                                  : EM_DASH}
                              </span>
                            </td>
                          </tr>
                          <tr className="is-limit">
                            <td>{t('report.general.limitBasis')}:</td>
                            <td className="rpt-basis">
                              {latestAssessment && score !== null
                                ? limitBasisText(
                                    t,
                                    locale,
                                    score,
                                    Number(latestAssessment.suggested_limit),
                                    latestAssessment.limit_currency,
                                    latest,
                                  )
                                : t('report.noAssessment')}
                            </td>
                          </tr>
                          <tr className="is-limit">
                            <td>{t('report.general.creditRating')}:</td>
                            <td>
                              <span className="rpt-big">
                                {score === null ? EM_DASH : formatAmount(score, locale, 0)}
                              </span>
                            </td>
                          </tr>
                          {exposure.data?.exposure_uzs != null && (
                            <tr className="is-limit">
                              <td>{t('report.general.approvedExposure')}:</td>
                              <td style={{ fontWeight: 700 }}>
                                {formatAmount(Number(exposure.data.exposure_uzs), locale, 0)} UZS
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>

                      <div className="rpt-gauge-card">
                        <div className="rpt-gauge">
                          <RatingGauge
                            score={score}
                            previousScore={
                              previousAssessment ? Number(previousAssessment.rating_score) : null
                            }
                            t={t}
                          />
                        </div>
                        {bullets.length > 0 && <FactorBullets bullets={bullets} />}
                      </div>
                    </div>

                    <RatingLegend t={t} score={score} className="rpt-keep mt-4" />
                    {stale && latestYear !== null && (
                      <div className="rpt-freshness">
                        <strong>{t('report.freshness.label')}</strong>{' '}
                        {t('report.freshness.stale', { year: latestYear })}
                      </div>
                    )}
                  </section>

                  {/* 2. Key figures -------------------------------------------- */}
                  {latest && (
                    <section className="rpt-section">
                      <h2 className="rpt-h2">
                        {t('report.sections2.keyFigures', { year: latest.fiscal_year })}
                      </h2>
                      <div className="rpt-kf">
                        {figures.map((f) => (
                          <KeyFigureCard
                            key={f.key}
                            figure={f}
                            t={t}
                            locale={locale}
                            money={money}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  {/* 3. Conclusion + overall assessment ------------------------ */}
                  <section className="rpt-section">
                    <h2 className="rpt-h2">{t('report.sections.conclusion')}</h2>
                    {narrative.length > 0 && (
                      <ul className="rpt-bullets is-prose">
                        {narrative.map((bullet) => (
                          <li key={bullet.key}>
                            {t(
                              `report.narrative.${bullet.key}`,
                              formatNarrativeParams(bullet, t, locale),
                            )}
                          </li>
                        ))}
                        {stale && latestYear !== null && (
                          <li>{t('report.freshness.conclusion', { year: latestYear })}</li>
                        )}
                      </ul>
                    )}
                    <div className="rpt-overall">
                      <div className="rpt-overall-title">{t('report.overall.title')}</div>
                      <p style={{ margin: 0 }}>
                        {latestAssessment && score !== null
                          ? overallText(
                              t,
                              locale,
                              score,
                              bullets,
                              Number(latestAssessment.suggested_limit),
                              latestAssessment.limit_currency,
                            )
                          : t('report.noAssessment')}
                      </p>
                    </div>
                  </section>

                  {company.length === 0 ? (
                    <p className="rpt-note" style={{ marginTop: 16 }}>
                      {t('report.noStatements')}
                    </p>
                  ) : (
                    <>
                      {/* 4. Group: key companies ------------------------------- */}
                      {showGroupTables && (
                        <section className="rpt-section rpt-page-break">
                          <h2 className="rpt-h2">{t('report.sections2.groupKeyCompanies')}</h2>
                          <GroupKeyCompanies
                            t={t}
                            locale={locale}
                            members={members}
                            currency={baseCurrency}
                            year={latestYear}
                            subjectId={entity.id}
                          />
                        </section>
                      )}

                      {/* 5. Balance sheet ---------------------------------------- */}
                      <section className={`rpt-section ${showGroupTables ? '' : 'rpt-page-break'}`}>
                        <h2 className="rpt-h2">{t('report.sections.balanceSheet')}</h2>
                        <p className="rpt-caption">
                          {t('report.tables.bsCompany', { to: latestYear })}
                        </p>
                        <StatementReportTable
                          t={t}
                          locale={locale}
                          columns={company}
                          rows={bsCompany}
                          currency={currency}
                          kind="bs"
                        />
                        {groupSeries.length > 0 && (
                          <>
                            <p className="rpt-caption">
                              {t('report.tables.bsGroup', { to: latestYear })}
                            </p>
                            <StatementReportTable
                              t={t}
                              locale={locale}
                              columns={groupSeries}
                              rows={bsGroup}
                              currency={currency}
                              kind="bs"
                            />
                            <GroupNote
                              t={t}
                              currency={baseCurrency}
                              otherCurrency={combined?.otherCurrencyMembers ?? 0}
                            />
                          </>
                        )}
                        <CommentaryList
                          paragraphs={bsCommentary}
                          t={t}
                          locale={locale}
                          currency={currency}
                        />
                      </section>

                      {/* 6. Profit & loss ---------------------------------------- */}
                      <section className="rpt-section">
                        <h2 className="rpt-h2">{t('report.sections.pnl')}</h2>
                        <p className="rpt-caption">
                          {t('report.tables.plCompany', { to: latestYear })}
                        </p>
                        <StatementReportTable
                          t={t}
                          locale={locale}
                          columns={company}
                          rows={plCompany}
                          currency={currency}
                          kind="pl"
                        />
                        {groupSeries.length > 0 && (
                          <>
                            <p className="rpt-caption">
                              {t('report.tables.plGroup', { to: latestYear })}
                            </p>
                            <StatementReportTable
                              t={t}
                              locale={locale}
                              columns={groupSeries}
                              rows={plGroup}
                              currency={currency}
                              kind="pl"
                            />
                          </>
                        )}
                        <CommentaryList
                          paragraphs={plCommentary}
                          t={t}
                          locale={locale}
                          currency={currency}
                        />
                      </section>

                      {/* 7. Ratios, dynamics, risk summary ------------------------ */}
                      <section className="rpt-section">
                        <h2 className="rpt-h2">{t('report.sections.ratios')}</h2>
                        {ratiosCompany.map((table) => (
                          <RatioReportTable
                            key={`c-${table.key}`}
                            t={t}
                            locale={locale}
                            table={table}
                            columns={company}
                            currency={currency}
                            subject={entity.name}
                          />
                        ))}
                        {groupSeries.length > 0 &&
                          ratiosGroup.map((table) => (
                            <RatioReportTable
                              key={`g-${table.key}`}
                              t={t}
                              locale={locale}
                              table={table}
                              columns={groupSeries}
                              currency={currency}
                              subject={t('report.tables.combined')}
                            />
                          ))}
                      </section>

                      {companyAllShown.length >= 2 && (
                        <section className="rpt-section rpt-chart">
                          <h2 className="rpt-h2">{t('report.sections.dynamicGraphs')}</h2>
                          <DynamicCharts
                            statements={companyAllShown}
                            variant="print"
                            t={t}
                            locale={locale}
                            currency={currency}
                          />
                          <p className="rpt-note">{t('report.charts2.note')}</p>
                        </section>
                      )}

                      {ratioCommentary.length > 0 && (
                        <section className="rpt-section">
                          <CommentaryList
                            paragraphs={ratioCommentary}
                            t={t}
                            locale={locale}
                            currency={currency}
                          />
                        </section>
                      )}

                      <RiskSummary
                        t={t}
                        latestRisk={riskPeriods[riskPeriods.length - 1] ?? null}
                        negativeCfo={hasPersistentNegativeCfo(cashFlowColumns)}
                      />
                    </>
                  )}

                  <ReportGroupSection entityId={entity.id} t={t} locale={locale} />

                  {/* 8. Glossary ----------------------------------------------- */}
                  <section className="rpt-section">
                    <h2 className="rpt-h2">{t('report.sections2.glossary')}</h2>
                    <Glossary t={t} />
                  </section>

                  {/* 9. Group structure ---------------------------------------- */}
                  {showGroupTables && (
                    <section className="rpt-section">
                      <h2 className="rpt-h2">{t('report.sections2.groupStructure')}</h2>
                      <GroupStructureTable
                        t={t}
                        locale={locale}
                        members={members}
                        currency={baseCurrency}
                        subjectId={entity.id}
                      />
                    </section>
                  )}

                  {displayCurrency !== 'original' && companyConverted.footnotes.length > 0 && (
                    <p className="rpt-note">
                      {t('fin.fx.growthFootnote')} {t('report.fxFootnote')}:{' '}
                      {companyConverted.footnotes
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

                  <div className="rpt-disclaimer rpt-keep">
                    {t('report.disclaimer', { company: BRAND.copyright })}
                  </div>
                  <p className="rpt-end">{t('report.endOfReport')}</p>

                  <div className="rpt-legal">
                    {BRAND.legalEntities.map((le) => (
                      <div key={le.name}>
                        <strong>{le.name}</strong>
                        {le.lines.map((line) => (
                          <div key={line}>{line}</div>
                        ))}
                      </div>
                    ))}
                  </div>

                  <div className="rpt-footer">
                    <span>
                      © {BRAND.copyright} {today.getFullYear()}
                    </span>
                    <span className="mid">{t('report.tagline')}</span>
                    <span>{entity.name}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </article>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Header and print page rules
// ---------------------------------------------------------------------------

function ReportHeader({
  t,
  name,
  registration,
  date,
}: {
  t: TFunction
  name: string
  registration: string | null
  date: string
}) {
  return (
    <header className="rpt-head">
      <BrandMark size="xl" />
      <div className="text-right">
        <div className="rpt-head-title">{t('report.title')}</div>
        <div className="rpt-head-meta">
          <strong>{name}</strong>
          {registration && (
            <>
              <span className="sep">|</span>
              {t('report.registrationId')}: {registration}
            </>
          )}
        </div>
        <div className="rpt-head-meta" style={{ marginTop: 1 }}>
          {t('report.reportDate')}: {date}
        </div>
      </div>
    </header>
  )
}

const PAGE = '\u0001'
const PAGES = '\u0002'

/** The A4 page and its footer, in the report language. The margin boxes are
 * the only place "page x of y" can be drawn, and their content must be a
 * literal — hence a generated rule rather than a class. */
function PrintPageRules({ t }: { t: TFunction }) {
  const box =
    "font-family: 'PT Sans Narrow', 'Arial Narrow', sans-serif; font-size: 8pt; vertical-align: top; padding-top: 2.5mm; border-top: 0.6pt solid #c9dde9;"
  const css = `@page {
  size: A4;
  margin: 11mm 12mm 15mm;
  @bottom-left { content: ${cssString(`© ${BRAND.copyright} ${new Date().getFullYear()}`)}; color: #666666; ${box} }
  @bottom-center { content: ${cssString(`■  ${t('report.tagline')}`)}; color: #005288; font-weight: 700; ${box} }
  @bottom-right { content: ${pageCounterContent(t('report.pageOf', { page: PAGE, pages: PAGES }), PAGE, PAGES)}; color: #666666; ${box} }
}`
  return <style>{css}</style>
}

// ---------------------------------------------------------------------------
// General information
// ---------------------------------------------------------------------------

function Kv({
  label,
  children,
  strong = false,
  sub = false,
}: {
  label: string
  children: ReactNode
  strong?: boolean
  sub?: boolean
}) {
  return (
    <tr className={`${strong ? 'is-strong' : ''} ${sub ? 'is-sub' : ''}`}>
      <td>{label}:</td>
      <td>{children}</td>
    </tr>
  )
}

function ownerText(o: { parent_name: string; ownership_pct: number | null }, locale: string) {
  return o.ownership_pct === null
    ? o.parent_name
    : `${o.parent_name} (${formatAmount(Number(o.ownership_pct), locale, 2)}%)`
}

function scaleLabel(t: TFunction, point: ScalePoint): string {
  return t(`rating.scale10.${SCALE_LABEL_KEYS[point]}`)
}

function bandText(t: TFunction, score: number): string {
  const placement = placeScore(score)
  return placement.kind === 'in'
    ? t('report.placement.in', { band: scaleLabel(t, placement.point) })
    : t('report.placement.between', {
        lower: scaleLabel(t, placement.lower),
        upper: scaleLabel(t, placement.upper),
      })
}

function limitBasisText(
  t: TFunction,
  locale: string,
  score: number,
  limit: number,
  limitCurrency: string,
  base: StatementBundle | null,
): string {
  const band = bandText(t, score)
  const shownScore = formatAmount(score, locale, 0)
  const revenue = base?.income_statements?.revenue ?? null
  // The ratios mean something only in the limit's own currency.
  if (!base || base.currency_code !== limitCurrency || !limit || !revenue || revenue <= 0) {
    return t('report.limitBasis.ratingOnly', { score: shownScore, band })
  }
  const revenuePct = formatPercent(limit / revenue, locale, 2)
  const equity = base.balance_sheets?.total_equity ?? null
  if (!equity || equity <= 0) {
    return t('report.limitBasis.revenueOnly', {
      score: shownScore,
      band,
      revenuePct,
      year: base.fiscal_year,
    })
  }
  return t('report.limitBasis.full', {
    score: shownScore,
    band,
    revenuePct,
    equityPct: formatPercent(limit / equity, locale, 1),
    year: base.fiscal_year,
  })
}

function overallText(
  t: TFunction,
  locale: string,
  score: number,
  bullets: FactorBullet[],
  limit: number,
  limitCurrency: string,
): string {
  const placement = placeScore(score)
  const shownScore = formatAmount(score, locale, 0)
  const parts = [
    placement.kind === 'in'
      ? t('report.overall.rating', {
          score: shownScore,
          band: scaleLabel(t, placement.point),
          point: placement.point,
        })
      : t('report.overall.ratingBetween', {
          score: shownScore,
          lower: scaleLabel(t, placement.lower),
          lowerPoint: placement.lower,
          upper: scaleLabel(t, placement.upper),
          upperPoint: placement.upper,
        }),
  ]
  // bullets are best-first: strengths from the front, weaknesses from the back
  const factorNames = (list: FactorBullet[]) =>
    list.slice(0, 3).map((b) => t(`rating.factors.${b.factor}`))
  const strengths = factorNames(bullets.filter((b) => b.tone === 'strength'))
  const weaknesses = factorNames(bullets.filter((b) => b.tone === 'weakness').reverse())
  if (strengths.length) parts.push(t('report.overall.strengths', { list: strengths.join(', ') }))
  if (weaknesses.length) parts.push(t('report.overall.weaknesses', { list: weaknesses.join(', ') }))
  parts.push(
    limit > 0
      ? t('report.overall.limit', { amount: `${formatAmount(limit, locale, 0)} ${limitCurrency}` })
      : t('report.overall.noLimit'),
  )
  return parts.join(' ')
}

function FactorBullets({ bullets }: { bullets: FactorBullet[] }) {
  return (
    <ul className="rpt-bullets is-small">
      {bullets.map((b) => (
        <li key={b.factor} className={`is-${b.tone}`}>
          {b.text}
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Key figures
// ---------------------------------------------------------------------------

function KeyFigureCard({
  figure,
  t,
  locale,
  money,
}: {
  figure: KeyFigure
  t: TFunction
  locale: string
  money: (v: number | null) => string
}) {
  const show = (v: number | null) =>
    v === null
      ? EM_DASH
      : figure.format === 'amount'
        ? money(v)
        : figure.format === 'percent'
          ? formatPercent(v, locale, 2)
          : `${formatRatio(v, locale)}x`

  const change = figure.change
  const sign = (v: number) => (v >= 0 ? '+' : '−')
  const changeText =
    change === null
      ? figure.previous !== null
        ? t('report.nm')
        : ''
      : change.kind === 'pct'
        ? formatSignedPercent(change.value, locale)
        : change.kind === 'pp'
          ? `${sign(change.value)}${formatAmount(Math.abs(change.value * 100), locale, 2)} ${t('report.pp')}`
          : `${sign(change.value)}${formatRatio(Math.abs(change.value), locale)}x`
  const toneClass = figure.tone === 'pos' ? 'is-pos' : figure.tone === 'neg' ? 'is-neg' : ''

  return (
    <div>
      <div className="rpt-kf-label">{t(`report.keyFigureLabels.${figure.key}`)}</div>
      <div className={`rpt-kf-value ${figure.value !== null && figure.value < 0 ? 'is-neg' : ''}`}>
        {show(figure.value)}
      </div>
      {figure.previousYear !== null && (
        <div className="rpt-kf-sub">
          {figure.previousYear}: {show(figure.previous)}
          {changeText && (
            <b className={toneClass}>
              {changeText}
              {figure.trend && ` ${figure.trend === 'up' ? '▲' : '▼'}`}
            </b>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Commentary
// ---------------------------------------------------------------------------

function formatValue(
  format: ValueFormat,
  value: number | null,
  t: TFunction,
  locale: string,
  currency: string,
): string {
  if (value === null) return EM_DASH
  switch (format) {
    case 'amount':
      return `${formatCompact(value, locale, 2)} ${currency}`
    case 'percent':
      return formatPercent(value, locale, 2)
    case 'ratio':
      return `${formatRatio(value, locale)}x`
    case 'days':
      return `${formatAmount(value, locale, 2)} ${t('report.tables.days')}`
  }
}

function Sentence({
  s,
  t,
  locale,
  currency,
}: {
  s: CommentarySentence
  t: TFunction
  locale: string
  currency: string
}) {
  const values = {
    subject: t(`report.commentary.subjects.${s.metric}.${s.subject}`),
    from: formatValue(s.format, s.from, t, locale, currency),
    to: formatValue(s.format, s.to, t, locale, currency),
  }
  const c = s.commentary
  if (c.kind !== 'change') return <>{t(`report.commentary.${c.kind}`, values)}</>
  const move =
    c.move === 'up' || c.move === 'down'
      ? t(`report.commentary.moves.${c.move}.${c.strength}`)
      : t(`report.commentary.moves.${c.move}`)
  const tone = s.tone === 'pos' ? 'is-pos' : s.tone === 'neg' ? 'is-neg' : ''
  return (
    <Trans
      t={t}
      i18nKey="report.commentary.change"
      values={{ ...values, move, pct: formatPercent(c.pct, locale, 2) }}
      components={{ hl: <span className={`rpt-hl ${tone}`} /> }}
    />
  )
}

function CommentaryList({
  paragraphs,
  t,
  locale,
  currency,
}: {
  paragraphs: CommentaryParagraph[]
  t: TFunction
  locale: string
  currency: string
}) {
  if (paragraphs.length === 0) return null
  return (
    <ul className="rpt-bullets is-prose" style={{ marginTop: 8 }}>
      {paragraphs.map((p) => (
        <li key={p.metric}>
          {p.sentences.map((s, i) => (
            <span key={s.subject}>
              {i > 0 && ' '}
              <Sentence s={s} t={t} locale={locale} currency={currency} />
            </span>
          ))}
        </li>
      ))}
    </ul>
  )
}

function GroupNote({
  t,
  currency,
  otherCurrency,
}: {
  t: TFunction
  currency: string
  otherCurrency: number
}) {
  return (
    <p className="rpt-note">
      {t('report.group.combinedNote', { currency })}
      {otherCurrency > 0 && ` ${t('report.group.otherCurrency', { count: otherCurrency })}`}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Risk summary and glossary
// ---------------------------------------------------------------------------

function RiskSummary({
  t,
  latestRisk,
  negativeCfo,
}: {
  t: TFunction
  latestRisk: ReturnType<typeof buildRiskPeriods>[number] | null
  negativeCfo: boolean
}) {
  if (!latestRisk) return null
  const breached = RISK_ROWS.filter((row) => latestRisk.breaches[row.key])
  return (
    <section className="rpt-section rpt-keep">
      <h2 className="rpt-h2">{t('report.sections.riskSummary')}</h2>
      <ul className="rpt-bullets is-prose">
        {latestRisk.zBand && (
          <li>
            {t('report.risk.zZone')}: <strong>{t(`fin.risk.bands.${latestRisk.zBand}`)}</strong>
          </li>
        )}
        <li>
          {breached.length
            ? `${t('report.risk.breaches')}: ${breached.map((row) => t(`fin.risk.rows.${row.key}`)).join(', ')}`
            : t('report.risk.noBreaches')}
        </li>
        {negativeCfo && <li className="is-weakness">{t('report.risk.negativeCfo')}</li>}
      </ul>
    </section>
  )
}

const GLOSSARY_KEYS = [
  'ebit',
  'cfo',
  'fcf',
  'nwc',
  'dio',
  'dso',
  'dpo',
  'ccc',
  'de',
  'ltst',
  'pp',
  'nm',
  'kmbt',
] as const

function Glossary({ t }: { t: TFunction }) {
  const half = Math.ceil(GLOSSARY_KEYS.length / 2)
  const column = (keys: readonly string[]) => (
    <dl>
      {keys.map((key) => (
        <GlossaryRow
          key={key}
          term={t(`report.glossaryTerms.${key}.term`)}
          definition={t(`report.glossaryTerms.${key}.definition`)}
        />
      ))}
    </dl>
  )
  return (
    <div className="rpt-glossary">
      {column(GLOSSARY_KEYS.slice(0, half))}
      {column(GLOSSARY_KEYS.slice(half))}
    </div>
  )
}

function GlossaryRow({ term, definition }: { term: string; definition: string }) {
  return (
    <>
      <dt>{term}</dt>
      <dd>{definition}</dd>
    </>
  )
}
