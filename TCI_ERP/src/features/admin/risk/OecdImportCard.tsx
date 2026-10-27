/**
 * Admin › Риски › «Импорт классификации ОЭСР» (migrations 0085, 0087,
 * tci.import_country_risk): the OECD's own PDF as published (oecdPdf.ts, the
 * PDF reader loaded on first use) or a CSV / Excel file (oecdImport.ts) is
 * read in the browser, shown as a preview with every problem named and with
 * what it CHANGES against the list in use (tci.country_risk_import_preview:
 * each country whose category moves, worse or better, with the buyers and
 * limits there), and imported as a whole list with its effective date.
 * Countries the reference list does not hold are left out and named. After
 * the import the screen says whether the list is now in use and whether
 * credit underwriting got a task for countries that got worse. The history
 * of imports stays below; the latest one is what decisions use, and an old
 * one is flagged in amber.
 */

import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { FileUp } from 'lucide-react'

import {
  Button,
  Callout,
  Card,
  COL,
  CountryFlag,
  DateInput,
  EmptyState,
  Field,
  Input,
  SectionTitle,
  Skeleton,
  Table,
} from '../../../components/ui'
import { todayIso } from '../../../components/ui/dateEntry'
import { formatDate, formatMoment } from '../../../lib/format'
import { refusalOr } from '../../../lib/optimistic'
import { DEEP_LINK_SCROLL_MARGIN, useDeepLinkFocus } from '../../../lib/useDeepLinkFocus'
import { useCountries } from '../../entities/api'
import { useCountryName } from '../../portfolio/useCountryName'
import { useCountryImports, useCountryRiskPreview, useImportCountryRisk, useRiskSettings } from '../../risk/api'
import type { CountryImportResult } from '../../risk/api'
import { CountryCategoryBadge } from '../../risk/badges'
import { importStale } from '../../risk/rules'
import {
  OECD_FILE_TYPES,
  findFileDate,
  importPayload,
  parseOecdRows,
  readOecdFile,
  refusedCodes,
  unknownCodes,
} from './oecdImport'
import type { OecdError, OecdParse } from './oecdImport'
import { parseOecdPdfLines } from './oecdPdf'
import { OecdChangesPreview } from './OecdChangesPreview'
import { usePersonName } from './usePersonName'

/** The card's anchor: the Agenda's «check the OECD list» lands here (?focus=oecd). */
const OECD_ANCHOR_ID = 'oecd-import'

/** How many problems are listed before «and N more». */
const ERRORS_SHOWN = 15

interface ReadFile {
  name: string
  parse: OecdParse
  fileDate: string | null
  /** The OECD's own PDF (footnote rules applied) or a prepared CSV / Excel file. */
  source: 'pdf' | 'table'
}

