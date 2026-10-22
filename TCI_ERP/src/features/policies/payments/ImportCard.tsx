/**
 * «Импорт выписки»: choose the bank's file, read it with a saved bank layout
 * (or map its columns once and save the layout under the bank's name),
 * check the preview, import. The file never leaves the browser: only the
 * incoming payments it holds are sent.
 */

import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileUp, Settings2 } from 'lucide-react'

import { Button, COL, Callout, Card, Field, Input, SectionTitle, Select, Table } from '../../../components/ui'
import { EM_DASH, formatAmount, formatDate } from '../../../lib/format'
import { refusalKey } from '../../../lib/refusals'
import { useBankProfiles, useImportBankStatement, useSaveBankProfile } from './api'
import {
  MAX_STATEMENT_LINES,
  STATEMENT_FILE_TYPES,
  applyMapping,
  guessMapping,
  headerLabels,
  mappingProblems,
  readMapping,
  readStatementFile,
} from './bankStatement'
import type { BankMapping, Cell } from './bankStatement'
import type { ImportResult } from './lines'
import { MappingEditor } from './MappingEditor'

/** The bank layout used last, remembered per browser (a convenience only). */
const LAST_PROFILE = 'tci-erp-bank-profile'

function rememberedProfile(): string {
  try {
    return localStorage.getItem(LAST_PROFILE) ?? ''
  } catch {
    return ''
  }
}

function rememberProfile(id: string) {
  try {
    if (id) localStorage.setItem(LAST_PROFILE, id)
  } catch {
    // private window or blocked storage: nothing to remember
  }
}

const PREVIEW_ROWS = 10
const ERRORS_LISTED = 8

interface LoadedFile {
  name: string
  rows: Cell[][]
}

