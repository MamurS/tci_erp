/**
 * The sector page's two small charts. One series each (no legend: the title
 * names it), thin marks, a recessive grid, a tooltip on hover, colours from
 * the tokens (`var(--color-…)`) so they follow the theme and dark mode.
 *
 *  * The grade over time — every approved review at the moment it came into
 *    force, held until the next (a step), A on top. Each dot wears its
 *    grade's own colour from the grade scale.
 *  * Today's active limits by the month they took effect, added up — NOT the
 *    sector's past exposure: nothing stores past books, and a limit since
 *    revoked or expired is not in today's. The title and the note say so.
 */

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Area, AreaChart } from 'recharts'
import { useTranslation } from 'react-i18next'

import { formatAmount, formatCompact, formatDate, formatPeriod } from '../../lib/format'
import { useUiTextScaleValue } from '../../lib/uiScale'
import { POSITION_GRADE } from './model'
import type { ExposurePoint, GradePoint } from './model'

/** The grade scale's solid of a sector grade (A as A1 … D). */
const GRADE_SOLID = {
  A: 'var(--color-grade-a1)',
  B: 'var(--color-grade-b1)',
  C: 'var(--color-grade-c1)',
  D: 'var(--color-grade-d)',
} as const

const LINE = 'var(--color-accent-600)'

function useTickSize(): string {
  // SVG labels do not read the type tokens: sized at the person's text size.
  return `${(0.6875 * useUiTextScaleValue()) / 100}rem`
}

export function GradeHistoryChart({ points }: { points: GradePoint[] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const tickSize = useTickSize()
  return (
    <div className="h-52" role="img" aria-label={t('risk.sectors.charts.gradeAria', { count: points.filter((p) => !p.carried).length })}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 12, right: 20, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-slate-200)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="at"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(v: number) => formatDate(new Date(v), locale)}
            minTickGap={24}
            padding={{ left: 12, right: 12 }}
            tick={{ fontSize: tickSize, fill: 'var(--color-slate-500)' }}
            stroke="var(--color-slate-300)"
          />
          <YAxis
            reversed
            type="number"
            domain={[1, 4]}
            ticks={[1, 2, 3, 4]}
            allowDecimals={false}
            tickFormatter={(v: number) => POSITION_GRADE[v] ?? ''}
            width={28}
            tick={{ fontSize: tickSize, fill: 'var(--color-slate-500)' }}
            stroke="var(--color-slate-300)"
          />
          <Tooltip
            formatter={(_v, _n, item) => {
              const p = item.payload as GradePoint
              return [`${p.grade} · ${t(`risk.sectors.outlooks.${p.outlook}`)}`, t('risk.sectors.fields.grade')]
            }}
            labelFormatter={(_l, payload) => {
              const p = payload?.[0]?.payload as GradePoint | undefined
              if (!p) return ''
              return p.carried ? t('risk.sectors.charts.today') : `${formatDate(new Date(p.at), locale)} · ${t(`risk.sectors.kinds.${p.kind}`)}`
            }}
          />
          <Line
            type="stepAfter"
            dataKey="value"
            stroke={LINE}
            strokeWidth={2}
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; index?: number; payload?: GradePoint }) => {
              const p = props.payload
              if (!p || p.carried || props.cx === undefined || props.cy === undefined)
                return <g key={`d-${props.index}`} />
              return (
                <circle
                  key={`d-${props.index}`}
                  cx={props.cx}
                  cy={props.cy}
                  r={5}
                  fill={GRADE_SOLID[p.grade]}
                  stroke="var(--color-white)"
                  strokeWidth={2}
                />
              )
            }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ExposureChart({ points }: { points: ExposurePoint[] }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const tickSize = useTickSize()
  // A month as a person names it («сентябрь 2026»): the one formatter's period.
  const label = (month: string) => {
    const [y, m] = month.split('-').map(Number)
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return formatPeriod(`${month}-01`, `${month}-${String(last).padStart(2, '0')}`, locale)
  }
  return (
    <div className="h-52" role="img" aria-label={t('risk.sectors.charts.exposureAria')}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 12, right: 20, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--color-slate-200)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={label}
            minTickGap={24}
            tick={{ fontSize: tickSize, fill: 'var(--color-slate-500)' }}
            stroke="var(--color-slate-300)"
          />
          <YAxis
            tickFormatter={(v: number) => formatCompact(v, locale, 1)}
            width={56}
            tick={{ fontSize: tickSize, fill: 'var(--color-slate-500)' }}
            stroke="var(--color-slate-300)"
          />
          <Tooltip
            formatter={(value, _n, item) => {
              const p = item.payload as ExposurePoint
              return [
                `${formatAmount(Number(value), locale)} UZS`,
                p.added > 0
                  ? t('risk.sectors.charts.addedThisMonth', { amount: formatAmount(p.added, locale) })
                  : t('risk.sectors.charts.cumulative'),
              ]
            }}
            labelFormatter={(m) => label(String(m))}
          />
          <Area
            type="stepAfter"
            dataKey="cumulative"
            stroke={LINE}
            strokeWidth={2}
            fill="var(--color-accent-100)"
            fillOpacity={0.6}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

