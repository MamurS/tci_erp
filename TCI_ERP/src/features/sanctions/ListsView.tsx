/**
 * «Санкции › Списки» (migration 0091): the sanctions lists in use — which,
 * as of when, how many parties — and the import. The browser reads the file
 * the publisher published (lists/parse.ts), shows what it found, and loads it
 * in batches; the database delists whoever is missing from it and the
 * companies kept screened are screened against it before the dialog closes.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'

import { useAuth } from '../../auth/AuthContext'
import {
  Badge,
  Button,
  Callout,
  COL,
  DateInput,
  EmptyState,
  Field,
  Input,
  Modal,
  Panel,
  Select,
  Table,
} from '../../components/ui'
import { todayIso } from '../../components/ui/dateEntry'
import { formatDate, formatMoment } from '../../lib/format'
import { refusalKey } from '../../lib/refusals'
import { useImportSanctionsList, useSanctionsLists } from './api'
import type { ImportProgress } from './api'
import { useListName } from './useListName'
import {
  guessList,
  LISTS,
  ListFormatError,
  parseEu,
  parseOfacSdn,
  parseSimpleCsv,
  parseUk,
  parseUn,
} from './lists/parse'
import type { ParsedList, SanctionsList } from './lists/parse'
import { LIST_DOWNLOADS, mayImportLists } from './model'

export function ListsView() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { actingRole } = useAuth()
  const lists = useSanctionsLists()
  const listName = useListName()
  const writer = mayImportLists(actingRole)
  const [importing, setImporting] = useState(false)
  const rows = lists.data ?? []

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title={t('sanctions.lists.title')}
        hint={t('sanctions.lists.hint')}
        actions={
          writer ? (
            <Button size="sm" onClick={() => setImporting(true)}>
              {t('sanctions.lists.import')}
            </Button>
          ) : undefined
        }
      >
        {lists.isLoading ? null : rows.length === 0 ? (
          <EmptyState pictogram="documents" title={t('sanctions.lists.empty')} />
        ) : (
          <Table columns={[COL.fill, '10rem', '9rem', '10rem', '12rem']}>
            <thead>
              <tr>
                <th>{t('sanctions.lists.list')}</th>
                <th>{t('sanctions.lists.published')}</th>
                <th>{t('sanctions.lists.parties')}</th>
                <th>{t('sanctions.lists.activated')}</th>
                <th>{t('sanctions.lists.state')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.list_key}>
                  <td className="whitespace-normal">
                    <span className="block font-medium text-slate-800">{listName(l.list_key)}</span>
                    {l.file_name && <span className="text-caption text-slate-500">{l.file_name}</span>}
                  </td>
                  <td className="tabular-nums">{l.published_at ? formatDate(l.published_at, locale) : '—'}</td>
                  <td className="tabular-nums">
                    {l.entry_count ?? '—'}
                    {l.delisted_count ? (
                      <span className="block text-caption text-slate-500">
                        {t('sanctions.lists.delisted', { count: l.delisted_count })}
                      </span>
                    ) : null}
                  </td>
                  <td className="tabular-nums text-small">{l.activated_at ? formatMoment(l.activated_at, locale) : '—'}</td>
                  <td>
                    {!l.import_id ? (
                      <Badge tone="warn">{t('sanctions.lists.missing')}</Badge>
                    ) : l.stale ? (
                      <Badge tone="warn">{t('sanctions.lists.stale')}</Badge>
                    ) : (
                      <Badge tone="neutral">{t('sanctions.lists.fresh')}</Badge>
                    )}
                    {!l.required && <span className="block text-caption text-slate-500">{t('sanctions.lists.optional')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>

      <Panel title={t('sanctions.lists.whereTitle')} hint={t('sanctions.lists.whereHint')}>
        <ul className="flex flex-col gap-2 text-small">
          {(Object.keys(LIST_DOWNLOADS) as (keyof typeof LIST_DOWNLOADS)[]).map((list) => (
            <li key={list} className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-medium text-slate-800">{t(`sanctions.lists.name.${list}`)}</span>
              {LIST_DOWNLOADS[list].map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-accent-700 hover:underline">
                  {decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? url)}
                  <ExternalLink aria-hidden className="size-3.5" />
                </a>
              ))}
            </li>
          ))}
        </ul>
      </Panel>

      {importing && <ImportListModal onClose={() => setImporting(false)} />}
    </div>
  )
}

async function sha256(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

function ImportListModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [list, setList] = useState<SanctionsList>('ofac_sdn')
  const [otherName, setOtherName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [altFile, setAltFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParsedList | null>(null)
  const [publishedAt, setPublishedAt] = useState(todayIso())
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shrunk, setShrunk] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [result, setResult] = useState<{ entries: number; delisted: number; screened: number } | null>(null)
  const run = useImportSanctionsList(setProgress)

  const read = async (main: File | null, alt: File | null, which: SanctionsList) => {
    setParsed(null)
    setError(null)
    setShrunk(false)
    if (!main) return
    setReading(true)
    try {
      const text = await main.text()
      const guessed = guessList(main.name, text.slice(0, 400))
      if (guessed && guessed !== which) {
        setError(t('sanctions.import.looksLike', { list: t(`sanctions.lists.name.${guessed}`) }))
      }
      const out =
        which === 'ofac_sdn'
          ? parseOfacSdn(text, alt ? await alt.text() : null)
          : which === 'un'
            ? parseUn(text)
            : which === 'eu'
              ? parseEu(text)
              : which === 'uk'
                ? parseUk(text)
                : parseSimpleCsv(text)
      setParsed(out)
      if (out.publishedAt) setPublishedAt(out.publishedAt)
    } catch (e) {
      setError(t(e instanceof ListFormatError ? `sanctions.import.format.${e.code}` : 'sanctions.import.format.format'))
    } finally {
      setReading(false)
    }
  }

  const submit = async () => {
    if (!parsed || !file) return
    setError(null)
    try {
      const r = await run.mutateAsync({
        list,
        listName: list === 'other' ? otherName.trim() : null,
        publishedAt,
        fileName: altFile ? `${file.name} + ${altFile.name}` : file.name,
        sha256: await sha256(file),
        entries: parsed.entries,
        confirmShrink: shrunk,
      })
      setResult({ entries: r.entries, delisted: r.delisted, screened: r.screened })
    } catch (e) {
      const key = refusalKey(e)
      if (key === 'sanctions.errors.listShrunk') setShrunk(true)
      setError(t(key))
    }
  }

  const names = parsed ? parsed.entries.reduce((n, e) => n + e.names.length, 0) : 0
  const busy = run.isPending
  const missingName = list === 'other' && !otherName.trim()

  return (
    <Modal
      open
      title={t('sanctions.import.title')}
      onClose={busy ? () => undefined : onClose}
      footer={
        result ? (
          <Button onClick={onClose}>{t('sanctions.import.done')}</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button loading={busy} disabled={!parsed || missingName || !publishedAt} onClick={() => void submit()}>
              {shrunk ? t('sanctions.import.submitShrunk') : t('sanctions.import.submit')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <Callout
          tone="pos"
          title={t('sanctions.import.result', { entries: result.entries, delisted: result.delisted, screened: result.screened })}
        />
      ) : (
        <>
          {error && <Callout tone={shrunk ? 'warn' : 'neg'} title={error} />}
          <p className="text-small text-slate-600">{t('sanctions.import.intro')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('sanctions.import.list')}>
              <Select
                value={list}
                disabled={busy}
                onChange={(e) => {
                  const next = e.target.value as SanctionsList
                  setList(next)
                  void read(file, altFile, next)
                }}
              >
                {LISTS.map((l) => (
                  <option key={l} value={l}>
                    {t(`sanctions.lists.name.${l}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {list === 'other' && (
              <Field label={t('sanctions.import.otherName')} hint={t('sanctions.import.otherHint')}>
                <Input value={otherName} maxLength={120} onChange={(e) => setOtherName(e.target.value)} disabled={busy} />
              </Field>
            )}
          </div>
          <Field label={t(list === 'ofac_sdn' ? 'sanctions.import.fileSdn' : 'sanctions.import.file')} hint={t(`sanctions.import.fileHint.${list}`)}>
            <input
              type="file"
              accept={list === 'un' ? '.xml' : '.csv,.txt'}
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null
                setFile(f)
                void read(f, altFile, list)
              }}
              className="text-small"
            />
          </Field>
          {list === 'ofac_sdn' && (
            <Field label={t('sanctions.import.fileAlt')} hint={t('sanctions.import.fileAltHint')}>
              <input
                type="file"
                accept=".csv,.txt"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null
                  setAltFile(f)
                  void read(file, f, list)
                }}
                className="text-small"
              />
            </Field>
          )}
          {reading && <p className="text-small text-slate-500">{t('sanctions.import.reading')}</p>}
          {parsed && (
            <Callout tone="info" title={t('sanctions.import.found', { entries: parsed.entries.length, names })} />
          )}
          <Field
            label={t('sanctions.import.publishedAt')}
            hint={t(parsed?.publishedAt ? 'sanctions.import.publishedFromFile' : 'sanctions.import.publishedHint')}
          >
            <DateInput value={publishedAt} onChange={setPublishedAt} max={todayIso()} disabled={busy} required />
          </Field>
          {progress && busy && (
            <p className="text-small text-slate-600" role="status">
              {t(`sanctions.import.progress.${progress.phase}`, { done: progress.done, total: progress.total })}
            </p>
          )}
        </>
      )}
    </Modal>
  )
}
