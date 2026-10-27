/**
 * Entering Allianz Trade's country ratings (0088): one country — a rating,
 * or «no longer rated» with a note — or a list pasted from the publication.
 * Every entry names the publication's date and where it was read; the
 * database keeps every entry and uses the latest publication. A reference,
 * never a driver: the dialog says so, and that the ratings are Allianz
 * Trade's content, entered under its terms of use.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Callout, DateInput, Field, Input, Modal, Tabs, Textarea } from '../../components/ui'
import { todayIso } from '../../components/ui/dateEntry'
import { refusalKey } from '../../lib/refusals'
import { CountryPicker } from '../entities/CountryPicker'
import { useImportReferenceRatings, useSetReferenceRating } from '../risk/api'
import type { ReferenceRating } from '../risk/api'
import { LEVEL_LABEL, parseReferenceList, parseReferenceRating } from './referenceRatings'
import { ReferenceRatingBadge } from './ReferenceRatingBadge'

type Mode = 'one' | 'list'

export function ReferenceRatingsModal({
  live,
  knownCodes,
  initialCountry,
  onClose,
}: {
  live: Map<string, ReferenceRating>
  knownCodes: ReadonlySet<string>
  initialCountry?: string | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>('one')
  const [country, setCountry] = useState<string | null>(initialCountry ?? null)
  const [rating, setRating] = useState('')
  const [clear, setClear] = useState(false)
  const [note, setNote] = useState('')
  const [asOf, setAsOf] = useState(todayIso())
  const [reference, setReference] = useState('')
  const [list, setList] = useState('')
  const [tried, setTried] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const setOne = useSetReferenceRating()
  const importList = useImportReferenceRatings()

  const parsed = parseReferenceRating(rating)
  const read = useMemo(() => parseReferenceList(list, knownCodes), [list, knownCodes])
  const current = country ? live.get(country) : undefined

  const errs = {
    country: mode === 'one' && !country ? t('risk.reference.errors.country') : null,
    rating: mode === 'one' && !clear && !parsed ? t('risk.reference.errors.rating') : null,
    note: mode === 'one' && clear && !note.trim() ? t('risk.errors.referenceClearedNote') : null,
    asOf: !asOf ? t('risk.errors.referenceAsOf') : asOf > todayIso() ? t('risk.errors.referenceAsOf') : null,
    reference: !reference.trim() ? t('risk.errors.referenceReference') : null,
    list: mode === 'list' && (read.rows.length === 0 || read.errors.length > 0) ? t('risk.reference.errors.list') : null,
  }
  const shown = (k: keyof typeof errs) => (tried ? errs[k] : null)
  const pending = setOne.isPending || importList.isPending

  const submit = () => {
    setTried(true)
    setError(null)
    if (Object.values(errs).some(Boolean)) return
    const fail = (e: unknown) => setError(t(refusalKey(e)))
    if (mode === 'one' && country) {
      setOne
        .mutateAsync({
          countryCode: country,
          rating: clear ? null : (parsed?.code ?? null),
          asOf,
          reference: reference.trim(),
          note: note.trim() || null,
        })
        .then(onClose)
        .catch(fail)
    } else {
      importList
        .mutateAsync({ asOf, reference: reference.trim(), rows: read.rows.map(({ country_code, rating: r }) => ({ country_code, rating: r })) })
        .then((r) => {
          setDone(t('risk.reference.list.done', { inserted: r.inserted, unchanged: r.unchanged }))
          setList('')
          setTried(false)
        })
        .catch(fail)
    }
  }

  return (
    <Modal
      open
      title={t('risk.reference.title')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={pending} onClick={submit}>
            {mode === 'one' ? t('risk.reference.one.submit') : t('risk.reference.list.submit', { count: read.rows.length })}
          </Button>
        </>
      }
    >
      <p className="text-small text-slate-600">{t('risk.reference.intro')}</p>
      <Tabs
        size="sm"
        active={mode}
        onChange={(k) => {
          setMode(k as Mode)
          setTried(false)
          setError(null)
          setDone(null)
        }}
        tabs={[
          { key: 'one', label: t('risk.reference.one.tab') },
          { key: 'list', label: t('risk.reference.list.tab') },
        ]}
      />
      {error && <Callout tone="neg" title={error} />}
      {done && <Callout tone="pos" title={done} />}

      {mode === 'one' ? (
        <>
          <Field label={t('risk.countries.fields.country')} error={shown('country')}>
            <CountryPicker value={country} onChange={setCountry} invalid={Boolean(shown('country'))} aria-label={t('risk.countries.fields.country')} />
          </Field>
          {country && (
            <p className="-mt-2 flex flex-wrap items-center gap-2 text-caption text-slate-500">
              {t('risk.reference.one.now')}
              {current ? <ReferenceRatingBadge rating={current} /> : <span>{t('risk.reference.none')}</span>}
            </p>
          )}
          <label className="flex items-center gap-2 text-small text-slate-700">
            <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} />
            {t('risk.reference.one.clear')}
          </label>
          {!clear && (
            <Field label={t('risk.reference.one.rating')} hint={t('risk.reference.one.ratingHint')} error={shown('rating')}>
              <span className="flex items-center gap-3">
                <Input className="w-28 font-mono uppercase" value={rating} maxLength={3} onChange={(e) => setRating(e.target.value)} />
                {parsed && (
                  <span className="text-small text-slate-600">
                    {t('risk.reference.reads', {
                      grade: parsed.grade,
                      level: parsed.level,
                      label: t(`risk.reference.level.${LEVEL_LABEL[parsed.level]}`),
                    })}
                  </span>
                )}
              </span>
            </Field>
          )}
          <Field label={t('risk.reference.one.note')} hint={clear ? undefined : t('risk.reference.one.noteHint')} error={shown('note')}>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </>
      ) : (
        <Field label={t('risk.reference.list.label')} hint={t('risk.reference.list.hint')} error={shown('list')}>
          <Textarea rows={8} className="font-mono" value={list} onChange={(e) => setList(e.target.value)} placeholder={'DE A1\nUZ C3\nKZ BB2'} />
          {list.trim() !== '' && (
            <span className="mt-2 flex flex-col gap-1 text-caption">
              <span className="text-slate-600">
                <Badge tone="neutral">{t('risk.reference.list.rows', { count: read.rows.length })}</Badge>
              </span>
              {read.unknown.length > 0 && (
                <span className="text-slate-600">{t('risk.reference.list.unknown', { codes: read.unknown.join(', ') })}</span>
              )}
              {read.errors.map((e) => (
                <span key={`${e.kind}-${e.line}`} className="font-medium text-danger-700">
                  {t(`risk.reference.list.error.${e.kind}`, {
                    line: e.line,
                    value: 'value' in e ? e.value : 'text' in e ? e.text : '',
                    code: 'code' in e ? e.code : '',
                    first: 'firstLine' in e ? e.firstLine : '',
                  })}
                </span>
              ))}
            </span>
          )}
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('risk.reference.asOf')} hint={t('risk.reference.asOfHint')} error={shown('asOf')}>
          <DateInput value={asOf} onChange={setAsOf} max={todayIso()} invalid={Boolean(shown('asOf'))} required />
        </Field>
        <Field label={t('risk.reference.reference')} hint={t('risk.reference.referenceHint')} error={shown('reference')}>
          <Input value={reference} maxLength={500} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
      <p className="text-caption text-slate-500">{t('risk.reference.licence')}</p>
    </Modal>
  )
}
