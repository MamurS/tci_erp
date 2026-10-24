/** The requested amount against the policy's discretionary limit, live under
 * the amount on both limit request forms (staff and portal). Informative only:
 * the request may be sent whatever it says. */

import { useTranslation } from 'react-i18next'

import { Callout } from '../../components/ui'
import { formatAmount } from '../../lib/format'
import { dlPosition } from './discretionary'

export function DlNote({
  amount,
  dl,
  currency,
  audience,
}: {
  amount: number | null
  dl: number | null | undefined
  currency: string
  /** The client reads "your policy"; staff read "the policy". */
  audience: 'client' | 'staff'
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'ru'
  const position = dlPosition(amount, dl)
  const money = (value: number) => `${formatAmount(value, locale)} ${currency}`
  const base = `limits.dl.${audience}`

  switch (position.kind) {
    case 'none':
      return <Callout tone="info" title={t(`${base}.noneTitle`)}>{t(`${base}.noneBody`)}</Callout>
    case 'known':
      return <Callout tone="info" title={t(`${base}.knownTitle`, { dl: money(position.dl) })}>{t(`${base}.knownBody`)}</Callout>
    case 'within':
      return (
        <Callout tone="info" title={t(`${base}.withinTitle`, { dl: money(position.dl) })}>
          {t(`${base}.withinBody`)}
        </Callout>
      )
    case 'above':
      return (
        <Callout
          tone="info"
          title={t(`${base}.aboveTitle`, { dl: money(position.dl), excess: money(position.excess) })}
        >
          {t(`${base}.aboveBody`)}
        </Callout>
      )
  }
}
