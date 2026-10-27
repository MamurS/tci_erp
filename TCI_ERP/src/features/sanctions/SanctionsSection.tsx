/**
 * «Санкции» (migration 0091) — in every staff workspace:
 *
 *   check    a name against the lists in use, and the publishers' own search
 *            tools to check it by hand (everyone);
 *   matches  every possible match waiting for review (everyone reads; credit
 *            analysts confirm or clear);
 *   lists    the lists in use, how fresh, and the import (credit analysts and
 *            admin);
 *   flags    the sanctions flags on countries and companies (credit analysts
 *            maintain them; everyone else reads).
 */

import { lazy, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, COL, EmptyState, Field, Input, Panel, SectionPage, Segmented, Table } from '../../components/ui'
import { formatDate } from '../../lib/format'
import { usePendingMatches, useSanctionsLists, useSanctionsSearch } from './api'
import { CopyNameButton, MatchesTable, SearchToolsList } from './components'
import { useListName } from './useListName'
import { parseSanctionsView, SANCTIONS_VIEWS, scorePercent } from './model'
import type { SanctionsView } from './model'

const ListsView = lazy(() => import('./ListsView').then((m) => ({ default: m.ListsView })))
const FlagsView = lazy(() => import('../admin/risk/SanctionsCard').then((m) => ({ default: m.SanctionsCard })))

export function SanctionsSection() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const view = parseSanctionsView(params.get('view'))
  const pending = usePendingMatches()
  const lists = useSanctionsLists()
  const counts: Record<SanctionsView, number | null> = {
    check: null,
    matches: pending.data?.length || null,
    lists: lists.data ? lists.data.filter((l) => l.required && l.stale).length || null : null,
    flags: null,
  }

  return (
    <SectionPage
      title={t('nav.sanctions')}
      subtitle={t('sanctions.section.subtitle')}
      tabs={SANCTIONS_VIEWS.map((key) => ({ key, label: t(`sanctions.section.views.${key}`), count: counts[key] }))}
      active={view}
      onChange={(next) => setParams({ view: next }, { replace: true })}
    >
      {view === 'check' && <CheckView />}
      {view === 'matches' && <MatchesView />}
      {view === 'lists' && <ListsView />}
      {view === 'flags' && <FlagsView />}
    </SectionPage>
  )
}

function CheckView() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const listName = useListName()
  const [name, setName] = useState('')
  const [who, setWho] = useState<'all' | 'company' | 'person'>('all')
  const query = name.trim()
  const search = useSanctionsSearch(query, who === 'all' ? null : who === 'person')
  const hits = search.data ?? []

  return (
    <div className="flex flex-col gap-5">
      <Panel title={t('sanctions.check.title')} hint={t('sanctions.check.hint')}>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('sanctions.check.name')} className="min-w-64 flex-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('sanctions.check.placeholder')} />
          </Field>
          <Segmented
            value={who}
            onChange={(k) => setWho(k as typeof who)}
            ariaLabel={t('sanctions.check.who')}
            options={(['all', 'company', 'person'] as const).map((k) => ({ key: k, label: t(`sanctions.check.whoOptions.${k}`) }))}
          />
          {query && <CopyNameButton name={query} />}
        </div>
        <div className="mt-4">
          {query.length < 3 ? (
            <p className="text-small text-slate-500">{t('sanctions.check.typeMore')}</p>
          ) : search.isLoading ? null : hits.length === 0 ? (
            <EmptyState pictogram="search" title={t('sanctions.check.none', { name: query })} hint={t('sanctions.check.noneHint')} />
          ) : (
            <Table columns={[COL.fill, '12rem', '6rem', '14rem']}>
              <thead>
                <tr>
                  <th>{t('sanctions.matches.listed')}</th>
                  <th>{t('sanctions.check.list')}</th>
                  <th>{t('sanctions.matches.score')}</th>
                  <th>{t('sanctions.check.details')}</th>
                </tr>
              </thead>
              <tbody>
                {hits.map((h) => (
                  <tr key={h.entry_id}>
                    <td className="whitespace-normal">
                      <span className="block font-medium text-slate-800">{h.matched_name}</span>
                      {h.primary_name !== h.matched_name && <span className="block text-caption text-slate-500">{h.primary_name}</span>}
                      <span className="text-caption text-slate-500">{t(`sanctions.kind.${h.kind}`)}</span>
                    </td>
                    <td className="whitespace-normal text-small">
                      {listName(h.list_key, true)}
                      <span className="block text-caption text-slate-500">
                        {h.list_ref} · {formatDate(h.published_at, locale)}
                      </span>
                    </td>
                    <td className="tabular-nums">{scorePercent(h.score)} %</td>
                    <td className="whitespace-normal text-caption text-slate-600">
                      {[h.programmes.join(', '), h.countries.slice(0, 3).join(', '), h.birth_dates.slice(0, 2).join(', ')]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </Panel>
      <Panel title={t('sanctions.tools.title')} hint={t('sanctions.tools.hint')}>
        <SearchToolsList name={query || null} />
      </Panel>
    </div>
  )
}

function MatchesView() {
  const { t } = useTranslation()
  const pending = usePendingMatches()
  const rows = pending.data ?? []
  return (
    <Panel title={t('sanctions.queue.title')} hint={t('sanctions.queue.hint')}>
      {pending.isLoading ? null : rows.length === 0 ? (
        <EmptyState pictogram="allDone" title={t('sanctions.queue.none')} hint={t('sanctions.queue.noneHint')} />
      ) : (
        <>
          <p className="mb-3 text-small text-slate-600">
            <Badge tone="warn">{t('sanctions.queue.count', { count: rows.length })}</Badge>
          </p>
          <MatchesTable rows={rows} withCompany />
        </>
      )}
    </Panel>
  )
}
