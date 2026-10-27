/**
 * The one search (owner, 2026-10-26), in the top bar.
 *
 * A plain field: a click puts the cursor in it and nothing else happens. What
 * is typed goes into the URL (`?q=`), where a list page that registered with
 * `usePageSearch` filters itself by it — terms separated by commas, applied
 * in order, an exact value matching exactly (lib/pageSearch.ts). At the same
 * time a small list under the field shows what the LAST term finds elsewhere
 * in the system — companies, policies, claims, submissions, sections — within
 * what the acting role may open. Enter opens the one exact match; ↑↓ and
 * Enter open any; Escape closes the list, a second Escape clears the field.
 * Ctrl/⌘ K puts the cursor here.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Building2,
  ClipboardList,
  CornerDownLeft,
  FilePlus2,
  FileText,
  FileWarning,
  Search,
  X,
} from 'lucide-react'

import { useAuth } from '../../auth/AuthContext'
import { lastTerm, normalizeSearch } from '../../lib/pageSearch'
import { RequestEntityModal } from '../../features/data/RequestEntityModal'
import { matchesQuery, paletteSources, sanitizeSearchTerm } from './commandPalette'
import type { PaletteSource } from './commandPalette'
import { useEntitySearch, useRecordSearch } from './globalSearchApi'
import { canAccessPath, navItemsForRoles } from './navigation'
import { usePageSearchScope } from './usePageSearch'
import { rememberEntity } from './recentEntities'

interface Hit {
  id: string
  kind: 'nav' | 'entity' | 'record' | 'request'
  label: string
  sub?: string
  to: string
  group: 'companies' | 'records' | 'sections'
  source?: Exclude<PaletteSource, 'entities'>
}

export interface GlobalSearchHandle {
  focus: () => void
}

export const GlobalSearch = forwardRef<GlobalSearchHandle>(function GlobalSearch(_, ref) {
  const { t } = useTranslation()
  const { roles } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [params, setParams] = useSearchParams()
  const scope = usePageSearchScope()
  const inputRef = useRef<HTMLInputElement>(null)
  const query = params.get('q') ?? ''
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(-1)
  // On a page the search filters, the system-wide results stay folded into
  // one line under the field (the list being filtered is what the person is
  // looking at); ↓ or a click unfolds them.
  const [expanded, setExpanded] = useState(false)
  const [debounced, setDebounced] = useState('')
  const [requestName, setRequestName] = useState<string | null>(null)

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus()
      inputRef.current?.select()
    },
  }))

  // A new page starts with its own (empty) search and a closed list.
  useEffect(() => {
    setOpen(false)
    setCursor(-1)
    setExpanded(false)
  }, [pathname])

  const typed = lastTerm(query)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(typed), 180)
    return () => window.clearTimeout(id)
  }, [typed])

  const term = sanitizeSearchTerm(debounced)
  const sources = useMemo(() => paletteSources((path) => canAccessPath(roles, path)), [roles])
  const entities = useEntitySearch(open && sources.includes('entities') ? term : null)
  const records = useRecordSearch(open ? term : null, sources)

  const hits: Hit[] = useMemo(() => {
    if (!typed) return []
    const found: Hit[] = (entities.data ?? []).map((e) => ({
      id: `entity-${e.id}`,
      kind: 'entity',
      label: e.name,
      sub: [e.registration_number, e.country_code].filter(Boolean).join(' · '),
      to: `/entities/${e.id}`,
      group: 'companies',
    }))
    // Nothing found for a company-like search: offer to have it registered (0054).
    const missing: Hit[] =
      term &&
      term.length >= 3 &&
      sources.includes('entities') &&
      entities.isSuccess &&
      !entities.isFetching &&
      found.length === 0
        ? [
            {
              id: 'request-company',
              kind: 'request',
              label: t('data.notFound.paletteItem', { query: term }),
              sub: t('data.notFound.paletteSub'),
              to: '',
              group: 'companies',
            },
          ]
        : []
    const recordHits: Hit[] = (records.data ?? []).map((r) => ({
      id: `record-${r.id}`,
      kind: 'record',
      source: r.source,
      label: r.number,
      sub: [t(`palette.sources.${r.source}`), r.name].filter(Boolean).join(' · '),
      to: `/${r.source}/${r.id}`,
      group: 'records',
    }))
    const nav: Hit[] = navItemsForRoles(roles)
      .map((item) => ({
        id: `nav-${item.key}`,
        kind: 'nav' as const,
        label: t(`nav.${item.key}`),
        to: item.path,
        group: 'sections' as const,
      }))
      .filter((h) => matchesQuery(h.label, typed))
    return [...found, ...missing, ...recordHits, ...nav]
  }, [
    typed,
    term,
    sources,
    roles,
    entities.data,
    entities.isSuccess,
    entities.isFetching,
    records.data,
    t,
  ])

  useEffect(() => {
    setCursor(-1)
  }, [hits.length])

  const setQuery = (next: string) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next) p.set('q', next)
        else p.delete('q')
        return p
      },
      { replace: true },
    )
  }

  const go = (hit: Hit | undefined) => {
    if (!hit) return
    setOpen(false)
    if (hit.kind === 'request') {
      setRequestName(term ?? '')
      return
    }
    if (hit.kind === 'entity')
      rememberEntity({ id: hit.to.replace('/entities/', ''), name: hit.label, sub: hit.sub })
    if (hit.kind === 'record')
      rememberEntity({
        id: hit.to.split('/').pop() ?? hit.id,
        name: hit.label,
        sub: hit.sub,
        to: hit.to,
      })
    inputRef.current?.blur()
    void navigate(hit.to)
  }

  /** Enter without a highlighted row: the one exact match, if there is one;
   * on a page that is not filtered by the search, the first match. */
  const enter = () => {
    if (cursor >= 0) return go(hits[cursor])
    const needle = normalizeSearch(typed)
    const exact = hits.filter((h) => h.kind !== 'request' && normalizeSearch(h.label) === needle)
    if (exact.length === 1) return go(exact[0])
    if (!scope && hits[0] && hits[0].kind !== 'request') return go(hits[0])
    setOpen(false)
  }

  const anything = open && typed.length > 0 && (hits.length > 0 || entities.isFetching || records.isFetching)
  const showList = anything && (!scope || expanded)
  const showSummary = anything && Boolean(scope) && !expanded && hits.length > 0
  const placeholder = scope
    ? t('search.placeholderPage', { page: t(`nav.${scope}`) })
    : t('search.placeholder')

  return (
    <div className="relative flex h-11 min-w-0 shrink-0 sm:w-full sm:max-w-3xl sm:shrink">
      <Search
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-4 size-[1.125rem] -translate-y-1/2 text-slate-500"
      />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls="global-search-list"
        aria-autocomplete="list"
        aria-label={placeholder}
        data-global-search
        value={query}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
          if (!e.target.value) setExpanded(false)
        }}
        onFocus={() => {
          if (typed) setOpen(true)
        }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (showList) setOpen(false)
            else if (query) setQuery('')
            else inputRef.current?.blur()
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setExpanded(true)
            setCursor((c) => Math.min(hits.length - 1, c + 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setCursor((c) => Math.max(-1, c - 1))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            enter()
          }
        }}
        className="h-11 w-full rounded-full border border-slate-200 bg-white pr-11 pl-11 text-body text-slate-900 shadow-sm transition-shadow outline-none placeholder:text-slate-500 hover:shadow-md focus:border-accent-500 focus:shadow-md [&::-webkit-search-cancel-button]:appearance-none"
      />
      {query && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setQuery('')
            inputRef.current?.focus()
          }}
          aria-label={t('search.clear')}
          title={t('search.clear')}
          className="absolute top-1/2 right-3 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800"
        >
          <X className="size-4" />
        </button>
      )}
      {showSummary && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setExpanded(true)}
          className="absolute top-full left-0 z-50 mt-2 flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-small text-slate-700 shadow-pop hover:bg-slate-50"
        >
          <Search aria-hidden className="size-4 text-slate-500" />
          {t('search.elsewhere', { count: hits.length })}
          <kbd className="rounded border border-slate-200 px-1 text-caption text-slate-500">↓</kbd>
        </button>
      )}
      {showList && (
        <ul
          id="global-search-list"
          role="listbox"
          className="animate-fade-in scrollbar-thin absolute top-full left-0 z-50 mt-2 max-h-[60vh] w-full min-w-[22rem] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-pop"
        >
          {hits.length === 0 && (
            <li className="px-3 py-4 text-small text-slate-500">{t('common.loading')}</li>
          )}
          {hits.map((hit, i) => (
            <li key={hit.id} role="option" aria-selected={i === cursor}>
              {hit.group !== hits[i - 1]?.group && (
                <div className="px-3 pt-2 pb-1 text-caption font-semibold tracking-wide text-slate-500 uppercase">
                  {t(`palette.groups.${hit.group}`)}
                </div>
              )}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(hit)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${i === cursor ? 'bg-accent-50' : ''}`}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-600">
                  {hit.kind === 'entity' ? (
                    <Building2 className="size-4" />
                  ) : hit.kind === 'request' ? (
                    <FilePlus2 className="size-4" />
                  ) : hit.source === 'policies' ? (
                    <FileText className="size-4" />
                  ) : hit.source === 'claims' ? (
                    <FileWarning className="size-4" />
                  ) : hit.source === 'requests' ? (
                    <ClipboardList className="size-4" />
                  ) : (
                    <ArrowRight className="size-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-slate-900">
                    {hit.label}
                  </span>
                  {hit.sub && (
                    <span className="block truncate text-caption text-slate-500">{hit.sub}</span>
                  )}
                </span>
                {i === cursor && <CornerDownLeft className="size-4 text-slate-500" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      <RequestEntityModal
        open={requestName !== null}
        initialName={requestName ?? ''}
        onClose={() => setRequestName(null)}
      />
    </div>
  )
})
