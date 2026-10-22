/** Small building blocks shared by the two portfolio pages. */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Panel, Table } from '../../components/ui'
import type { ColumnWidth } from '../../components/ui'
import { formatPercent } from '../../lib/format'

/** A share of a whole, as a bar and a percentage (the percentage alone when
 *  `compact`, for narrow cards). Null renders "—". */
export function ShareBar({ share, compact = false }: { share: number | null; compact?: boolean }) {
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  return (
    <div className="flex items-center justify-end gap-2">
      {!compact && (
        <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 sm:block" aria-hidden="true">
          <div className="h-full rounded-full bg-accent-500" style={{ width: `${Math.round((share ?? 0) * 100)}%` }} />
        </div>
      )}
      <span className="num w-12 shrink-0 text-right text-[12px] text-slate-600">{formatPercent(share, locale)}</span>
    </div>
  )
}

/** A titled card holding a dense table, or its empty line. */
export function TableCard({
  title,
  hint,
  empty,
  head,
  columns,
  fillMin,
  children,
}: {
  title: ReactNode
  hint?: ReactNode
  /** The table's column widths (DESIGN.md «No layout shift»). */
  columns: readonly ColumnWidth[]
  /** These cards are often half a page wide: the name column may get narrow. */
  fillMin?: string
  /** Shown instead of the table when there are no rows. */
  empty: ReactNode | null
  head: ReactNode
  children: ReactNode
}) {
  return (
    <Panel title={title} hint={hint}>
      {empty ? (
        <p className="py-4 text-[13px] text-slate-500">{empty}</p>
      ) : (
        <Table dense columns={columns} fillMin={fillMin}>
          <thead>{head}</thead>
          <tbody>{children}</tbody>
        </Table>
      )}
    </Panel>
  )
}
