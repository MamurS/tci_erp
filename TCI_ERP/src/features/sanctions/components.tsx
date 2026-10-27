/**
 * The small pieces of sanctions screening shared by the company card, the
 * sanctions section and the tables (migration 0091): the status badge and
 * table cell, the official search tools with the name ready to copy, the
 * matches table and the confirm / clear dialog.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Check, Copy, ExternalLink } from 'lucide-react'

import { useAuth } from '../../auth/AuthContext'
import { Badge, Button, Callout, COL, Field, Modal, Table, Textarea } from '../../components/ui'
import { formatDate, formatMoment } from '../../lib/format'
import { refusalKey } from '../../lib/refusals'
import { useEntitySanctionsStatus, useResolveMatch } from './api'
import type { SanctionsMatch } from './api'
import { mayResolveMatches, scorePercent, SEARCH_TOOLS, statusTone } from './model'
import type { SanctionsStatus } from './model'
import { useListName } from './useListName'

export function SanctionsStatusBadge({ status }: { status: SanctionsStatus }) {
  const { t } = useTranslation()
  return (
    <span data-sanctions={status}>
      <Badge tone={statusTone(status)} title={t(`sanctions.status.hint.${status}`)}>
        {t(`sanctions.status.label.${status}`)}
      </Badge>
    </span>
  )
}

/** A table cell: a badge when something needs a look (a sanction, a possible
 * match), quiet text otherwise — the column must not shout «clear» on every
 * row. */
export function SanctionsCell({ entityId }: { entityId: string | null | undefined }) {
  const { t } = useTranslation()
  const row = useEntitySanctionsStatus(entityId)
  if (!row) return <span className="text-slate-500">—</span>
  if (row.status === 'sanctioned' || row.status === 'country' || row.status === 'possible_match') {
    return <SanctionsStatusBadge status={row.status} />
  }
  return (
    <span className="text-small text-slate-500" title={t(`sanctions.status.hint.${row.status}`)}>
      {t(`sanctions.status.label.${row.status}`)}
    </span>
  )
}

/** Beside a buyer's name: the badge only when there is something to see —
 * a sanction (on the company or its country) or a possible match. */
export function SanctionsMark({ entityId }: { entityId: string | null | undefined }) {
  const row = useEntitySanctionsStatus(entityId)
  if (!row || (row.status !== 'sanctioned' && row.status !== 'country' && row.status !== 'possible_match')) return null
  return <SanctionsStatusBadge status={row.status} />
}

/** Copies a name for pasting into an official search. */
export function CopyNameButton({ name }: { name: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard
      ?.writeText(name)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => undefined)
  }
  return (
    <Button size="sm" variant="ghost" onClick={copy} aria-label={t('sanctions.tools.copyName', { name })}>
      {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
      {copied ? t('sanctions.tools.copied') : t('sanctions.tools.copy')}
    </Button>
  )
}

/** The publishers' own search tools — for any staff member to check a name
 * by hand. Only OpenSanctions takes the name in its address; for the others
 * the name is copied and pasted. */
