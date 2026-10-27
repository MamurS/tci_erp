/**
 * A human-scale amount for summaries (Prompt 30, phase 2): «3.18B UZS» on a
 * key figure, a chip or a sentence, with the full value on hover and for
 * screen readers. Tables keep full values — never both styles in one column.
 */

import { useTranslation } from 'react-i18next'

import { formatAmount, formatCompact } from '../../lib/format'

export function HumanAmount({
  value,
  currency,
  decimals = 2,
  className = '',
}: {
  value: number | null | undefined
  currency?: string | null
  decimals?: number
  className?: string
}) {
  const { i18n } = useTranslation()
  const full = `${formatAmount(value, i18n.language, 2)}${currency ? ` ${currency}` : ''}`
  return (
    <span className={`tabular-nums ${className}`} title={full} aria-label={full}>
      {formatCompact(value, i18n.language, decimals)}
      {currency ? ` ${currency}` : ''}
    </span>
  )
}
