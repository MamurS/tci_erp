/** The shared state behind the one search's page scope (see
 * pageSearchContext.tsx and usePageSearch.ts). */

import { createContext } from 'react'

export interface PageSearchState {
  /** The nav key of the page being filtered (its name in `nav.*`), or null. */
  scope: string | null
  setScope: (scope: string | null) => void
}

export const PageSearchContext = createContext<PageSearchState>({ scope: null, setScope: () => undefined })
