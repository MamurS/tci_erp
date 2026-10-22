/** The mark a system-made decision carries instead of an author: «Авторешение
 * (ADT)» for an auto decision (0061), the suspension reason for an NOA or a
 * claim (0028, 0034). The key is the decision's own system_reason_key — an
 * i18n key, never stored text. A decision a person made renders nothing. */

import { Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '../../components/ui'
import { decisionMarkKey, isAutoDecision } from './adt'

export function DecisionMark({ reasonKey }: { reasonKey: string | null | undefined }) {
  const { t } = useTranslation()
  const key = decisionMarkKey({ system_reason_key: reasonKey })
  if (!key) return null
  const auto = isAutoDecision({ system_reason_key: key })
  return (
    <span title={auto ? t('limits.auto.markHint') : undefined}>
      <Badge tone={auto ? 'accent' : 'neutral'}>
        {auto && <Zap className="size-3" aria-hidden />}
        {t(key)}
      </Badge>
    </span>
  )
}
