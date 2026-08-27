/** The release state of a limit decision, rendered identically everywhere:
 * «у клиента с …» / «окно продаж до …» / «на удержании: …». Derived from
 * release.ts — the mirror of tci.decision_is_released. */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '../../components/ui'
import { formatMoment } from '../../lib/format'
import { releaseStatus } from './release'
import type { ReleaseFacts } from './release'

export function ReleaseBadge({
  facts,
  salesWindowHours,
  nowIso,
}: {
  facts: ReleaseFacts & { hold_comment?: string | null }
  salesWindowHours: number
  nowIso: string
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const status = releaseStatus(facts, salesWindowHours, nowIso)

  if (status.state === 'held') {
    // A hold comment is free text and can be long: the badge keeps one
    // line, the full text lives in the tooltip.
    const comment = status.comment ?? ''
    return (
      <Wrap title={comment}>
        <Badge tone="warn">
          {comment
            ? t('limits.release.heldWith', { comment: truncate(comment) })
            : t('limits.release.held')}
        </Badge>
      </Wrap>
    )
  }

  if (status.state === 'window') {
    return (
      <Wrap title={t('limits.release.window', { until: formatMoment(status.endsAt, locale) })}>
        <Badge tone="neutral">
          {t('limits.release.window', { until: formatMoment(status.endsAt, locale) })}
        </Badge>
      </Wrap>
    )
  }

  // Released. The KIND explains how it got there and belongs in the
  // tooltip; the badge itself stays short enough for a table cell.
  const kindLabel = t(`limits.release.kinds.${status.kind}`)
  return (
    <Wrap title={kindLabel}>
      <Badge tone={status.kind === 'immediate' ? 'neg' : 'pos'}>
        {status.at
          ? t('limits.release.withClientSince', { since: formatMoment(status.at, locale) })
          : t('limits.release.withClient')}
      </Badge>
    </Wrap>
  )
}

/** Keeps a badge on one line and carries the long form as a tooltip. */
function Wrap({ title, children }: { title: string; children: ReactNode }) {
  return (
    <span className="inline-block whitespace-nowrap" title={title}>
      {children}
    </span>
  )
}

function truncate(value: string, max = 40): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}
