/**
 * An Allianz Trade country rating as a badge — «BB2» — with what it means
 * and where it was read on hover. Toned by the short-term level, never
 * green (referenceRatings.ts); «no longer rated» is said in words.
 */

import { useTranslation } from 'react-i18next'

import { Badge } from '../../components/ui'
import { formatDate } from '../../lib/format'
import type { ReferenceRating } from '../risk/api'
import { LEVEL_LABEL, parseReferenceRating, referenceTone } from './referenceRatings'

export function ReferenceRatingBadge({ rating }: { rating: ReferenceRating }) {
  const { t, i18n } = useTranslation()
  const parsed = parseReferenceRating(rating.rating)
  const asOf = formatDate(rating.as_of, i18n.language)
  if (!parsed) {
    return (
      <span className="text-small text-slate-500" title={[rating.note, rating.reference].filter(Boolean).join(' · ')}>
        {t('risk.reference.notRated')}
      </span>
    )
  }
  const title = [
    t('risk.reference.badgeTitle', {
      code: parsed.code,
      grade: parsed.grade,
      level: parsed.level,
      label: t(`risk.reference.level.${LEVEL_LABEL[parsed.level]}`),
    }),
    t('risk.reference.asOfShort', { date: asOf }),
    rating.reference,
  ].join(' · ')
  return (
    <span data-risk="reference" className="inline-flex items-center">
      <Badge tone={referenceTone(parsed.level)} title={title}>
        <span className="font-mono">{parsed.code}</span>
        <span className="sr-only">{title}</span>
      </Badge>
    </span>
  )
}
