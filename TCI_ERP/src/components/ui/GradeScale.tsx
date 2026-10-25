/**
 * GradeScale primitive: the 1-100 rating score (lower is better) on the
 * ten-colour band of the risk report, with the engine grade beside it.
 *
 * The colour bar is the presentation scale (src/lib/ratingScale.ts). The
 * engine's grade bands (A1…D, from GET /grade-scale — single source of truth
 * in credit_engine) are drawn as ticks under the bar when the service is
 * reachable; without it the component still shows the score and the grade.
 */

import { useTranslation } from 'react-i18next'

import { formatAmount } from '../../lib/format'
import { gradeTone } from '../../lib/grade'
import { scorePosition } from '../../lib/gradeScale'
import type { GradeBand, GradeChange } from '../../lib/gradeScale'
import { SCALE_COLORS, SCALE_LABEL_KEYS, placeScore } from '../../lib/ratingScale'
import { Badge } from './primitives'

interface GradeScaleProps {
  score: number
  grade: string
  bands: GradeBand[] | undefined
  change?: GradeChange | null
  size?: 'full' | 'compact'
}

export function GradeScale({ score, grade, bands, change, size = 'full' }: GradeScaleProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const compact = size === 'compact'
  const position = scorePosition(score)
  const placement = placeScore(score)
  const bandText =
    placement.kind === 'in'
      ? t(`rating.scale10.${SCALE_LABEL_KEYS[placement.point]}`)
      : `${t(`rating.scale10.${SCALE_LABEL_KEYS[placement.lower]}`)} – ${t(
          `rating.scale10.${SCALE_LABEL_KEYS[placement.upper]}`,
        )}`

  return (
    <div className={compact ? 'w-60' : 'w-full'}>
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${compact ? 'mb-1.5' : 'mb-2.5'}`}>
        <span
          className={`font-display leading-none font-bold text-accent-600 ${compact ? 'text-[1.625rem]' : 'text-[2.75rem]'}`}
        >
          {formatAmount(score, locale, 0)}
        </span>
        <Badge tone={gradeTone(grade)} size={compact ? 'sm' : 'md'}>
          {grade}
        </Badge>
        <span className={`text-slate-500 ${compact ? 'text-xs' : 'text-sm'}`}>{bandText}</span>
        {change && (
          <Badge tone={change.improved ? 'pos' : 'neg'} size={compact ? 'sm' : 'md'}>
            <span aria-hidden="true">{change.improved ? '▼' : '▲'}</span>
            {change.gradeSteps !== 0
              ? t('rating.scale.gradeSteps', { count: Math.abs(change.gradeSteps) })
              : t('rating.scale.scorePoints', {
                  points: formatAmount(Math.abs(change.scoreDelta), locale, 1),
                })}
          </Badge>
        )}
      </div>

      <div className={`relative ${compact ? 'h-2' : 'h-3'}`}>
        <div className="absolute inset-0 flex gap-px overflow-hidden rounded-full">
          {SCALE_COLORS.map((color) => (
            <div key={color} className="h-full flex-1" style={{ backgroundColor: color }} />
          ))}
        </div>
        <div
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent-800 shadow-md ${
            compact ? 'size-3.5' : 'size-[1.125rem]'
          }`}
          style={{ left: `${position}%` }}
          role="img"
          aria-label={`${grade} ${score}`}
        />
      </div>

      {!compact && (
        <div className="relative mt-1 h-4 text-[0.625rem] text-slate-400">
          {(bands ?? []).slice(0, -1).map((band) => (
            <span
              key={band.code}
              className="absolute -translate-x-1/2 border-l border-slate-300 pl-0.5"
              style={{ left: `${band.upper}%` }}
              title={`${band.code} ≤ ${band.upper}`}
            >
              {band.upper}
            </span>
          ))}
          <span className="absolute left-0">0</span>
          <span className="absolute right-0">100</span>
        </div>
      )}
      {!compact && <p className="mt-1 text-xs text-slate-400">{t('rating.scaleHint')}</p>}
    </div>
  )
}
