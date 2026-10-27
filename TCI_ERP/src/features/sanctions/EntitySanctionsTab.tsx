/**
 * The company card's «Санкции» tab (migration 0091): where the company
 * stands — sanctioned, a possible match waiting for a credit analyst,
 * screened clear, or not screened against the lists in use — its possible
 * matches (analysts confirm or clear them), the names screened with it (the
 * company, the companies above it, the people behind them) ready to check by
 * hand in the publishers' own search tools, the beneficial owners, and the
 * screenings so far. Every staff member sees it and may screen now; nothing
 * reaches a client.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'

import { Button, Callout, COL, EmptyState, Panel, PanelGrid, Table } from '../../components/ui'
import { formatDate, formatMoment } from '../../lib/format'
import { refusalKey } from '../../lib/refusals'
import { useEntityMatches, useEntitySanctionsStatus, useScreenings, useScreenNow, useSubjects } from './api'
import { BeneficialOwnersPanel } from './BeneficialOwnersPanel'
import { CopyNameButton, MatchesTable, SanctionsStatusBadge, SearchToolsList } from './components'
import { useListName } from './useListName'

export function EntitySanctionsTab({ entityId, entityName }: { entityId: string; entityName: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const status = useEntitySanctionsStatus(entityId)
  const matches = useEntityMatches(entityId)
  const screenings = useScreenings(entityId)
  const screen = useScreenNow()
  const listName = useListName()
  const [notice, setNotice] = useState<{ tone: 'pos' | 'warn' | 'neg' | 'info'; text: string } | null>(null)
  const [allMatches, setAllMatches] = useState(false)

  const rows = matches.data ?? []
  const pending = rows.filter((m) => m.status === 'pending')
  const shown = allMatches ? rows : pending
  const last = screenings.data?.find((s) => s.outcome !== 'no_lists') ?? null

  const screenNow = () => {
    setNotice(null)
    screen
      .mutateAsync(entityId)
      .then((r) =>
        setNotice(
          r.outcome === 'no_lists'
            ? { tone: 'warn', text: t('sanctions.card.noLists') }
            : r.outcome === 'clear'
              ? { tone: 'pos', text: t('sanctions.card.screenedClear') }
              : { tone: 'warn', text: t('sanctions.card.screenedMatches', { count: r.pending }) },
        ),
      )
      .catch((e: unknown) => setNotice({ tone: 'neg', text: t(refusalKey(e)) }))
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title={t('sanctions.card.title')}
        hint={t('sanctions.card.hint')}
        actions={
          <Button size="sm" variant="secondary" loading={screen.isPending} onClick={screenNow}>
            <RefreshCw aria-hidden className="size-4" />
            {t('sanctions.card.screenNow')}
          </Button>
        }
      >
        {notice && <Callout tone={notice.tone} title={notice.text} className="mb-3" />}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-body">
          {status && <SanctionsStatusBadge status={status.status} />}
          <span className="text-small text-slate-600">
            {last
              ? t('sanctions.card.lastScreened', {
                  when: formatMoment(last.screened_at, locale),
                  lists: last.lists.map((l) => listName(l.list, true)).join(', '),
                })
              : t('sanctions.card.neverScreened')}
          </span>
          {status?.status === 'sanctioned' && (
            <Link to="/sanctions?view=flags" className="text-small text-accent-700 hover:underline">
              {t('sanctions.card.seeFlags')}
            </Link>
          )}
        </div>
        {status?.status === 'country' && <Callout tone="neg" className="mt-3" title={t('sanctions.card.countryFlagged')} />}
      </Panel>

      <Panel
        title={t('sanctions.matches.title')}
        hint={t('sanctions.matches.hint')}
        actions={
          rows.length > pending.length ? (
            <Button size="sm" variant="ghost" aria-pressed={allMatches} onClick={() => setAllMatches((v) => !v)}>
              {allMatches ? t('sanctions.matches.onlyPending') : t('sanctions.matches.showAll', { count: rows.length })}
            </Button>
          ) : undefined
        }
      >
        {matches.isLoading ? null : shown.length === 0 ? (
          <EmptyState pictogram="allDone" title={t('sanctions.matches.none')} hint={t('sanctions.matches.noneHint')} />
        ) : (
          <MatchesTable rows={shown} />
        )}
      </Panel>

      <PanelGrid>
        <SubjectsPanel entityId={entityId} entityName={entityName} />
        <BeneficialOwnersPanel entityId={entityId} />
      </PanelGrid>

      <Panel title={t('sanctions.history.title')} hint={t('sanctions.history.hint')}>
        {(screenings.data ?? []).length === 0 ? (
          <EmptyState pictogram="search" title={t('sanctions.history.none')} />
        ) : (
          <Table columns={['13rem', '12rem', COL.fill, '10rem']}>
            <thead>
              <tr>
                <th>{t('sanctions.history.when')}</th>
                <th>{t('sanctions.history.why')}</th>
                <th>{t('sanctions.history.lists')}</th>
                <th>{t('sanctions.history.outcome')}</th>
              </tr>
            </thead>
            <tbody>
              {(screenings.data ?? []).map((s) => (
                <tr key={s.id}>
                  <td className="tabular-nums">{formatMoment(s.screened_at, locale)}</td>
                  <td>{t(`sanctions.reason.${s.reason}`)}</td>
                  <td className="whitespace-normal text-small text-slate-600">
                    {s.lists.length ? s.lists.map((l) => `${listName(l.list, true)} (${formatDate(l.published_at, locale)})`).join(', ') : '—'}
                    {s.outcome !== 'no_lists' && (
                      <span className="block text-caption text-slate-500">
                        {t('sanctions.history.subjects', { count: s.subjects })}
                      </span>
                    )}
                  </td>
                  <td>{t(`sanctions.history.outcomes.${s.outcome}`)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  )
}

/** The names screened with the company — to check each by hand. */
function SubjectsPanel({ entityId, entityName }: { entityId: string; entityName: string }) {
  const { t } = useTranslation()
  const subjects = useSubjects(entityId)
  const rows = subjects.data ?? [{ subject_kind: 'entity' as const, subject_key: 'self', name: entityName, person: false, depth: 0 }]
  const [picked, setPicked] = useState<string | null>(null)
  const name = picked ?? entityName
  return (
    <Panel title={t('sanctions.subjects.title')} hint={t('sanctions.subjects.hint')}>
      <ul className="mb-4 flex flex-col divide-y divide-slate-100">
        {rows.map((s) => (
          <li key={s.subject_key} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <button
              type="button"
              onClick={() => setPicked(s.name)}
              aria-pressed={name === s.name}
              className={`min-w-0 text-left ${name === s.name ? 'font-semibold text-slate-900' : 'text-slate-800 hover:text-accent-700'}`}
            >
              <span className="block truncate">{s.name}</span>
              <span className="text-caption font-normal text-slate-500">{t(`sanctions.subjectKind.${s.subject_kind}`)}</span>
            </button>
            <CopyNameButton name={s.name} />
          </li>
        ))}
      </ul>
      <p className="mb-2 text-small font-medium text-slate-700">{t('sanctions.tools.checkName', { name })}</p>
      <SearchToolsList name={name} />
    </Panel>
  )
}
