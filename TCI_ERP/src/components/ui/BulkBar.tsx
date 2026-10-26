/**
 * The bulk-action bar (Prompt 30, phase 2): it appears only once rows are
 * selected, at the foot of the viewport, saying how many and offering what
 * can be done to all of them, with a way to clear the selection.
 */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from './primitives'

export function BulkBar({
  count,
  onClear,
  children,
}: {
  count: number
  onClear: () => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  if (count === 0) return null
  return (
    <div
      role="region"
      aria-label={t('ui.bulk.label')}
      data-bulk-bar
      className="animate-fade-in sticky bottom-4 z-20 mx-auto mt-4 flex w-fit max-w-full flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2 shadow-pop"
    >
      <span className="text-body font-semibold text-slate-800 tabular-nums">
        {t('ui.bulk.selected', { count })}
      </span>
      <span className="flex flex-wrap items-center gap-2">{children}</span>
      <Button variant="ghost" size="sm" onClick={onClear}>
        {t('ui.bulk.clear')}
      </Button>
    </div>
  )
}
