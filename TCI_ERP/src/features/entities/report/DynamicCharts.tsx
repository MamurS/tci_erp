/**
 * The two dynamics charts (revenue/receivables/payables and DSO/DIO/DPO),
 * shared by the print report and the buyer dashboard. `variant="print"`
 * renders at a fixed width (print pagination needs stable geometry);
 * `variant="screen"` is responsive with tooltips.
 */

import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { StatementBundle } from '../types'
import type { ChartRow } from './chartData'
import { buildDynamicChartData } from './chartData'

const CHART_COLORS = ['#4f46e5', '#16a34a', '#dc2626']

interface SeriesDef {
  dataKey: keyof ChartRow
  name: string
}

function DynamicsLineChart({
  data,
  series,
  variant,
  yAxisWidth,
}: {
  data: ChartRow[]
  series: SeriesDef[]
  variant: 'print' | 'screen'
  yAxisWidth: number
}) {
  const axis = { fontSize: 10, fill: '#64748b' }
  const chart = (width?: number, height?: number) => (
    <LineChart width={width} height={height} data={data} margin={{ top: 8, right: 16 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
      <XAxis dataKey="period" tick={axis} />
      <YAxis tick={axis} width={yAxisWidth} />
      <Tooltip />
      <Legend wrapperStyle={{ fontSize: 11 }} />
      {series.map((s, idx) => (
        <Line
          key={s.dataKey}
          dataKey={s.dataKey}
          name={s.name}
          stroke={CHART_COLORS[idx]}
          strokeWidth={2}
          dot={{ r: 2.5 }}
        />
      ))}
    </LineChart>
  )

  if (variant === 'print') return chart(700, 220)
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
}: {
  statements: StatementBundle[]
  variant: 'print' | 'screen'
  /** Fixed-language t for the print report; defaults to the UI language. */
  t?: TFunction
}) {
  const { t: uiT } = useTranslation()
  const t = fixedT ?? uiT
  const data = buildDynamicChartData(statements)

  return (
    <div className={variant === 'print' ? 'flex flex-col gap-6' : 'grid gap-5 lg:grid-cols-2'}>
      <div className="report-chart">
        <h3 className="mb-1 text-[13px] font-semibold text-slate-600">
          {t('report.charts.revRecPay')}
        </h3>
        <DynamicsLineChart
          data={data}
          variant={variant}
          yAxisWidth={70}
          series={[
            { dataKey: 'revenue', name: t('fin.lines.revenue') },
            { dataKey: 'receivables', name: t('fin.lines.trade_receivables') },
            { dataKey: 'payables', name: t('fin.lines.trade_payables') },
          ]}
        />
      </div>

      <div className="report-chart">
        <h3 className="mb-1 text-[13px] font-semibold text-slate-600">
          {t('report.charts.workingCapitalDays')}
        </h3>
        <DynamicsLineChart
          data={data}
          variant={variant}
          yAxisWidth={40}
          series={[
            { dataKey: 'dso', name: 'DSO' },
            { dataKey: 'dio', name: 'DIO' },
            { dataKey: 'dpo', name: 'DPO' },
          ]}
        />
      </div>
    </div>
  )
}
