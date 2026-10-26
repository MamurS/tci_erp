/** Small pieces shared by the workbench views. */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge } from '../../../components/ui'
import { formatCompact } from '../../../lib/format'
import { num } from '../../portfolio/aggregate'

const BAND_TONE = { A: 'pos', B: 'accent', C: 'warn', D: 'neg', unrated: 'neutral' } as const

/** The rating as ONE badge: the grade ("C2") coloured by its band, or the
 * band's name when there is no grade. Never the band and the grade side by
 * side ("C C2"), which says the same thing twice. */
export function BandBadge({ band, grade }: { band: string; grade?: string | null }) {
  const { t } = useTranslation()
  return (
    <span title={grade ? t(`limits.bands.${band}`) : undefined}>
      <Badge tone={BAND_TONE[band as keyof typeof BAND_TONE] ?? 'neutral'}>{grade || t(`limits.bands.${band}`)}</Badge>
    </span>
  )
}

/** An amount in UZS, compact; "—" when there is no rate (never 0). */
export function Uzs({ value }: { value: number | string | null }) {
  const { i18n } = useTranslation()
  const n = num(value)
  if (n === null) return <span className="text-slate-500">—</span>
  return <span className="whitespace-nowrap">{formatCompact(n, i18n.resolvedLanguage ?? 'en')} UZS</span>
}

/** A company name linking to its card, optionally on a given tab; `children`
 * render the name differently (a search match marked). */
export function EntityLink({
  id,
  name,
  tab,
  children,
}: {
  id: string
  name: string
  tab?: string
  children?: ReactNode
}) {
  return (
    <Link
      to={tab ? `/entities/${id}?tab=${tab}` : `/entities/${id}`}
      className="font-medium text-accent-600 hover:text-accent-500"
    >
      {children ?? name}
    </Link>
  )
}
