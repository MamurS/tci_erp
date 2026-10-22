/**
 * «Уже есть в реестре» — the request turns out to be a company we hold
 * under another spelling. Search by name; pick one; the request is resolved
 * as linked, pointing at it.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Button, Input, Panel, Spinner } from '../../components/ui'
import { tci } from '../../lib/supabase'
import { useCountryName } from '../portfolio/useCountryName'

interface Candidate {
  id: string
  name: string
  country_code: string
  registration_number: string | null
}

export function LinkExistingPanel({ initialQuery, onLink }: { initialQuery: string; onLink: (entityId: string) => void }) {
  const { t } = useTranslation()
  const countryName = useCountryName()
  const [query, setQuery] = useState(initialQuery)
  const q = query.trim()
  const candidates = useQuery({
    queryKey: ['entities', 'link-candidates', q],
    enabled: q.length >= 2,
    queryFn: async (): Promise<Candidate[]> => {
      // the fuzzy match catches a different spelling, the plain one a fragment
      const [similar, plain] = await Promise.all([
        tci().rpc('similar_entities', { p_name: q }),
        tci().from('legal_entities').select('id, name, country_code, registration_number').ilike('name', `%${q}%`).limit(8),
      ])
      if (similar.error) throw similar.error
      if (plain.error) throw plain.error
      const seen = new Set<string>()
      return [...((similar.data ?? []) as Candidate[]), ...((plain.data ?? []) as Candidate[])].filter((c) =>
        seen.has(c.id) ? false : (seen.add(c.id), true),
      )
    },
  })

  return (
    <Panel title={t('data.link.title')} hint={t('data.link.hint')}>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} aria-label={t('data.link.query')} className="mb-4" />
      {candidates.isFetching ? (
        <Spinner />
      ) : !candidates.data?.length ? (
        <p className="text-[13px] text-slate-500">{t('data.link.none')}</p>
      ) : (
        <ul>
          {candidates.data.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-4 border-b border-slate-100 py-2.5 text-[13px] first:pt-0 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{c.name}</p>
                <p className="text-slate-500">
                  {[countryName(c.country_code), c.registration_number].filter(Boolean).join(' · ')}
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => onLink(c.id)}>
                {t('data.link.use')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
