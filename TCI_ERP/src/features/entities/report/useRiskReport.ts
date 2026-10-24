/**
 * Everything the risk report shows, assembled once for both of its faces:
 * the A4 document (ReportPage, /entities/:id/report) and the online report
 * on the company card's Overview tab. Reads, unit normalisation, the group's
 * COMBINED series, display-currency conversion and every derived table come
 * from here; the components only lay them out.
 */

import { useMemo } from 'react'

import { refName, useEntity, useStatements } from '../api'
import type { ReportType, StatementBundle } from '../types'
import { buildCashFlowColumns } from '../financials/cashflow'
import { convertStatements, rateKey, requiredRates } from '../financials/fx'
import type { DisplayCurrency } from '../financials/fx'
import { useFxRates } from '../financials/fxApi'
import { buildRiskPeriods } from '../financials/risk'
import { useBuyerExposure } from '../../limits/api'
import { useEntityGroup } from '../../groups/api'
import { useAssessments } from '../rating/assessmentsApi'
import { useMemberEntities, useMemberStatements, useOwners } from './api'
import { buildCommentary } from './commentary'
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
import type { MemberInfo } from './model'
import { buildNarrative } from './narrative'

export interface RiskReportOptions {
  entityId: string
  /** Report language — only used for reference-data names (industry). */
  locale: string
  /** 'auto' = the type of the latest annual statement (statutory if none). */
  reportType: ReportType | 'auto'
  displayCurrency: DisplayCurrency
}

/** The report type of the most recent annual statement. */
export function latestAnnualType(statements: readonly StatementBundle[]): ReportType {
  const annual = statements
    .filter((s) => s.statement_kind === 'annual')
    .sort((a, b) => b.period_end_date.localeCompare(a.period_end_date))
  return annual[0]?.report_type ?? 'statutory'
}

export function useRiskReport({ entityId, locale, reportType: wanted, displayCurrency }: RiskReportOptions) {
  const entity = useEntity(entityId)
  const statements = useStatements(entityId)
  const assessments = useAssessments(entityId)
  const exposure = useBuyerExposure(entityId)
  const owners = useOwners(entityId)

  const group = useEntityGroup(entityId)
  const memberIds = useMemo(() => (group.data ?? []).map((m) => m.member_id), [group.data])
  const parentId = group.data?.[0]?.ultimate_parent_id ?? entityId
  const hasGroup = memberIds.length > 1
  const memberEntities = useMemberEntities(memberIds)
  const memberStatements = useMemberStatements(memberIds)

  const reportType: ReportType = wanted === 'auto' ? latestAnnualType(statements.data ?? []) : wanted

  // ---- company series (original currency, whole units) -------------------
  const companyAll = useMemo(
    () => annualSeries(statements.data ?? [], reportType),
    [statements.data, reportType],
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
  const tables = useMemo(
    () => ({
      bsCompany: statementRows(company, BS_REPORT_ROWS, bsBase, companyShown),
      plCompany: statementRows(company, PL_REPORT_ROWS, plBase, companyShown),
      bsGroup: statementRows(groupSeries, BS_REPORT_ROWS, bsBase, groupShown),
      plGroup: statementRows(groupSeries, PL_REPORT_ROWS, plBase, groupShown),
      ratiosCompany: ratioTables(company, companyAll, companyShown, companyAllShown),
      ratiosGroup: ratioTables(groupSeries, groupAll, groupShown, groupAllShown),
    }),
    [company, companyShown, companyAll, companyAllShown, groupSeries, groupShown, groupAll, groupAllShown],
  )
  const figures = useMemo(() => keyFigures(company, companyShown), [company, companyShown])
  const commentary = useMemo(() => {
    const input = { company, companyDisplay: companyShown, group: groupSeries, groupDisplay: groupShown }
    return {
      balanceSheet: buildCommentary('balanceSheet', input),
      pnl: buildCommentary('pnl', input),
      ratios: buildCommentary('ratios', input),
    }
  }, [company, companyShown, groupSeries, groupShown])

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

  const today = new Date()
  const latestAssessment = assessments.data?.[0] ?? null
  const previousAssessment = assessments.data?.[1] ?? null

  return {
    loading: entity.isLoading || statements.isLoading,
    entity: entity.data ?? null,
    hasStatements: (statements.data ?? []).length > 0,
    reportType,
    today,
    displayCurrency,
    currency,
    baseCurrency,
    company,
    companyAllShown,
    fxFootnotes: companyConverted.footnotes,
    latest,
    latestYear: latest?.fiscal_year ?? null,
    stale: latest ? isStale(latest.period_end_date, today.toISOString().slice(0, 10)) : false,
    latestAssessment,
    previousAssessment,
    // A manual rating (0073) has no score.
    score: latestAssessment?.rating_score == null ? null : Number(latestAssessment.rating_score),
    owners: owners.data ?? [],
    exposureUzs: exposure.data?.exposure_uzs ?? null,
    hasGroup,
    affiliates: hasGroup ? memberIds.length - 1 : null,
    members,
    showGroupTables: hasGroup && members.length > 1 && latest !== null,
    otherCurrencyMembers: combined?.otherCurrencyMembers ?? 0,
    groupSeries,
    ...tables,
    figures,
    commentary,
    cashFlowColumns,
    riskPeriods,
    narrative,
  }
}

export type RiskReportData = ReturnType<typeof useRiskReport>
