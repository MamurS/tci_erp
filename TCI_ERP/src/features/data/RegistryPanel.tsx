/**
 * «Найти в официальном реестре» — searches GLEIF or Companies House through
 * the analytics service and offers each record as the starting point of the
 * company form. While the service is not running, the panel says so and the
 * company is entered by hand.
 */

import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Callout, Input, Panel, Segmented, Spinner } from '../../components/ui'
import type { RegistryRecord, RegistrySource } from '../../lib/analytics'
import { formatDate } from '../../lib/format'
import { useRegistrySearch, useRegistrySources } from './api'

export function RegistryPanel({
  initialQuery,
  country,
  onUse,
}: {
  initialQuery: string
  country: string | null
  onUse: (record: RegistryRecord) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const sources = useRegistrySources()
  const available = (sources.data ?? []).filter((s) => s.available)
  const [source, setSource] = useState<RegistrySource>('gleif')
  const [draft, setDraft] = useState(initialQuery)
  const [query, setQuery] = useState(initialQuery)
  // GLEIF narrows by country; the UK register is the UK.
  const search = useRegistrySearch(source, query, source === 'gleif' ? country : null)

  return (
    <Panel
      title={t('data.registry.title')}
      hint={t('data.registry.hint')}
      actions={
        available.length > 1 ? (
          <Segmented
            value={source}
            onChange={(key) => setSource(key as RegistrySource)}
            ariaLabel={t('data.registry.source')}
            options={available.map((s) => ({ key: s.source, label: t(`data.registry.sources.${s.source}`) }))}
          />
        ) : undefined
      }
    >
      {sources.isLoading ? (
        <Spinner />
      ) : sources.isError ? (
        <Callout tone="info" title={t('data.registry.unavailable')}>
          {t('data.registry.unavailableHint')}
        </Callout>
      ) : (
        <>
          <form
            className="mb-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              setQuery(draft)
            }}
          >
            <Input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t('data.registry.query')} />
            <Button type="submit" variant="secondary" disabled={draft.trim().length < 3}>
              {t('data.registry.search')}
            </Button>
          </form>

          {search.isFetching ? (
            <Spinner />
          ) : search.isError ? (
            <Callout tone="warn" title={t('data.registry.failed')} />
          ) : search.data && !search.data.length ? (
            <p className="text-small text-slate-500">{t('data.registry.none')}</p>
          ) : (
            <ul>
              {(search.data ?? []).map((record) => (
                <li
                  key={`${record.source}:${record.source_id}`}
                  className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 text-small first:pt-0 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{record.name}</p>
                    <p className="mt-0.5 text-slate-500">
                      {[
                        record.country_code,
                        record.registration_number,
                        record.status,
                        record.founded_date && formatDate(record.founded_date, locale),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    {record.address && <p className="mt-0.5 text-slate-500">{record.address}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {record.url && (
                      <a
                        href={record.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-500 hover:text-accent-600"
                        title={t('data.registry.openSource')}
                        aria-label={t('data.registry.openSource')}
                      >
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                    <Button size="sm" variant="secondary" onClick={() => onUse(record)}>
                      {t('data.registry.use')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  )
}
