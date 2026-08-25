/**
 * GradeScale primitive: horizontal band scale for the 1-100 rating score
 * (lower is better). Zone boundaries come from the analytics service via
 * useGradeScale (single source of truth in the engine); when the service is
 * unavailable the component degrades to marker + label without zones.
 */

import { useTranslation } from 'react-i18next'

import { formatAmount } from '../../lib/format'
import { gradeTone } from '../../lib/grade'
import { scorePosition, zoneSegments } from '../../lib/gradeScale'
import type { GradeBand, GradeChange } from '../../lib/gradeScale'
import { Badge } from './primitives'

const ZONE_CLASSES: Record<string, string> = {
  pos: 'bg-pos-500/70',
  accent: 'bg-accent-500/60',
  warn: 'bg-warn-500/60',
  neg: 'bg-neg-500/70',
}

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
  const tone = gradeTone(grade)

  return (
    <div className={compact ? 'w-56' : 'w-full'}>
      <div className={`flex items-baseline gap-3 ${compact ? 'mb-1' : 'mb-2'}`}>
        <span
          className={`font-bold ${compact ? 'text-lg' : 'text-4xl'} ${
            tone === 'pos'
              ? 'text-pos-500'
              : tone === 'warn'
                ? 'text-warn-500'
                : tone === 'neg'
                  ? 'text-neg-500'
                  : 'text-accent-700'
          }`}
        >
          {grade}
        </span>
        <span className={`num text-slate-500 ${compact ? 'text-sm' : 'text-lg'}`}>
          {formatAmount(score, locale, 1)} / 100
        </span>
        {change && (
          <Badge tone={change.improved ? 'pos' : 'neg'}>
            <span aria-hidden="true" className="mr-0.5">
              {change.improved ? '▼' : '▲'}
            </span>
            {change.gradeSteps !== 0
              ? t('rating.scale.gradeSteps', { count: Math.abs(change.gradeSteps) })
              : t('rating.scale.scorePoints', {
                  points: formatAmount(Math.abs(change.scoreDelta), locale, 1),
                })}
          </Badge>
        )}
      </div>

      <div className={`relative ${compact ? 'h-2' : 'h-3'}`}>
        <div className="absolute inset-0 flex overflow-hidden rounded-full">
          {bands && bands.length > 0 ? (
            zoneSegments(bands).map(({ band, widthPct }) => (
              <div
                key={band.code}
                style={{ width: `${widthPct}%` }}
                className={ZONE_CLASSES[gradeTone(band.code)]}
                title={`${band.code}: ${band.lower}–${band.upper}`}
              />
            ))
          ) : (
            <div className="w-full bg-slate-200" />
          )}
        </div>
        {/* Score marker */}
        <div
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow"
          style={{ left: `${position}%` }}
          role="img"
          aria-label={`${grade} ${score}`}
        />
      </div>

      {!compact && bands && bands.length > 0 && (
        <div className="mt-1 flex text-[10px] text-slate-400">
          {zoneSegments(bands).map(({ band, widthPct }) => (
            <div key={band.code} style={{ width: `${widthPct}%` }} className="text-center">
              {widthPct >= 8 ? band.code : ''}
            </div>
          ))}
        </div>
      )}
      {!compact && (
        <p className="mt-1 text-xs text-slate-400">{t('rating.scaleHint')}</p>
      )}
    </div>
  )
}
