/**
 * Which page, if any, the top-bar search is filtering (lib/pageSearch.ts).
 *
 * A list page calls `usePageSearch('<nav key>')` (usePageSearch.ts): while it
 * is mounted the top-bar field says it filters that page, and the page reads
 * what was typed from the URL (`?q=`). A page that does not call it is
 * searched only system-wide, from the field's results list.
 */

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import { PageSearchContext } from './pageSearchState'

export function PageSearchProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<string | null>(null)
  const value = useMemo(() => ({ scope, setScope }), [scope])
  return <PageSearchContext.Provider value={value}>{children}</PageSearchContext.Provider>
}
