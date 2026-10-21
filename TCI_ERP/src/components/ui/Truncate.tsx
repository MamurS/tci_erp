/**
 * A name in a table cell: one line, cut with an ellipsis, the full text on
 * hover. A long company name broken over four lines makes a list unreadable
 * and pushes the table into horizontal scrolling on a laptop. Put it in a
 * `cell-fill` cell so the column takes the space left and cuts there, or
 * give it a max width (className="max-w-[16rem]").
 */

import type { ReactNode } from 'react'

export function Truncate({
  text,
  children,
  className = 'max-w-[16rem]',
}: {
  /** The full text, shown on hover. */
  text: string | null | undefined
  /** What to render (a link, say); the text itself by default. */
  children?: ReactNode
  /** The width the cell may take before it cuts. */
  className?: string
}) {
  return (
    <span title={text ?? undefined} className={`block truncate ${className}`}>
      {children ?? text}
    </span>
  )
}
