/**
 * The two dynamics charts (revenue/receivables/payables and DIO/DPO/DSO),
 * shared by the risk report and the company dashboard, drawn in the report's
 * palette: navy / process blue / orange lines with square markers.
 * `variant="print"` renders at a fixed size (print pagination needs stable
 * geometry), side by side; `variant="screen"` is responsive with tooltips.
 */

import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { formatAmount, formatCompact } from '../../../lib/format'
import type { StatementBundle } from '../types'
import type { ChartRow } from './chartData'
import { buildDynamicChartData } from './chartData'

/** Navy, process blue, orange — the brand's chart order. */
/** The series colours: the brand, the secondary brand, the orange accent —
 * tokens, so they follow the colour theme and dark mode (0082). */
export const CHART_COLORS = ['var(--color-accent-600)', 'var(--color-sky-400)', 'var(--color-brand-orange)'] as const

interface SeriesDef {
  dataKey: keyof ChartRow
  name: string
}

interface SquareDotProps {
  cx?: number
  cy?: number
  stroke?: string
  value?: number | null
}

function SquareDot({ cx, cy, stroke, value }: SquareDotProps) {
  if (cx === undefined || cy === undefined || value === null || value === undefined) return null
  return (
    <rect
      x={cx - 3.5}
      y={cy - 3.5}
      width={7}
      height={7}
      fill="var(--color-white)"
      stroke={stroke}
      strokeWidth={1.6}
    />
  )
}

function ChartLegend({ series }: { series: SeriesDef[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 font-display text-caption text-ink">
      {series.map((s, idx) => (
        <span key={s.dataKey} className="inline-flex items-center gap-2">
          <span className="inline-block size-2.5" style={{ background: CHART_COLORS[idx] }} />
          {s.name}
        </span>
      ))}
    </div>
  )
}

function DynamicsLineChart({
  data,
  series,
  variant,
  locale,
  days,
}: {
  data: ChartRow[]
  series: SeriesDef[]
  variant: 'print' | 'screen'
  locale: string
  days: boolean
}) {
  const axis = {
    fontSize: '0.625rem',
    fill: 'var(--color-slate-500)',
    fontFamily: 'PT Sans Narrow, Arial Narrow, sans-serif',
  }
  const tick = (v: number) => (days ? formatAmount(v, locale, 0) : formatCompact(v, locale, 0))
  const chart = (width?: number, height?: number) => (
    <LineChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 6, right: 12, left: 0, bottom: 0 }}
    >
      <CartesianGrid vertical={false} stroke="var(--color-slate-200)" />
      <XAxis dataKey="period" tick={axis} tickLine={false} axisLine={{ stroke: 'var(--color-slate-300)' }} />
      <YAxis
        tick={axis}
        width={days ? 34 : locale === 'en' ? 46 : 64}
        tickFormatter={tick}
        tickLine={false}
        axisLine={false}
      />
      {variant === 'screen' && (
        <Tooltip
          formatter={(v) => (typeof v === 'number' ? formatAmount(v, locale, 0) : v)}
          contentStyle={{ fontSize: '0.75rem', borderRadius: 8, borderColor: 'var(--color-slate-300)', background: 'var(--color-white)' }}
        />
      )}
      {series.map((s, idx) => (
        <Line
          key={s.dataKey}
          dataKey={s.dataKey}
          name={s.name}
          stroke={CHART_COLORS[idx]}
          strokeWidth={2}
          dot={<SquareDot />}
          activeDot={{ r: 4 }}
          isAnimationActive={variant === 'screen'}
          connectNulls
        />
      ))}
    </LineChart>
  )

  if (variant === 'print') return chart(330, 200)
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        {chart()}
      </ResponsiveContainer>
    </div>
  )
}

export function DynamicCharts({
  statements,
  variant,
  t: fixedT,
  locale: fixedLocale,
  currency,
}: {
  statements: StatementBundle[]
  variant: 'print' | 'screen'
  /** Fixed-language t for the print report; defaults to the UI language. */
  t?: TFunction
  locale?: string
  /** Shown in the amounts chart's title when given. */
  currency?: string
}) {
  const { t: uiT, i18n } = useTranslation()
  const t = fixedT ?? uiT
  const locale = fixedLocale ?? i18n.language
  const data = buildDynamicChartData(statements)

  const amounts: SeriesDef[] = [
    { dataKey: 'revenue', name: t('report.rows.revenue') },
    { dataKey: 'receivables', name: t('report.rows.accountsReceivable') },
    { dataKey: 'payables', name: t('report.rows.accountsPayable') },
  ]
  const days: SeriesDef[] = [
    { dataKey: 'dio', name: 'DIO' },
    { dataKey: 'dpo', name: 'DPO' },
    { dataKey: 'dso', name: 'DSO' },
  ]

  return (
    <div className={variant === 'print' ? 'grid grid-cols-2 gap-6' : 'grid gap-5 lg:grid-cols-2'}>
      <div className="report-chart min-w-0">
        <h3 className="mb-1 font-display text-small font-bold text-accent-600">
          {currency ? t('report.charts2.revRecPay', { currency }) : t('report.charts.revRecPay')}
        </h3>
        <ChartLegend series={amounts} />
        <DynamicsLineChart
          data={data}
          variant={variant}
          series={amounts}
          locale={locale}
          days={false}
        />
      </div>

      <div className="report-chart min-w-0">
        <h3 className="mb-1 font-display text-small font-bold text-accent-600">
          {t('report.charts2.turnover')}
        </h3>
        <ChartLegend series={days} />
        <DynamicsLineChart data={data} variant={variant} series={days} locale={locale} days />
      </div>
    </div>
  )
}
