/**
 * The risk report's content — one component for both faces of the report:
 * `variant="print"` inside the A4 sheet of ReportPage, `variant="screen"`
 * as the online report on the company card. The sections, their order and
 * their styling (report.css) are the same; on screen the bullets drill into
 * the tab they are about and the charts are responsive.
 */

import type { ReactNode } from 'react'
import { Trans } from 'react-i18next'
import type { TFunction } from 'i18next'

import { BrandMark, RatingGauge, RatingLegend } from '../../../components/ui'
import { BRAND } from '../../../lib/brand'
import {
  EM_DASH,
  formatAmount,
  formatCompact,
  formatPercent,
  formatRatio,
  formatSignedPercent,
  formatDate,
} from '../../../lib/format'
import { SCALE_LABEL_KEYS, placeScore } from '../../../lib/ratingScale'
import type { ScalePoint } from '../../../lib/ratingScale'
import { refName } from '../api'
import { statementPeriodLabel } from '../types'
import type { StatementBundle } from '../types'
import { hasPersistentNegativeCfo } from '../financials/cashflow'
import { RISK_ROWS, buildRiskPeriods } from '../financials/risk'
import { buildFactorBullets } from '../rating/chips'
import type { FactorBullet } from '../rating/chips'
import type { CommentaryParagraph, CommentarySentence, ValueFormat } from './commentary'
import { DynamicCharts } from './DynamicCharts'
import type { KeyFigure } from './model'
import { formatNarrativeParams } from './narrativeParams'
import { ReportGroupSection } from './ReportGroupSection'
import {
  GroupKeyCompanies,
  GroupStructureTable,
  RatioReportTable,
  StatementReportTable,
} from './ReportTables'
import type { RiskReportData } from './useRiskReport'

interface RiskReportBodyProps {
  report: RiskReportData & { entity: NonNullable<RiskReportData['entity']> }
  t: TFunction
  locale: string
  variant: 'print' | 'screen'
  /** Screen only: a conclusion bullet was clicked (narrative key). */
  onNarrative?: (key: string) => void
  /** Screen only: a rating-factor bullet was clicked. */
  onFactor?: () => void
}