export function ImportCard({ onImported }: { onImported: (importId: string) => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: profiles } = useBankProfiles()
  const save = useSaveBankProfile()
  const importStatement = useImportBankStatement()
  const inputRef = useRef<HTMLInputElement>(null)

  const [file, setFile] = useState<LoadedFile | null>(null)
  const [reading, setReading] = useState(false)
  const [readFailed, setReadFailed] = useState(false)
  const [profileId, setProfileId] = useState<string>(rememberedProfile)
  const [mapping, setMapping] = useState<BankMapping | null>(null)
  const [editing, setEditing] = useState(false)
  const [layoutName, setLayoutName] = useState('')
  const [saved, setSaved] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  // A remembered layout that no longer exists reads as «new layout».
  const profile = (profiles ?? []).find((p) => p.id === profileId) ?? null

  /** The mapping to start from: the chosen layout, else a guess from the file. */
  const startMapping = (rows: Cell[][], id: string) => {
    const stored = readMapping((profiles ?? []).find((p) => p.id === id)?.mapping)
    const next = stored ?? guessMapping(rows)
    setMapping(next)
    setSaved(false)
    // A layout that does not fit this file opens for correction.
    setEditing(!stored || mappingProblems(next, headerLabels(rows[next.header_row - 1])).length > 0)
  }

  const onFile = async (picked: File | undefined) => {
    if (!picked) return
    setReading(true)
    setReadFailed(false)
    setResult(null)
    try {
      const sheet = await readStatementFile(await picked.arrayBuffer(), picked.name)
      if (!sheet.rows.length) throw new Error('empty')
      setFile({ name: picked.name, rows: sheet.rows })
      startMapping(sheet.rows, profile ? profileId : '')
      setLayoutName(profile?.name ?? '')
    } catch {
      setFile(null)
      setMapping(null)
      setReadFailed(true)
    } finally {
      setReading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const onProfile = (id: string) => {
    setProfileId(id)
    rememberProfile(id)
    setLayoutName((profiles ?? []).find((p) => p.id === id)?.name ?? '')
    if (file) startMapping(file.rows, id)
  }

  const headers = useMemo(
    () => (file && mapping ? headerLabels(file.rows[mapping.header_row - 1]) : []),
    [file, mapping],
  )
  const problems = useMemo(() => (mapping ? mappingProblems(mapping, headers) : []), [mapping, headers])
  const parsed = useMemo(
    () => (file && mapping && !problems.length ? applyMapping(file.rows, mapping) : null),
    [file, mapping, problems],
  )
  const tooMany = (parsed?.lines.length ?? 0) > MAX_STATEMENT_LINES
  const canImport = Boolean(parsed && parsed.lines.length > 0 && !tooMany) && !importStatement.isPending

  const onSave = () => {
    if (!mapping) return
    save.mutate(
      { name: layoutName, mapping },
      {
        onSuccess: (row) => {
          setProfileId(row.id)
          rememberProfile(row.id)
          setSaved(true)
        },
      },
    )
  }

  const onImport = () => {
    if (!file || !parsed) return
    importStatement.mutate(
      { profileId: profile?.id ?? null, fileName: file.name, lines: parsed.lines },
      {
        onSuccess: (res) => {
          setResult(res)
          setFile(null)
          setMapping(null)
          setEditing(false)
          onImported(res.import_id)
        },
      },
    )
  }

  const errorKey = (e: unknown) => t(refusalKey(e))

  return (
    <Card className="p-5">
      <SectionTitle hint={t('premium.bank.import.hint')}>{t('premium.bank.import.title')}</SectionTitle>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label={t('premium.bank.import.file')} hint={t('premium.bank.import.fileHint')}>
          <span className="flex min-w-0 items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept={STATEMENT_FILE_TYPES}
              className="sr-only"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Button
              variant="secondary"
              disabled={reading}
              aria-busy={reading}
              onClick={() => inputRef.current?.click()}
            >
              <FileUp aria-hidden />
              {t('premium.bank.import.choose')}
            </Button>
            <span className="min-w-0 truncate text-[13px] text-slate-600" title={file?.name}>
              {reading ? t('premium.bank.import.reading') : (file?.name ?? t('premium.bank.import.noFile'))}
            </span>
          </span>
        </Field>
        <Field label={t('premium.bank.import.layout')} hint={t('premium.bank.import.layoutHint')}>
          <Select value={profile ? profileId : ''} onChange={(e) => onProfile(e.target.value)}>
            <option value="">{t('premium.bank.import.newLayout')}</option>
            {(profiles ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {readFailed && (
        <Callout tone="neg" className="mt-4" title={t('premium.bank.import.readFailed')}>
          {t('premium.bank.import.readFailedHint')}
        </Callout>
      )}

      {result && (
        <Callout tone="pos" className="mt-4" title={t('premium.bank.import.done', { count: result.matched + result.suggested + result.unmatched + result.duplicate })}>
          {t('premium.bank.import.doneCounts', {
            matched: result.matched,
            suggested: result.suggested,
            unmatched: result.unmatched,
            duplicate: result.duplicate,
          })}
        </Callout>
      )}

      {file && mapping && (
        <div className="mt-5 flex flex-col gap-4 border-t border-slate-200 pt-5">
          <SectionTitle
            hint={profile && !editing ? t('premium.bank.mapping.usingLayout', { name: profile.name }) : t('premium.bank.mapping.hint')}
            actions={
              <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
                <Settings2 aria-hidden />
                {editing ? t('premium.bank.mapping.hide') : t('premium.bank.mapping.edit')}
              </Button>
            }
          >
            {t('premium.bank.mapping.title')}
          </SectionTitle>

          {editing && (
            <>
              <MappingEditor rows={file.rows} mapping={mapping} onChange={(m) => { setMapping(m); setSaved(false) }} />
              <div className="flex flex-wrap items-end gap-3">
                <Field label={t('premium.bank.mapping.saveAs')} className="w-full sm:w-72">
                  <Input
                    value={layoutName}
                    maxLength={120}
                    placeholder={t('premium.bank.mapping.namePlaceholder')}
                    onChange={(e) => {
                      setLayoutName(e.target.value)
                      setSaved(false)
                    }}
                  />
                </Field>
                <Button
                  variant="secondary"
                  disabled={!layoutName.trim() || save.isPending}
                  aria-busy={save.isPending}
                  onClick={onSave}
                >
                  {t('premium.bank.mapping.save')}
                </Button>
                <span className="pb-2 text-[13px] text-slate-500" role="status">
                  {saved ? t('premium.bank.mapping.saved') : ''}
                </span>
              </div>
              {save.isError && (
                <Callout tone="neg" title={t('premium.bank.mapping.saveFailed')}>
                  {errorKey(save.error)}
                </Callout>
              )}
            </>
          )}

          {problems.length > 0 ? (
            <Callout tone="warn" title={t('premium.bank.mapping.incomplete')}>
              <ul className="list-disc pl-4">
                {problems.map((p) => (
                  <li key={p}>{t(`premium.bank.mapping.problems.${p}`)}</li>
                ))}
              </ul>
            </Callout>
          ) : parsed ? (
            <Preview parsed={parsed} locale={locale} />
          ) : null}

          {tooMany && (
            <Callout tone="neg" title={t('premium.bank.import.tooMany', { max: MAX_STATEMENT_LINES })}>
              {t('premium.bank.import.tooManyHint')}
            </Callout>
          )}
          {importStatement.isError && (
            <Callout tone="neg" title={t('premium.bank.import.failed')}>
              {errorKey(importStatement.error)}
            </Callout>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button variant="ghost" onClick={() => { setFile(null); setMapping(null) }}>
              {t('common.cancel')}
            </Button>
            <Button variant="accent" disabled={!canImport} aria-busy={importStatement.isPending} onClick={onImport}>
              {t('premium.bank.import.submit', { count: parsed?.lines.length ?? 0 })}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

function Preview({ parsed, locale }: { parsed: ReturnType<typeof applyMapping>; locale: string }) {
  const { t } = useTranslation()
  const shown = parsed.lines.slice(0, PREVIEW_ROWS)
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
        <div className="flex gap-1.5">
          <dt className="text-slate-500">{t('premium.bank.preview.kept')}</dt>
          <dd className="font-semibold text-slate-800 tabular-nums">{parsed.lines.length}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-slate-500">{t('premium.bank.preview.debits')}</dt>
          <dd className="font-semibold text-slate-800 tabular-nums">{parsed.debits}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-slate-500">{t('premium.bank.preview.skipped')}</dt>
          <dd className="font-semibold text-slate-800 tabular-nums">{parsed.skipped}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-slate-500">{t('premium.bank.preview.errors')}</dt>
          <dd className="font-semibold text-slate-800 tabular-nums">{parsed.errors.length}</dd>
        </div>
      </dl>

      {parsed.errors.length > 0 && (
        <Callout tone="warn" title={t('premium.bank.preview.errorsTitle', { count: parsed.errors.length })}>
          <ul className="flex flex-col gap-0.5">
            {parsed.errors.slice(0, ERRORS_LISTED).map((e) => (
              <li key={e.line_no}>
                {t('premium.bank.preview.errorLine', {
                  line: e.line_no,
                  reason: t(`premium.bank.rowErrors.${e.reason}`),
                })}
                {e.value ? <span className="text-slate-500"> «{e.value}»</span> : null}
              </li>
            ))}
            {parsed.errors.length > ERRORS_LISTED && (
              <li className="text-slate-500">
                {t('premium.bank.preview.moreErrors', { count: parsed.errors.length - ERRORS_LISTED })}
              </li>
            )}
          </ul>
        </Callout>
      )}

      {shown.length > 0 && (
        <>
          <p className="text-xs text-slate-500">
            {t('premium.bank.preview.first', { count: shown.length, total: parsed.lines.length })}
          </p>
          <Table dense columns={['4.5rem', COL.date, COL.money, COL.fill, COL.code]}>
            <thead>
              <tr>
                <th className="num">{t('premium.bank.fields.line')}</th>
                <th>{t('premium.bank.fields.value_date')}</th>
                <th className="num">{t('premium.bank.fields.amount')}</th>
                <th>{t('premium.bank.fields.payerPurpose')}</th>
                <th>{t('premium.bank.fields.reference')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.line_no}>
                  <td className="num text-slate-500">{l.line_no}</td>
                  <td>{formatDate(l.value_date, locale)}</td>
                  <td className="num">
                    {formatAmount(l.amount, locale)} <span className="text-slate-500">{l.currency}</span>
                  </td>
                  <td>
                    <PayerPurpose payer={l.payer} purpose={l.purpose} />
                  </td>
                  <td className="font-mono text-[12px]">{l.reference ?? EM_DASH}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </>
      )}
    </div>
  )
}

/** «Payer · purpose» on one line, cut with the whole text on hover. */
function PayerPurpose({ payer, purpose }: { payer: string | null; purpose: string | null }) {
  const full = [payer, purpose].filter(Boolean).join(' · ')
  if (!full) return <span className="text-slate-400">{EM_DASH}</span>
  return (
    <span className="block truncate" title={full}>
      {payer && <span className="font-medium text-slate-800">{payer}</span>}
      {payer && purpose && <span className="text-slate-400"> · </span>}
      {purpose && <span className="text-slate-600">{purpose}</span>}
    </span>
  )
}