export function OecdImportCard() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const inputRef = useRef<HTMLInputElement>(null)
  const { data: countries } = useCountries()
  const countryName = useCountryName()
  const personName = usePersonName()
  const imports = useCountryImports()
  const settings = useRiskSettings()
  const importRisk = useImportCountryRisk()
  const [searchParams] = useSearchParams()
  useDeepLinkFocus(searchParams.get('focus') === 'oecd' ? OECD_ANCHOR_ID : null)

  const [file, setFile] = useState<ReadFile | null>(null)
  const [reading, setReading] = useState(false)
  const [readFailed, setReadFailed] = useState(false)
  const [effective, setEffective] = useState('')
  const [note, setNote] = useState('')
  const [refusal, setRefusal] = useState<{ key: string; codes: string[] } | null>(null)
  const [done, setDone] = useState<(CountryImportResult & { effective: string }) | null>(null)

  const known = useMemo(() => new Set((countries ?? []).map((c) => c.code)), [countries])
  // A country the reference list does not hold (Kosovo today) is left out
  // and named, not a reason to refuse the whole list.
  const unknown = file && countries ? unknownCodes(file.parse, known) : []
  const payload = useMemo(
    () => (file && countries ? importPayload(file.parse).filter((r) => known.has(r.country_code)) : []),
    [file, countries, known],
  )
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(effective)
  const ready =
    file !== null && countries !== undefined && file.parse.errors.length === 0 && payload.length > 0 && dateValid
  const preview = useCountryRiskPreview(effective, payload, ready)

  const onFile = async (picked: File | undefined) => {
    if (!picked) return
    setReading(true)
    setReadFailed(false)
    setRefusal(null)
    setDone(null)
    try {
      const bytes = await picked.arrayBuffer()
      if (/\.pdf$/i.test(picked.name)) {
        const { readPdfLines } = await import('./oecdPdfReader')
        const read = parseOecdPdfLines(await readPdfLines(bytes))
        setFile({ name: picked.name, parse: read.parse, fileDate: read.fileDate, source: 'pdf' })
        setEffective(read.fileDate ?? todayIso())
      } else {
        const rows = await readOecdFile(bytes, picked.name)
        const parse = parseOecdRows(rows)
        const fileDate = findFileDate(rows, parse.headerIndex, picked.name)
        setFile({ name: picked.name, parse, fileDate, source: 'table' })
        setEffective(fileDate ?? todayIso())
      }
    } catch {
      setFile(null)
      setReadFailed(true)
    } finally {
      setReading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const onImport = () => {
    if (!file || !ready) return
    setRefusal(null)
    importRisk.mutate(
      { effectiveDate: effective, fileName: file.name, rows: payload, note: note.trim() || null },
      {
        onSuccess: (res) => {
          setDone({ ...res, effective })
          setFile(null)
          setNote('')
          setEffective('')
        },
        onError: (failure) => {
          const key = refusalOr(failure, 'admin.risk.oecd.importFailed')
          setRefusal({ key, codes: key === 'risk.errors.importUnknown' ? refusedCodes(failure) : [] })
        },
      },
    )
  }

  const errorText = (e: OecdError) =>
    t(`admin.risk.oecd.errors.${e.kind}`, { row: e.row, value: e.value ?? '', code: e.code ?? '', firstRow: e.firstRow })

  const history = imports.data ?? []
  const latest = history[0] ?? null
  const staleMonths = settings.data?.oecd_stale_months ?? 4
  const stale = latest ? importStale(latest.effective_date, staleMonths) : true

  return (
    <Card id={OECD_ANCHOR_ID} className={`flex flex-col gap-5 p-5 ${DEEP_LINK_SCROLL_MARGIN}`}>
      <SectionTitle hint={t('admin.risk.oecd.hint')}>{t('admin.risk.oecd.title')}</SectionTitle>

      {/* The list in force: prominent, amber when old or missing. */}
      {imports.isLoading ? (
        <Skeleton className="h-14 w-full" />
      ) : imports.isError ? (
        <Callout tone="neg" title={t('admin.risk.oecd.loadFailed')} />
      ) : latest ? (
        <Callout
          tone={stale ? 'warn' : 'info'}
          title={t('admin.risk.oecd.latest', { date: formatDate(latest.effective_date, lang) })}
        >
          {t('admin.risk.oecd.latestBody', {
            file: latest.file_name,
            rows: latest.row_count,
            at: formatMoment(latest.imported_at, lang),
            by: personName(latest.imported_by),
          })}
          {stale && <span className="mt-1 block font-medium">{t('admin.risk.oecd.stale', { months: staleMonths })}</span>}
        </Callout>
      ) : (
        <Callout tone="warn" title={t('admin.risk.oecd.none')}>
          {t('admin.risk.oecd.noneBody')}
        </Callout>
      )}

      {/* The accepted format, short. */}
      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-small text-slate-700">
        <p className="font-medium text-slate-800">{t('admin.risk.oecd.format.title')}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li>{t('admin.risk.oecd.format.pdf')}</li>
          <li>{t('admin.risk.oecd.format.file')}</li>
          <li>{t('admin.risk.oecd.format.columns')}</li>
          <li>{t('admin.risk.oecd.format.unclassified')}</li>
          <li>{t('admin.risk.oecd.format.whole')}</li>
        </ul>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('admin.risk.oecd.file')} hint={t('admin.risk.oecd.fileHint')}>
          <span className="flex min-w-0 items-center gap-3">
            <input
              ref={inputRef}
              type="file"
              accept={OECD_FILE_TYPES}
              className="sr-only"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
            <Button variant="secondary" disabled={reading} aria-busy={reading} onClick={() => inputRef.current?.click()}>
              <FileUp aria-hidden />
              {t('admin.risk.oecd.choose')}
            </Button>
            <span className="min-w-0 truncate text-small text-slate-600" title={file?.name}>
              {reading ? t('admin.risk.oecd.reading') : (file?.name ?? t('admin.risk.oecd.noFile'))}
            </span>
          </span>
        </Field>
        <Field
          label={t('admin.risk.oecd.effective')}
          hint={
            file
              ? t(file.fileDate ? 'admin.risk.oecd.effectiveFromFile' : 'admin.risk.oecd.effectiveToday')
              : t('admin.risk.oecd.effectiveHint')
          }
        >
          <DateInput value={effective} onChange={setEffective} disabled={!file} required />
        </Field>
      </div>

      {readFailed && <Callout tone="neg" title={t('admin.risk.oecd.readFailed')} />}

      {file && (
        <>
          {file.parse.errors.length > 0 && (
            <Callout tone="neg" title={t('admin.risk.oecd.errorsTitle', { count: file.parse.errors.length })}>
              <ul className="list-disc space-y-0.5 pl-5">
                {file.parse.errors.slice(0, ERRORS_SHOWN).map((e, i) => (
                  <li key={i}>{errorText(e)}</li>
                ))}
              </ul>
              {file.parse.errors.length > ERRORS_SHOWN && (
                <p className="mt-1">{t('admin.risk.oecd.moreErrors', { count: file.parse.errors.length - ERRORS_SHOWN })}</p>
              )}
            </Callout>
          )}
          {unknown.length > 0 && (
            <Callout tone="warn" title={t('admin.risk.oecd.unknownTitle')}>
              {t('admin.risk.oecd.unknownLeftOut', { codes: unknown.join(', ') })}
            </Callout>
          )}
          {file.source === 'pdf' && file.parse.errors.length === 0 && (
            <p className="text-small text-slate-600">{t('admin.risk.oecd.pdfRules')}</p>
          )}

          {payload.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-small text-slate-700">
                {t('admin.risk.oecd.previewCount', { count: payload.length })}
                {file.parse.skipped > 0 && (
                  <>
                    {' · '}
                    {t('admin.risk.oecd.skipped', { count: file.parse.skipped })}
                  </>
                )}
              </p>
              {file.parse.skipped > 0 && (
                <p className="text-caption text-slate-500">
                  {t('admin.risk.oecd.skippedCodes', { codes: file.parse.skippedCodes.join(', ') })}
                </p>
              )}
              <Table dense stickyHead columns={[COL.count, COL.fill, '9rem', '16rem']}>
                <thead>
                  <tr>
                    <th>{t('admin.risk.oecd.columns.row')}</th>
                    <th>{t('admin.risk.oecd.columns.country')}</th>
                    <th>{t('admin.risk.oecd.columns.category')}</th>
                    <th>{t('admin.risk.oecd.columns.warnings')}</th>
                  </tr>
                </thead>
                <tbody>
                  {file.parse.rows.map((r) => {
                    const missing = !known.has(r.country_code)
                    return (
                      <tr key={r.country_code}>
                        <td className="num text-slate-500">{r.row}</td>
                        <td>
                          <span className="inline-flex min-w-0 items-center gap-2">
                            <CountryFlag code={r.country_code} />
                            <span className="num">{r.country_code}</span>
                            <span className="truncate">{missing ? '—' : countryName(r.country_code)}</span>
                          </span>
                        </td>
                        <td>
                          <CountryCategoryBadge category={r.category} source="oecd" />
                        </td>
                        <td className={missing ? 'font-medium text-danger-700' : 'text-slate-600'}>
                          {missing
                            ? t('admin.risk.oecd.warnings.unknownLeftOut')
                            : r.warnings.length
                              ? r.warnings
                                  .map((w) =>
                                    t(`admin.risk.oecd.warnings.${w}`, {
                                      notes: (r.notes ?? []).map((n) => `(${n})`).join(' '),
                                    }),
                                  )
                                  .join(' · ')
                              : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </div>
          )}

          {ready && <OecdChangesPreview preview={preview} />}

          <Field label={t('admin.risk.oecd.note')} hint={t('admin.risk.oecd.noteHint')}>
            <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!ready} loading={importRisk.isPending} onClick={onImport}>
              {t('admin.risk.oecd.import', { count: payload.length })}
            </Button>
            {!ready && file.parse.errors.length === 0 && payload.length > 0 && (
              <span className="text-small text-slate-600">{t('admin.risk.oecd.needDate')}</span>
            )}
          </div>
        </>
      )}

      {refusal && (
        <Callout tone="neg" title={t(refusal.key)}>
          {refusal.codes.length > 0 && t('admin.risk.oecd.unknownBody', { codes: refusal.codes.join(', ') })}
        </Callout>
      )}
      {done && (
        <Callout
          tone={done.takes_effect === false ? 'warn' : 'pos'}
          title={t('admin.risk.oecd.imported', { count: done.rows, date: formatDate(done.effective, lang) })}
        >
          {done.takes_effect === false
            ? t('admin.risk.oecd.importedNotInUse')
            : (done.downgrades ?? 0) > 0
              ? t('admin.risk.oecd.importedDowngrades', { count: done.downgrades })
              : t('admin.risk.oecd.importedNoDowngrades')}
        </Callout>
      )}

      <div className="flex flex-col gap-2">
        <SectionTitle>{t('admin.risk.oecd.historyTitle')}</SectionTitle>
        {imports.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : history.length === 0 ? (
          <EmptyState title={t('admin.risk.oecd.historyEmpty')} hint={t('admin.risk.oecd.historyEmptyHint')} />
        ) : (
          <Table dense columns={[COL.date, COL.fill, COL.count, '14rem', COL.moment, COL.person]}>
            <thead>
              <tr>
                <th>{t('admin.risk.oecd.history.effective')}</th>
                <th>{t('admin.risk.oecd.history.file')}</th>
                <th className="num text-right">{t('admin.risk.oecd.history.rows')}</th>
                <th>{t('admin.risk.oecd.history.note')}</th>
                <th>{t('admin.risk.oecd.history.importedAt')}</th>
                <th>{t('admin.risk.oecd.history.importedBy')}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={h.id}>
                  <td className={i === 0 ? 'font-semibold text-slate-900' : ''}>{formatDate(h.effective_date, lang)}</td>
                  <td>{h.file_name}</td>
                  <td className="num text-right">{h.row_count}</td>
                  <td className="text-slate-600">{h.note ?? '—'}</td>
                  <td>{formatMoment(h.imported_at, lang)}</td>
                  <td>{personName(h.imported_by)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </Card>
  )
}
