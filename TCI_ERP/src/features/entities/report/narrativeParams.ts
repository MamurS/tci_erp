/** Locale formatting of raw narrative bullet params (amounts, ratios, %).
 * Shared by the print report and the buyer dashboard. */

import type { TFunction } from 'i18next'

import { formatAmount, formatRatio } from '../../../lib/format'
import type { NarrativeBullet } from './narrative'

export function formatNarrativeParams(
  bullet: Pick<NarrativeBullet, 'key' | 'params'>,
  t: TFunction,
  locale: string,
): Record<string, string | number> {
  const p = bullet.params
  const currency = String(p.currency ?? '')
  const money = (v: number | string) => `${formatAmount(Number(v), locale)} ${currency}`
  const out: Record<string, string | number> = { ...p }

  if ('amount' in p) out.amount = money(p.amount)
  if ('prev' in p) out.prev = money(p.prev)
  if ('pct' in p) out.pct = formatAmount(Number(p.pct), locale, 1)
  if ('from' in p && bullet.key.startsWith('gross_margin'))
    out.from = formatAmount(Number(p.from), locale, 1)
  if ('to' in p && bullet.key.startsWith('gross_margin'))
    out.to = formatAmount(Number(p.to), locale, 1)
  if ('margin' in p && p.margin !== '') out.margin = formatAmount(Number(p.margin), locale, 1)
  if ('value' in p) out.value = formatRatio(Number(p.value), locale)
  if ('rows' in p) {
    out.rows = String(p.rows)
      .split('|')
      .map((key) => t(`fin.risk.rows.${key}`))
      .join(', ')
  }
  return out
}