export function SearchToolsList({ name }: { name: string | null }) {
  const { t } = useTranslation()
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {SEARCH_TOOLS.map((tool) => (
        <li key={tool.key} className="flex min-w-0 flex-col gap-0.5 rounded-md border border-slate-200 p-3">
          <a
            href={tool.url(name ?? '')}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-2 font-medium text-accent-700 hover:underline"
          >
            {t(`sanctions.tools.name.${tool.key}`)}
            <ExternalLink aria-hidden className="size-3.5 shrink-0" />
          </a>
          <span className="text-caption text-slate-500">
            {t(`sanctions.tools.what.${tool.key}`)}{' '}
            {name && (tool.takesName ? t('sanctions.tools.nameFilled') : t('sanctions.tools.namePaste'))}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** Possible matches: the subject screened, the listed party, how close, and
 * what became of it. Credit analysts confirm or clear pending ones. */
export function MatchesTable({ rows, withCompany = false }: { rows: SanctionsMatch[]; withCompany?: boolean }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { actingRole } = useAuth()
  const listName = useListName()
  const resolver = mayResolveMatches(actingRole)
  const [resolving, setResolving] = useState<{ match: SanctionsMatch; outcome: 'confirmed' | 'cleared' } | null>(null)
  const columns = [
    ...(withCompany ? ['12rem'] : []),
    '12rem',
    COL.fill,
    '7.5rem',
    '11rem',
    ...(resolver ? ['15rem'] : []),
  ]
  return (
    <>
      <Table columns={columns}>
        <thead>
          <tr>
            {withCompany && <th>{t('sanctions.matches.company')}</th>}
            <th>{t('sanctions.matches.subject')}</th>
            <th>{t('sanctions.matches.listed')}</th>
            <th>{t('sanctions.matches.score')}</th>
            <th>{t('sanctions.matches.status')}</th>
            {resolver && (
              <th>
                <span className="sr-only">{t('common.actions')}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => {
            const snap = m.entry_snapshot
            const details = [
              snap.programmes?.length ? snap.programmes.join(', ') : null,
              snap.countries?.length ? snap.countries.slice(0, 3).join(', ') : null,
              snap.birth_dates?.length ? t('sanctions.matches.born', { dates: snap.birth_dates.slice(0, 3).join(', ') }) : null,
            ].filter(Boolean)
            return (
              <tr key={m.id}>
                {withCompany && (
                  <td>
                    <Link to={`/entities/${m.entity_id}?tab=sanctions`} className="font-medium text-accent-700 hover:underline">
                      {m.legal_entities?.name ?? '—'}
                    </Link>
                  </td>
                )}
                <td className="whitespace-normal">
                  <span className="block font-medium text-slate-800">{m.subject_name}</span>
                  <span className="text-caption text-slate-500">
                    {t(`sanctions.subjectKind.${m.subject_kind}`)}
                    {m.subject_kind === 'beneficial_owner' && snap.role ? ` · ${t(`sanctions.owners.role.${snap.role}`)}` : ''}
                  </span>
                </td>
                <td className="whitespace-normal">
                  <span className="block text-slate-800">{m.matched_name}</span>
                  {snap.primary_name && snap.primary_name !== m.matched_name && (
                    <span className="block text-caption text-slate-500">{snap.primary_name}</span>
                  )}
                  <span className="block text-caption text-slate-500">
                    {listName(m.list_key, true)} · {m.list_ref}
                    {details.length ? ` · ${details.join(' · ')}` : ''}
                  </span>
                </td>
                <td className="tabular-nums">{scorePercent(m.score)} %</td>
                <td className="whitespace-normal">
                  <Badge tone={m.status === 'pending' ? 'warn' : m.status === 'confirmed' ? 'negStrong' : 'neutral'}>
                    {t(`sanctions.matchStatus.${m.status}`)}
                  </Badge>
                  <span className="mt-0.5 block text-caption text-slate-500">
                    {m.status === 'pending'
                      ? t('sanctions.matches.since', { date: formatDate(m.created_at, locale) })
                      : m.status === 'retired'
                        ? t(`sanctions.matches.retired.${m.retired_reason ?? 'delisted'}`)
                        : m.resolved_at
                          ? formatMoment(m.resolved_at, locale)
                          : null}
                  </span>
                  {m.resolution_note && <span className="block text-caption text-slate-600">{m.resolution_note}</span>}
                </td>
                {resolver && (
                  <td>
                    {m.status === 'pending' && (
                      <span className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setResolving({ match: m, outcome: 'cleared' })}>
                          {t('sanctions.resolve.clear')}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setResolving({ match: m, outcome: 'confirmed' })}>
                          {t('sanctions.resolve.confirm')}
                        </Button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </Table>
      {resolving && (
        <ResolveMatchModal match={resolving.match} outcome={resolving.outcome} onClose={() => setResolving(null)} />
      )}
    </>
  )
}

function ResolveMatchModal({
  match,
  outcome,
  onClose,
}: {
  match: SanctionsMatch
  outcome: 'confirmed' | 'cleared'
  onClose: () => void
}) {
  const { t } = useTranslation()
  const resolve = useResolveMatch()
  const listName = useListName()
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const noteError = tried && !note.trim() ? t('sanctions.resolve.noteRequired') : null

  const submit = () => {
    setTried(true)
    setError(null)
    if (!note.trim()) return
    resolve
      .mutateAsync({ matchId: match.id, outcome, note: note.trim() })
      .then(onClose)
      .catch((e: unknown) => setError(t(refusalKey(e))))
  }

  return (
    <Modal
      open
      title={t(outcome === 'confirmed' ? 'sanctions.resolve.confirmTitle' : 'sanctions.resolve.clearTitle')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant={outcome === 'confirmed' ? 'danger' : 'primary'} loading={resolve.isPending} onClick={submit}>
            {t(outcome === 'confirmed' ? 'sanctions.resolve.confirmSubmit' : 'sanctions.resolve.clearSubmit')}
          </Button>
        </>
      }
    >
      {error && <Callout tone="neg" title={error} />}
      <p className="text-small text-slate-700">
        {t('sanctions.resolve.pair', {
          subject: match.subject_name,
          listed: match.matched_name,
          list: listName(match.list_key),
          ref: match.list_ref,
        })}
      </p>
      <Callout
        tone={outcome === 'confirmed' ? 'neg' : 'info'}
        title={t(outcome === 'confirmed' ? 'sanctions.resolve.confirmEffect' : 'sanctions.resolve.clearEffect')}
      />
      <Field label={t('sanctions.resolve.note')} hint={t(`sanctions.resolve.noteHint.${outcome}`)} error={noteError}>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  )
}
