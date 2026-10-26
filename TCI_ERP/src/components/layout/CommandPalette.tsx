/**
 * ⌘K / Ctrl+K: jump to any section, or find an organization by name or
 * registration number. Staff only — the organization search reads
 * tci.legal_entities, which a client cannot see.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Building2, CornerDownLeft, FilePlus2, History, Search } from 'lucide-react'

import { useAuth } from '../../auth/AuthContext'
import { tci } from '../../lib/supabase'
import { matchesQuery, sanitizeSearchTerm } from './commandPalette'
import { navItemsForRoles } from './navigation'
import { RequestEntityModal } from '../../features/data/RequestEntityModal'
import { readRecentEntities, rememberEntity } from './recentEntities'
import type { RecentEntity } from './recentEntities'

interface Hit {
  id: string
  kind: 'nav' | 'entity' | 'recent' | 'search' | 'request'
  label: string
  sub?: string
  to: string
  /** The heading this hit sits under (shown above the first of a run). */
  group: 'recent' | 'companies' | 'sections'
}

function useEntitySearch(term: string | null) {
  return useQuery({
    queryKey: ['palette-entities', term],
    enabled: term !== null,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await tci()
        .from('legal_entities')
        .select('id, name, registration_number, country_code')
        .or(`name.ilike.%${term}%,registration_number.ilike.%${term}%`)
        .order('name')
        .limit(8)
      if (error) throw error
      return (data ?? []) as {
        id: string
        name: string
        registration_number: string
        country_code: string
      }[]
    },
  })
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { t } = useTranslation()
  const { roles } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [cursor, setCursor] = useState(0)
  // A company the search did not find can be requested from here (0054); the
  // form outlives the palette, which closes as it opens.
  const [requestName, setRequestName] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [recent, setRecent] = useState<RecentEntity[]>([])

  useEffect(() => {
    if (!open) return
    setRecent(readRecentEntities())
    setQuery('')
    setDebounced('')
    setCursor(0)
    const id = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 180)
    return () => window.clearTimeout(id)
  }, [query])

  const term = sanitizeSearchTerm(debounced)
  const entities = useEntitySearch(open ? term : null)

  const hits: Hit[] = useMemo(() => {
    const nav = navItemsForRoles(roles)
      .map((item) => ({
        id: `nav-${item.key}`,
        kind: 'nav' as const,
        label: t(`nav.${item.key}`),
        to: item.path,
        group: 'sections' as const,
      }))
      .filter((h) => matchesQuery(h.label, query))
    // Before anything is typed: the companies opened last, then the sections.
    if (!query.trim()) {
      const recents = recent.map((e) => ({
        id: `recent-${e.id}`,
        kind: 'recent' as const,
        label: e.name,
        sub: e.sub,
        to: `/entities/${e.id}`,
        group: 'recent' as const,
      }))
      return [...recents, ...nav]
    }
    const found = (entities.data ?? []).map((e) => ({
      id: `entity-${e.id}`,
      kind: 'entity' as const,
      label: e.name,
      sub: [e.registration_number, e.country_code].filter(Boolean).join(' · '),
      to: `/entities/${e.id}`,
      group: 'companies' as const,
    }))
    // Always a way to the whole registry, filtered by what was typed — it
    // matches more loosely than this quick search and shows every hit.
    const searchAll = term
      ? [
          {
            id: 'search-registry',
            kind: 'search' as const,
            label: t('palette.searchRegistry', { query: term }),
            to: `/entities?q=${encodeURIComponent(term)}`,
            group: 'companies' as const,
          },
        ]
      : []
    // Nothing found for a company-like search: offer to have it registered.
    const missing =
      term && term.length >= 3 && entities.isSuccess && !entities.isFetching && found.length === 0
        ? [
            {
              id: 'request-company',
              kind: 'request' as const,
              label: t('data.notFound.paletteItem', { query: term }),
              sub: t('data.notFound.paletteSub'),
              to: '',
              group: 'companies' as const,
            },
          ]
        : []
    return [...found, ...searchAll, ...missing, ...nav]
  }, [roles, query, term, recent, entities.data, entities.isSuccess, entities.isFetching, t])

  useEffect(() => {
    setCursor(0)
  }, [hits.length])

  const requestModal = (
    <RequestEntityModal
      open={requestName !== null}
      initialName={requestName ?? ''}
      onClose={() => setRequestName(null)}
    />
  )
  if (!open) return requestModal

  const go = (hit: Hit | undefined) => {
    if (!hit) return
    onClose()
    if (hit.kind === 'request') {
      setRequestName(term ?? '')
      return
    }
    if (hit.kind === 'entity' || hit.kind === 'recent')
      rememberEntity({ id: hit.to.replace('/entities/', ''), name: hit.label, sub: hit.sub })
    void navigate(hit.to)
  }

  return (
    <>
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-accent-900/40 p-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.title')}
        className="animate-fade-in w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-pop ring-1 ring-slate-900/5"
      >
        <div className="flex items-center gap-3 border-b border-slate-200 px-4">
          <Search className="size-[1.125rem] shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(hits.length - 1, c + 1))
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(0, c - 1))
              }
              if (e.key === 'Enter') go(hits[cursor])
            }}
            placeholder={t('palette.placeholder')}
            className="h-14 flex-1 bg-transparent text-[0.9375rem] text-slate-900 outline-none placeholder:text-slate-400"
          />
          <kbd className="rounded border border-slate-200 px-1.5 py-0.5 text-[0.6875rem] text-slate-400">Esc</kbd>
        </div>

        <ul className="scrollbar-thin max-h-[52vh] overflow-y-auto p-2">
          {hits.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-slate-500">
              {entities.isFetching ? t('common.loading') : t('palette.empty')}
            </li>
          )}
          {hits.map((hit, i) => (
            <li key={hit.id}>
              {hit.group !== hits[i - 1]?.group && (
                <div className="px-3 pt-2 pb-1 text-[0.6875rem] font-semibold tracking-wide text-slate-400 uppercase">
                  {t(`palette.groups.${hit.group}`)}
                </div>
              )}
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(hit)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  i === cursor ? 'bg-accent-50' : ''
                }`}
              >
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-md ${
                    hit.kind === 'entity' || hit.kind === 'recent' || hit.kind === 'search'
                      ? 'bg-accent-100 text-accent-600'
                      : hit.kind === 'request'
                        ? 'bg-brand-orange/10 text-brand-orange'
                        : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {hit.kind === 'entity' ? (
                    <Building2 className="size-4" />
                  ) : hit.kind === 'recent' ? (
                    <History className="size-4" />
                  ) : hit.kind === 'search' ? (
                    <Search className="size-4" />
                  ) : hit.kind === 'request' ? (
                    <FilePlus2 className="size-4" />
                  ) : (
                    <ArrowRight className="size-4" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">{hit.label}</span>
                  {hit.sub && <span className="block truncate text-xs text-slate-500">{hit.sub}</span>}
                </span>
                {i === cursor && <CornerDownLeft className="size-4 text-slate-400" />}
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4 border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-[0.6875rem] text-slate-500">
          <span>↑↓ {t('palette.hintNavigate')}</span>
          <span>↵ {t('palette.hintOpen')}</span>
        </div>
      </div>
    </div>
    {requestModal}
    </>
  )
}
