/**
 * The risk report's tables: statements with shares and trend arrows, ratio
 * tables with a change column, the group's key-company rankings and its
 * structure. Pure layout over report/model.ts — no data access, no maths
 * beyond formatting.
 */

import type { TFunction } from 'i18next'

import { EM_DASH, formatAmount, formatSignedPercent, isZeroChange } from '../../../lib/format'
import type { StatementBundle } from '../types'
import type { MemberFigures, MemberMetric, RatioTable, StatementRow, Tone, Trend } from './model'
import { shareOf, topMembers } from './model'

const toneClass = (tone: Tone) => (tone === 'pos' ? 'is-pos' : tone === 'neg' ? 'is-neg' : '')

export function Arrow({ trend, tone }: { trend: Trend; tone: Tone }) {
  if (!trend) return <span className="rpt-arrow" />
  return (
    <span className={`rpt-arrow ${toneClass(tone)}`} aria-hidden>
      {trend === 'up' ? '▲' : '▼'}
    </span>
  )
}

function Amount({ value, locale }: { value: number | null; locale: string }) {
  return (
    <span className={value !== null && value < 0 ? 'is-neg' : ''}>
      {value === null ? EM_DASH : formatAmount(value, locale, 0)}
    </span>
  )
}

/** Share of the base in percent points, one decimal; null stays a dash. */
function share(value: number | null, locale: string): string {
  return value === null ? EM_DASH : formatAmount(value * 100, locale, 2)
}

