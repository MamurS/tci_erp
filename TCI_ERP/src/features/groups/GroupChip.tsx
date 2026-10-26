/** A one-line group marker for pages that decide something about a buyer.
 *
 * On a limit or a claim, the question "is this company part of a group we are
 * already exposed to?" has to be visible without navigating away. A company
 * that stands alone renders nothing: silence is the honest answer there.
 */

import { Network } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge } from '../../components/ui'
import { formatAmount } from '../../lib/format'
import { useEntityGroup, useGroupExposure } from './api'

/** `compact`: a one-line chip for a page header's meta line, the exposure
 * sentence moved into its tooltip. */
export function GroupChip({ entityId, compact = false }: { entityId: string; compact?: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'

  const group = useEntityGroup(entityId)
  const members = group.data ?? []
  const parentId = members[0]?.ultimate_parent_id
  const exposure = useGroupExposure(parentId)

  if (members.length <= 1 || !parentId) return null

  const parentName = exposure.data?.ultimate_parent_name ?? ''
  const body = t('groups.chip.body', {
    parent: parentName,
    count: members.length,
    exposure: formatAmount(Number(exposure.data?.exposure_uzs ?? 0), locale),
  })

  if (compact)
    return (
      <Link
        to={`/entities/${entityId}?tab=group`}
        title={body}
        className="inline-flex items-center gap-2 text-accent-600 hover:underline"
      >
        <Network className="size-3.5" aria-hidden />
        {t('groups.chip.short', { parent: parentName })}
      </Link>
    )

  return (
    <Link
      to={`/entities/${entityId}?tab=group`}
      className="inline-flex items-center gap-2 text-small text-slate-600 hover:underline"
    >
      <Badge tone="accent">{t('groups.chip.label')}</Badge>
      <span>{body}</span>
    </Link>
  )
}