export function RiskReportBody({ report, t, locale, variant, onNarrative, onFactor }: RiskReportBodyProps) {
  const {
    entity,
    latest,
    latestYear,
    stale,
    latestAssessment,
    previousAssessment,
    score,
    owners,
    affiliates,
    exposureUzs,
    figures,
    narrative,
    company,
    showGroupTables,
    members,
    baseCurrency,
    currency,
    bsCompany,
    plCompany,
    bsGroup,
    plGroup,
    groupSeries,
    otherCurrencyMembers,
    commentary,
    ratiosCompany,
    ratiosGroup,
    companyAllShown,
    riskPeriods,
    cashFlowColumns,
    displayCurrency,
    fxFootnotes,
  } = report
  const rating = latestAssessment?.calculation_trace?.rating ?? null
  const bullets = rating ? buildFactorBullets(rating.components, t, locale) : []
  const money = (v: number | null) =>
    v === null ? EM_DASH : `${formatCompact(v, locale, 2)} ${currency}`

  return (
    <>
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
                            {entity.founded_date ? formatDate(entity.founded_date, locale) : EM_DASH}
                          </Kv>
                          <Kv label={t('report.general.country')}>
                            {refName(entity.countries, locale) || EM_DASH}
                          </Kv>
                          <Kv label={t('report.general.owners')}>
                            {owners.length > 0
                              ? owners.map((o) => ownerText(o, locale)).join('; ')
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
                            {affiliates ?? EM_DASH}
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
                          {exposureUzs != null && (
                            <tr className="is-limit">
                              <td>{t('report.general.approvedExposure')}:</td>
                              <td style={{ fontWeight: 700 }}>
                                {formatAmount(Number(exposureUzs), locale, 0)} UZS
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
                        {bullets.length > 0 && <FactorBullets bullets={bullets} onClick={onFactor} />}
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
                            <Clickable onClick={onNarrative ? () => onNarrative(bullet.key) : undefined}>
                              {t(
                                `report.narrative.${bullet.key}`,
                                formatNarrativeParams(bullet, t, locale),
                              )}
                            </Clickable>
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
                        <div className="rpt-scroll"><StatementReportTable
                          t={t}
                          locale={locale}
                          columns={company}
                          rows={bsCompany}
                          currency={currency}
                          kind="bs"
                        /></div>
                        {groupSeries.length > 0 && (
                          <>
                            <p className="rpt-caption">
                              {t('report.tables.bsGroup', { to: latestYear })}
                            </p>
                            <div className="rpt-scroll"><StatementReportTable
                              t={t}
                              locale={locale}
                              columns={groupSeries}
                              rows={bsGroup}
                              currency={currency}
                              kind="bs"
                            /></div>
                            <GroupNote
                              t={t}
                              currency={baseCurrency}
                              otherCurrency={otherCurrencyMembers}
                            />
                          </>
                        )}
                        <CommentaryList
                          paragraphs={commentary.balanceSheet}
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
                        <div className="rpt-scroll"><StatementReportTable
                          t={t}
                          locale={locale}
                          columns={company}
                          rows={plCompany}
                          currency={currency}
                          kind="pl"
                        /></div>
                        {groupSeries.length > 0 && (
                          <>
                            <p className="rpt-caption">
                              {t('report.tables.plGroup', { to: latestYear })}
                            </p>
                            <div className="rpt-scroll"><StatementReportTable
                              t={t}
                              locale={locale}
                              columns={groupSeries}
                              rows={plGroup}
                              currency={currency}
                              kind="pl"
                            /></div>
                          </>
                        )}
                        <CommentaryList
                          paragraphs={commentary.pnl}
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
                            variant={variant}
                            t={t}
                            locale={locale}
                            currency={currency}
                          />
                          <p className="rpt-note">{t('report.charts2.note')}</p>
                        </section>
                      )}

                      {commentary.ratios.length > 0 && (
                        <section className="rpt-section">
                          <CommentaryList
                            paragraphs={commentary.ratios}
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
                      <div className="rpt-scroll"><GroupStructureTable
                        t={t}
                        locale={locale}
                        members={members}
                        currency={baseCurrency}
                        subjectId={entity.id}
                      /></div>
                    </section>
                  )}

                  {displayCurrency !== 'original' && fxFootnotes.length > 0 && (
                    <p className="rpt-note">
                      {t('fin.fx.growthFootnote')} {t('report.fxFootnote')}:{' '}
                      {fxFootnotes
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

                  {BRAND.legalEntities.length > 0 && (
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
                  )}

    </>
  )
}

// ---------------------------------------------------------------------------
// Header and print page rules
// ---------------------------------------------------------------------------

export function ReportHeader({
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

function FactorBullets({ bullets, onClick }: { bullets: FactorBullet[]; onClick?: () => void }) {
  return (
    <ul className="rpt-bullets is-small">
      {bullets.map((b) => (
        <li key={b.factor} className={`is-${b.tone}`}>
          <Clickable onClick={onClick}>{b.text}</Clickable>
        </li>
      ))}
    </ul>
  )
}

/** On screen a bullet drills into the tab it is about; in print it is text. */
function Clickable({ onClick, children }: { onClick?: () => void; children: ReactNode }) {
  if (!onClick) return <>{children}</>
  return (
    <button type="button" onClick={onClick} className="rpt-link">
      {children}
    </button>
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
  // No sign on a change that shows as zero (+0,00x / −0,00 pp is noise).
  const sign = (v: number, places: number) =>
    Math.round(Math.abs(v) * 10 ** places) === 0 ? '' : v > 0 ? '+' : '−'
  const changeText =
    figure.unchanged
      ? ''
      : change === null
      ? figure.previous !== null
        ? t('report.nm')
        : ''
      : change.kind === 'pct'
        ? formatSignedPercent(change.value, locale)
        : change.kind === 'pp'
          ? `${sign(change.value, 4)}${formatAmount(Math.abs(change.value * 100), locale, 2)} ${t('report.pp')}`
          : `${sign(change.value, 2)}${formatRatio(Math.abs(change.value), locale)}x`
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
          {figure.unchanged ? (
            // Zero at the precision shown: words, neutral, no arrow.
            <span className="rpt-muted rpt-kf-flat">{t('report.unchanged')}</span>
          ) : (
            changeText && (
              <b className={toneClass}>
                {changeText}
                {figure.trend && ` ${figure.trend === 'up' ? '▲' : '▼'}`}
              </b>
            )
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