export function StatementReportTable({
  t,
  locale,
  columns,
  rows,
  currency,
  kind,
}: {
  t: TFunction
  locale: string
  columns: StatementBundle[]
  rows: StatementRow[]
  currency: string
  kind: 'bs' | 'pl'
}) {
  return (
    <table className={`rpt-table ${kind === 'pl' ? 'rpt-pl' : ''}`}>
      <thead>
        <tr>
          <th>{t(kind === 'bs' ? 'report.tables.bsItems' : 'report.tables.plItems')}</th>
          {columns.map((c) => (
            <StatementHead
              key={c.id}
              label={`${c.fiscal_year} (${currency})`}
              share={t(kind === 'bs' ? 'report.tables.pctTotalAssets' : 'report.tables.pctRevenue')}
            />
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.def.labelKey}
            className={
              row.def.level === 'grand'
                ? 'is-grand'
                : row.def.level === 'subtotal'
                  ? 'is-subtotal'
                  : ''
            }
          >
            <td>{t(`report.rows.${row.def.labelKey}`)}</td>
            {row.cells.map((cell, i) => (
              <CellPair key={columns[i]?.id ?? i} cell={cell} locale={locale} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function StatementHead({ label, share: shareLabel }: { label: string; share: string }) {
  return (
    <>
      <th>{label}</th>
      <th style={{ width: '10%' }}>{shareLabel}</th>
    </>
  )
}

function CellPair({ cell, locale }: { cell: StatementRow['cells'][number]; locale: string }) {
  return (
    <>
      <td className="rpt-num">
        <Amount value={cell.value} locale={locale} />
        <Arrow trend={cell.trend} tone={cell.tone} />
      </td>
      <td className={`rpt-num ${cell.share !== null && cell.share < 0 ? 'is-neg' : ''}`}>
        {share(cell.share, locale)}
      </td>
    </>
  )
}

function ratioValue(table: RatioTable, value: number | null, locale: string): string {
  if (value === null) return EM_DASH
  if (table.format === 'percent') return formatAmount(value * 100, locale, 2)
  return formatAmount(value, locale, 0)
}

export function RatioReportTable({
  t,
  locale,
  table,
  columns,
  currency,
  subject,
}: {
  t: TFunction
  locale: string
  table: RatioTable
  columns: StatementBundle[]
  currency: string
  subject: string
}) {
  if (table.rows.length === 0) return null
  const unit =
    table.format === 'percent' ? '%' : table.format === 'days' ? t('report.tables.days') : currency
  return (
    <div className="rpt-keep">
      <p className="rpt-caption">{t(`report.tables.${table.key}`, { subject })}</p>
      <table className="rpt-table">
        <thead>
          <tr>
            <th style={{ width: '20%' }}>{t('report.tables.ratios')}</th>
            {columns.map((c, i) => (
              <RatioHead key={c.id} first={i === 0} label={`${c.fiscal_year} (${unit})`} t={t} />
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.key}>
              <td style={{ fontWeight: 700 }}>{t(`report.ratioRows.${row.key}`)}</td>
              {row.values.map((value, i) => (
                <RatioCells
                  key={columns[i]?.id ?? i}
                  first={i === 0}
                  value={ratioValue(table, value, locale)}
                  negative={value !== null && value < 0}
                  change={row.changes[i]}
                  tone={row.tones[i]}
                  locale={locale}
                  t={t}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RatioHead({ first, label, t }: { first: boolean; label: string; t: TFunction }) {
  return (
    <>
      <th>{label}</th>
      {!first && <th style={{ width: '11%' }}>{t('report.tables.pctChange')}</th>}
    </>
  )
}

function RatioCells({
  first,
  value,
  negative,
  change,
  tone,
  locale,
  t,
}: {
  first: boolean
  value: string
  negative: boolean
  change: number | null
  tone: Tone
  locale: string
  t: TFunction
}) {
  return (
    <>
      <td className={`rpt-num ${negative ? 'is-neg' : ''}`}>{value}</td>
      {!first && (
        <td className={`rpt-num ${change === null ? 'rpt-muted' : isZeroChange(change) ? '' : toneClass(tone)}`}>
          {change === null ? t('report.nm') : formatSignedPercent(change, locale)}
        </td>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

const RANKINGS: { metric: MemberMetric; caption: string; head: string }[] = [
  { metric: 'revenue', caption: 'report.group.byRevenue', head: 'report.group.revenueIn' },
  { metric: 'netProfit', caption: 'report.group.byNetProfit', head: 'report.group.netProfitIn' },
  { metric: 'grossDebt', caption: 'report.group.byGrossDebt', head: 'report.group.grossDebtIn' },
  { metric: 'ltAssets', caption: 'report.group.byLtAssets', head: 'report.group.ltAssetsIn' },
]

export function GroupKeyCompanies({
  t,
  locale,
  members,
  currency,
  year,
  subjectId,
}: {
  t: TFunction
  locale: string
  members: MemberFigures[]
  currency: string
  year: number
  /** The company the report is about: ranked among its affiliates it would
   * only crowd them out, so it is left out — its share stays in the total. */
  subjectId: string
}) {
  return (
    <div className="rpt-grid-2">
      {RANKINGS.map(({ metric, caption, head }) => {
        const top = topMembers(members, metric, 5, subjectId)
        if (top.length === 0) return null
        return (
          <div key={metric} className="rpt-keep">
            <p className="rpt-caption">{t(caption)}</p>
            <table className="rpt-table">
              <thead>
                <tr>
                  <th>{t('report.group.company')}</th>
                  <th style={{ textAlign: 'left' }}>{t('report.group.regId')}</th>
                  <th>{t(head, { year, currency })}</th>
                  <th>{t('report.group.shareOfGroup')}</th>
                </tr>
              </thead>
              <tbody>
                {top.map((row) => (
                  <tr key={row.member.id}>
                    <td style={{ fontWeight: 700 }}>{row.member.name}</td>
                    <td className="rpt-muted">{row.member.registration_number || EM_DASH}</td>
                    <td className="rpt-num">
                      <Amount value={row.value} locale={locale} />
                    </td>
                    <td
                      className={`rpt-num ${row.share !== null && row.share < 0 ? 'is-neg' : ''}`}
                    >
                      {share(row.share, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}

export function GroupStructureTable({
  t,
  locale,
  members,
  currency,
  subjectId,
}: {
  t: TFunction
  locale: string
  members: MemberFigures[]
  currency: string
  subjectId: string
}) {
  const sorted = [...members].sort((a, b) => (b.revenue ?? -Infinity) - (a.revenue ?? -Infinity))
  const pct = (m: MemberFigures, metric: MemberMetric) => {
    const v = shareOf(members, metric, m)
    return <span className={v !== null && v < 0 ? 'is-neg' : ''}>{share(v, locale)}</span>
  }
  return (
    <table className="rpt-table">
      <thead>
        <tr>
          <th>{t('report.group.company')}</th>
          <th style={{ textAlign: 'left' }}>{t('report.group.regId')}</th>
          <th style={{ textAlign: 'left' }}>{t('report.group.lineOfBusiness')}</th>
          <th>{t('report.group.shareRevenue')}</th>
          <th>{t('report.group.netProfit', { currency })}</th>
          <th>{t('report.group.shareAssets')}</th>
          <th>{t('report.group.shareEquity')}</th>
          <th>{t('report.group.shareDebt')}</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((m) => (
          <tr key={m.id} className={m.id === subjectId ? 'is-grand' : ''}>
            <td style={{ fontWeight: 700 }}>{m.name}</td>
            <td className="rpt-muted">{m.registration_number || EM_DASH}</td>
            <td>{m.industry ?? EM_DASH}</td>
            <td className="rpt-num">{pct(m, 'revenue')}</td>
            <td className="rpt-num">
              <Amount value={m.netProfit} locale={locale} />
            </td>
            <td className="rpt-num">{pct(m, 'totalAssets')}</td>
            <td className="rpt-num">{pct(m, 'equity')}</td>
            <td className="rpt-num">{pct(m, 'grossDebt')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
