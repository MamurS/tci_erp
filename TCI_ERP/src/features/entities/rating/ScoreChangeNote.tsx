/**
 * The line under the rating gauge. The score runs 1–100 with LOWER better,
 * so an arrow («▼ 1.5») is ambiguous — down the scale is up in quality. The
 * move is said in words instead: «1.5 points better than the previous
 * rating». An unrated gauge says so, rather than showing a bare dash.
 */

import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'

import { formatAmount } from '../../../lib/format'
import { scoreChange } from '../../../lib/ratingScale'

export function ScoreChangeNote({
  score,
  previousScore,
  t: tProp,
  locale: localeProp,
  align = 'center',
}: {
  score: number | null
  previousScore: number | null | undefined
  /** The report passes its fixed-language `t` and locale. */
  t?: TFunction
  locale?: string
  /** Centred under the report's gauge; at the start under the rating tab's scale. */
  align?: 'center' | 'start'
}) {
  const { t: tHook, i18n } = useTranslation()
  const t = tProp ?? tHook
  const locale = localeProp ?? i18n.resolvedLanguage ?? 'en'

  const place = align === 'center' ? 'mt-2 text-center' : ''
  if (score === null) return <p className={`${place} text-caption text-slate-500`}>{t('rating.notRated')}</p>
  const change = scoreChange(score, previousScore)
  if (!change) return null
  const delta = formatAmount(Math.abs(change.delta), locale, 1)
  const tone =
    change.direction === 'better' ? 'text-pos-500' : change.direction === 'worse' ? 'text-neg-500' : 'text-slate-500'
  return (
    <p className={`${place} text-caption ${tone}`}>
      {t(`rating.scoreChange.${change.direction}`, { delta })}
    </p>
  )
}
