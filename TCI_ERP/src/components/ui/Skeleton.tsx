/**
 * Loading placeholders that keep the place of what is coming (Prompt 30,
 * phase 2): skeleton ROWS as tall as the table's real rows (its density), so
 * nothing moves when the data arrives — never a spinner in the middle of an
 * empty table. The shimmer stops under `prefers-reduced-motion`.
 */

import { useDensity } from './tablePrefs'

const ROW_HEIGHT = { compact: 'h-10', regular: 'h-12', relaxed: 'h-14' } as const

export function SkeletonBar({ className = 'h-3 w-full' }: { className?: string }) {
  return <span aria-hidden className={`skeleton block rounded ${className}`} />
}

/** `rows` placeholder rows of `columns` cells, for a table's body. */
export function SkeletonRows({ rows = 5, columns }: { rows?: number; columns: number }) {
  const [density] = useDensity()
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden data-skeleton-row className={ROW_HEIGHT[density]}>
          {Array.from({ length: columns }, (_, c) => (
            <td key={c}>
              <SkeletonBar className={`h-3 ${c === 0 ? 'w-3/4' : c % 2 ? 'w-1/2' : 'w-2/3'}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
