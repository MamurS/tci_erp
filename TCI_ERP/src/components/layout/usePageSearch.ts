/** The page half of the one search (pageSearchContext.tsx). */

import { useCallback, useContext, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { parseTerms } from '../../lib/pageSearch'
import { PageSearchContext } from './pageSearchState'

/** The page being filtered (for the top bar). */
export function usePageSearchScope(): string | null {
  return useContext(PageSearchContext).scope
}

/** For a list page: register as the search's scope and read what was typed. */
export function usePageSearch(scope: string): {
  query: string
  terms: string[]
  /** Replace (or with '' clear) what was typed. */
  setQuery: (next: string) => void
} {
  const { setScope } = useContext(PageSearchContext)
  useEffect(() => {
    setScope(scope)
    return () => setScope(null)
  }, [scope, setScope])
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const terms = useMemo(() => parseTerms(query), [query])
  const setQuery = useCallback(
    (next: string) =>
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (next) p.set('q', next)
          else p.delete('q')
          return p
        },
        { replace: true },
      ),
    [setParams],
  )
  return { query, terms, setQuery }
}
