/**
 * The credit rating dial and the ten-band legend of the risk report
 * (reference: the Delcreda report, page 1). Pure SVG, no chart library, so it
 * prints crisply and renders identically on screen and in the PDF.
 *
 * Lower score = better. The score itself comes from the engine; this only
 * draws it (src/lib/ratingScale.ts holds the geometry and colours).
 */

import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'

import {
  SCALE_LABEL_KEYS,
  SCALE_POINTS,
  colorForPoint,
  gaugeAngle,
  placeScore,
  scoreChange,
} from '../../lib/ratingScale'
import type { ScalePoint } from '../../lib/ratingScale'

const CX = 100
const CY = 100
const R_OUTER = 88
const R_INNER = 58
const GAP_DEG = 1.6

function polar(r: number, deg: number): [number, number] {
  const rad = (deg * Math.PI) / 180
  return [CX + r * Math.cos(rad), CY - r * Math.sin(rad)]
}

function wedge(fromDeg: number, toDeg: number): string {
  const [x1, y1] = polar(R_OUTER, fromDeg)
  const [x2, y2] = polar(R_OUTER, toDeg)
  const [x3, y3] = polar(R_INNER, toDeg)
  const [x4, y4] = polar(R_INNER, fromDeg)
  return `M${x1},${y1} A${R_OUTER},${R_OUTER} 0 0 1 ${x2},${y2} L${x3},${y3} A${R_INNER},${R_INNER} 0 0 0 ${x4},${y4} Z`
}

interface RatingGaugeProps {
  score: number | null
  previousScore?: number | null
  /** Translation function — the report passes its fixed-language `t`. */
  t?: TFunction
  className?: string
}

export function RatingGauge({ score, previousScore, t: tProp, className = '' }: RatingGaugeProps) {
  const { t: tHook } = useTranslation()
  const t = tProp ?? tHook
  const change = score === null ? null : scoreChange(score, previousScore)
  const angle = score === null ? null : gaugeAngle(score)
  const needle = angle === null ? null : polar(R_OUTER - 14, angle)
  // Needle base: two points either side of the hub, for a tapered blade.
  const base =
    angle === null
      ? null
      : [polar(4.2, angle + 90), polar(4.2, angle - 90)].map(([x, y]) => `${x},${y}`).join(' ')

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <svg
        viewBox="0 0 200 116"
        className="w-full max-w-[14.375rem]"
        role="img"
        aria-label={score === null ? '—' : String(Math.round(score))}
      >
        {SCALE_POINTS.map((point, i) => {
          const from = 180 - i * 18 - (i === 0 ? 0 : GAP_DEG / 2)
          const to = 180 - (i + 1) * 18 + (i === 9 ? 0 : GAP_DEG / 2)
          return <path key={point} d={wedge(from, to)} fill={colorForPoint(point)} />
        })}
        <text x={CX - R_OUTER + 6} y={113} fontSize="7" fill="#666" textAnchor="middle">
          0
        </text>
        <text x={CX + R_OUTER - 6} y={113} fontSize="7" fill="#666" textAnchor="middle">
          100
        </text>
        {needle && base && (
          <>
            <polygon points={`${base} ${needle[0]},${needle[1]}`} fill="#003557" />
            <circle cx={CX} cy={CY} r={6.5} fill="#003557" />
            <circle cx={CX} cy={CY} r={2.2} fill="#fff" />
          </>
        )}
      </svg>
      <div className="-mt-1 font-display text-display leading-none font-bold text-accent-600">
        {score === null ? '—' : Math.round(score)}
      </div>
      {change && (
        <div
          className={`mt-2 text-caption ${
            change.direction === 'worse'
              ? 'text-neg-500'
              : change.direction === 'better'
                ? 'text-pos-500'
                : 'text-slate-500'
          }`}
        >
          {change.direction === 'same'
            ? `±0 ${t('rating.vsPrevious')}`
            : `${change.direction === 'worse' ? '▲' : '▼'} ${Math.abs(change.delta)} ${t('rating.vsPrevious')}`}
        </div>
      )}
    </div>
  )
}

interface RatingLegendProps {
  t?: TFunction
  /** Highlight the cell the score falls in. */
  score?: number | null
  className?: string
}

/** «LEGEND: CREDIT RATING SCALE» — ten coloured cells and their names. */
export function RatingLegend({ t: tProp, score, className = '' }: RatingLegendProps) {
  const { t: tHook } = useTranslation()
  const t = tProp ?? tHook
  // The same placement the report's text uses: "in" one band, or between two.
  const placement = score === null || score === undefined ? null : placeScore(score)
  const isActive = (point: ScalePoint) =>
    placement !== null &&
    (placement.kind === 'in'
      ? placement.point === point
      : placement.lower === point || placement.upper === point)
  return (
    <div className={className}>
      <div className="mb-1 font-display text-caption font-bold tracking-wide text-accent-600 uppercase">
        {t('rating.legendTitle')}
      </div>
      <div className="grid grid-cols-10 gap-px">
        {SCALE_POINTS.map((point) => (
          <div
            key={point}
            className={`py-0.5 text-center font-display text-caption font-bold text-white ${
              isActive(point) ? 'ring-2 ring-accent-600 ring-inset' : ''
            }`}
            style={{ backgroundColor: colorForPoint(point) }}
          >
            {point}
          </div>
        ))}
      </div>
      <div className="mt-0.5 grid grid-cols-10 gap-px">
        {SCALE_POINTS.map((point) => (
          <div
            key={point}
            className="text-center font-display text-caption leading-tight [overflow-wrap:anywhere] text-slate-500 hyphens-auto"
          >
            {t(`rating.scale10.${SCALE_LABEL_KEYS[point]}`)}
          </div>
        ))}
      </div>
    </div>
  )
}
