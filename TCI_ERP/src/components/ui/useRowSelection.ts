/**
 * The rows a bulk bar acts on (Table v2), by id: `toggle` one row,
 * `toggleAll` over the rows on screen (all of them selected → none), `clear`.
 * Kept in the page's state only — a selection is not a preference.
 */

import { useCallback, useState } from 'react'

/** The set with `id` added, or removed when it was there. */
export function toggled(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

/** Every one of `ids` is selected (and there is at least one). */
export function allSelected(set: ReadonlySet<string>, ids: readonly string[]): boolean {
  return ids.length > 0 && ids.every((id) => set.has(id))
}

export function useRowSelection() {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const toggle = useCallback((id: string) => setSelected((prev) => toggled(prev, id)), [])
  const allOf = (ids: readonly string[]) => allSelected(selected, ids)
  const toggleAll = (ids: readonly string[]) =>
    setSelected(allSelected(selected, ids) ? new Set() : new Set(ids))
  const clear = useCallback(() => setSelected(new Set()), [])
  return { selected, toggle, toggleAll, allOf, clear }
}
