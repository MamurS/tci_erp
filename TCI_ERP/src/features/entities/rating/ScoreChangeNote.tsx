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
}: {
  score: number | null
  previousScore: number | null | undefined
  /** The report passes its fixed-language `t` and locale. */
  t?: TFunction
  locale?: string
}) {
  const { t: tHook, i18n } = useTranslation()
  const t = tProp ?? tHook
  const locale = localeProp ?? i18n.resolvedLanguage ?? 'en'

  if (score === null) return <p className="mt-1.5 text-center text-[0.75rem] text-slate-500">{t('rating.notRated')}</p>
  const change = scoreChange(score, previousScore)
  if (!change) return null
  const delta = formatAmount(Math.abs(change.delta), locale, 1)
  const tone =
    change.direction === 'better' ? 'text-pos-500' : change.direction === 'worse' ? 'text-neg-500' : 'text-slate-500'
  return (
    <p className={`mt-1.5 text-center text-[0.75rem] ${tone}`}>
      {t(`rating.scoreChange.${change.direction}`, { delta })}
    </p>
  )
}
