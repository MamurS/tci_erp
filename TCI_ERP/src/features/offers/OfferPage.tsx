/**
 * The commercial offer screen («как в ДМС»): the PARAMETERS on the left —
 * language (fixed when the offer is prepared), cover, validity, whether the
 * brochure is appended, a short note to the client — and on the right the
 * live preview of every page, exactly as it prints. The words are the
 * approved template's and the facts the database's; staff never edit text.
 *
 * Saving makes a NEW version (save_offer_version); the database re-composes
 * the data on every save, so a version always prints what underwriting
 * agreed. «Сохранить и отправить клиенту» saves (when something changed) and
 * publishes (publish_offer), where the machine allows it. A published offer
 * opens read-only — «Новая версия» unlocks the form, and the client sees the
 * new version only after it is sent; an answered or withdrawn offer, or an
 * earlier version (?v=N), is read-only for good.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'

import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Segmented,
  Spinner,
  SplitHandle,
  Textarea,
  useSplitWidth,
} from '../../components/ui'
import { DateInput } from '../../components/ui/DateInput'
import { useAuth } from '../../auth/AuthContext'
import { formatAmount, formatDate } from '../../lib/format'
import { refusalKey } from '../../lib/refusals'
import { useCountries } from '../entities/api'
import { useOffer, useOfferVersion, usePublishOffer, useSaveOfferVersion } from './api'
import { staffRenderInput } from './kp/input'
import { NOTE_MAX, OFFER_COVERS, normaliseNote, paramsForSave, parseOfferParams, type OfferCover } from './kp/params'
import { canEdit, canPublishOffers, canWriteOffers, isLive, offerToday, publishBlocker, statusTone } from './machine'
import { OFFER_LANGS } from './model'
import { printOfferFrame } from './printOfferFrame'
import { OfferPreview, type OfferPreviewHandle } from './OfferPreview'
import { useOfferDocument } from './useOfferDocument'

/** The swatch of each cover in the picker (the template's own colours). */
const COVER_SWATCH: Record<OfferCover, { bg: string; fg: string }> = {
  white: { bg: '#ffffff', fg: '#005288' },
  navy: { bg: '#005288', fg: '#fcaf17' },
  blue: { bg: '#0093d0', fg: '#ffffff' },
}

interface Draft {
  cover: OfferCover
  note: string
  validUntil: string
  includeBrochure: boolean
}

export function OfferPage() {
  const { offerId } = useParams<{ offerId: string }>()
  const [search] = useSearchParams()
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'ru'
  const { roles } = useAuth()
  const { data: offer, isLoading } = useOffer(offerId)
  const asked = Number(search.get('v')) || null
  const versionNo = asked ?? offer?.current_version_no ?? null
  const { data: version, isLoading: versionLoading } = useOfferVersion(offerId, versionNo)
  const { data: countries } = useCountries()
  const save = useSaveOfferVersion()
  const publish = usePublishOffer()
  const preview = useRef<OfferPreviewHandle>(null)
  const splitFrame = useRef<HTMLDivElement>(null)
  const split = useSplitWidth('offer-edit')

  const [draft, setDraft] = useState<Draft | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [versionNote, setVersionNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<number | null>(null)

  // The form starts from the version on screen, and again after each save.
  const stored = useMemo<Draft | null>(() => {
    if (!version) return null
    const p = parseOfferParams(version.texts)
    return { cover: p.cover, note: p.note, validUntil: version.valid_until, includeBrochure: version.include_brochure }
  }, [version])
  useEffect(() => {
    if (stored) setDraft(stored)
  }, [stored])

  const dirty = Boolean(
    draft &&
      stored &&
      (draft.cover !== stored.cover ||
        normaliseNote(draft.note) !== stored.note ||
        draft.validUntil !== stored.validUntil ||
        draft.includeBrochure !== stored.includeBrochure),
  )

  // Leaving with unsaved parameters asks first (the browser's own prompt).
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const input = useMemo(
    () =>
      offer && version && draft
        ? staffRenderInput(offer, version, countries, {
            cover: draft.cover,
            note: normaliseNote(draft.note),
            validUntil: draft.validUntil || version.valid_until,
            includeBrochure: draft.includeBrochure,
          })
        : null,
    [offer, version, draft, countries],
  )
  const doc = useOfferDocument(input)

  if (isLoading || (offer && versionNo && versionLoading)) return <Spinner />
  if (!offer || !version || !draft) {
    return (
      <Card className="p-5">
        <EmptyState title={t('offers.print.missing')} hint={t('offers.print.missingHint')} />
      </Card>
    )
  }

  const latest = version.version_no === offer.current_version_no
  const writer = canWriteOffers(roles)
  const publisher = canPublishOffers(roles)
  const out = offer.status === 'published' || offer.status === 'viewed'
  const editableOffer = writer && latest && canEdit(offer)
  const editing = editableOffer && (!out || unlocked)
  const back = `/requests/${offer.insurance_request_id}?focus=offer`
  const set = (patch: Partial<Draft>) => {
    setSaved(null)
    setDraft((d) => (d ? { ...d, ...patch } : d))
  }

  // Publishing what is saved: mirrors publish_offer. Saving first makes a
  // newer version, so «already published» does not hold then.
  const blocker = publishBlocker(offer, version.valid_until)
  const canSend =
    publisher &&
    latest &&
    isLive(offer.status) &&
    (dirty ? editing && (offer.request_status === 'sales_confirmation' || offer.request_status === 'client_review') : blocker === null)

  const validate = (): boolean => {
    if (!draft.validUntil || draft.validUntil < offerToday()) {
      setError(t('offers.errors.validUntilPast'))
      return false
    }
    if (normaliseNote(draft.note).length > NOTE_MAX) {
      setError(t('offers.errors.noteTooLong', { max: NOTE_MAX }))
      return false
    }
    setError(null)
    return true
  }

  const doSave = async () => {
    const v = await save.mutateAsync({
      offer,
      baseVersionNo: version.version_no,
      texts: paramsForSave({ cover: draft.cover, note: draft.note }),
      validUntil: draft.validUntil,
      includeBrochure: draft.includeBrochure,
      note: versionNote.trim() || null,
    })
    setVersionNote('')
    setUnlocked(false)
    return v
  }

  const onSave = () => {
    if (!validate()) return
    doSave()
      .then((v) => setSaved(v.version_no))
      .catch((e: unknown) => setError(t(refusalKey(e))))
  }

  const onSend = () => {
    if (dirty && !validate()) return
    setError(null)
    ;(dirty ? doSave().then(() => undefined) : Promise.resolve())
      .then(() => publish.mutateAsync(offer))
      .then(() => setSaved(null))
      .catch((e: unknown) => setError(t(refusalKey(e))))
  }

  const onPdf = () => {
    void printOfferFrame(preview.current?.frame ?? null).catch(() => setError(t('offers.errors.printFailed')))
  }

  const premiumDue = version.data?.premium?.estimated_premium_due
  const currency = version.data?.terms?.currency_code ?? ''
  const buyers = version.data?.buyers ?? []

  return (
    <div>
      <Link to={back} className="mb-3 inline-flex items-center gap-2 text-small text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" />
        {t('offers.edit.back', { number: offer.request_number })}
      </Link>
      <PageHeader
        title={t('offers.edit.title', { number: offer.offer_number })}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {offer.entity_name}
            <Badge tone={statusTone(offer.effective_status)}>{t(`offers.statuses.${offer.effective_status}`)}</Badge>
            <span className="text-slate-500">{t('offers.edit.version', { version: version.version_no })}</span>
          </span>
        }
        actions={
          <>
            <span className="text-small text-slate-500">{t('offers.pdfHint')}</span>
            <Button variant="secondary" onClick={onPdf} disabled={!doc}>
              <Download className="size-4" />
              {t('offers.actions.downloadPdf')}
            </Button>
            {writer && (
              <Button variant="secondary" onClick={onSave} loading={save.isPending && !publish.isPending} disabled={!editing || !dirty}>
                {t('offers.edit.save')}
              </Button>
            )}
            {publisher && (
              <Button
                onClick={onSend}
                loading={publish.isPending}
                disabled={!canSend || save.isPending}
                title={!canSend && !dirty && blocker ? t(`offers.publishBlockers.${blocker}`) : t('offers.actions.publishHint')}
              >
                {t('offers.edit.saveAndSend')}
              </Button>
            )}
          </>
        }
      />

      {/* Why «Save and send to the client» is greyed out, said where it can
          be read — a tooltip on a disabled button is easy to miss. */}
      {publisher && blocker !== null && blocker !== 'nothing_new' && (
        <Callout tone="info" title={t(`offers.publishBlockers.${blocker}`)} className="mb-4">
          {blocker === 'request_step' && offer.request_status === 'commercial_review'
            ? t('offers.publishBlockerHints.request_step')
            : null}
        </Callout>
      )}
      {error && <Callout tone="neg" title={error} className="mb-4" />}
      {saved !== null && <Callout tone="pos" title={t('offers.edit.saved', { version: saved })} className="mb-4" />}
      {offer.status === 'changes_requested' && offer.client_comment && (
        <Callout tone="warn" title={t('offers.clientAskedChanges')} className="mb-4">
          «{offer.client_comment}»
        </Callout>
      )}

      <div
        ref={splitFrame}
        style={split.style}
        className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,var(--split-w,clamp(calc(22.5rem*var(--ui-text,1)),32%,34rem)))_1.25rem_minmax(0,1fr)] lg:gap-x-0"
      >
        <Card className="flex min-w-0 flex-col gap-4 p-5">
          {!latest ? (
            <Callout tone="info" title={t('offers.edit.olderVersion', { version: version.version_no, latest: offer.current_version_no })} />
          ) : !editableOffer ? (
            <Callout tone="info" title={t('offers.edit.readOnly')} />
          ) : out ? (
            <Callout
              tone="info"
              title={unlocked ? t('offers.edit.newVersionOpen') : t('offers.edit.publishedLocked')}
              action={
                <Button size="sm" variant="secondary" onClick={() => setUnlocked((u) => !u)} disabled={dirty && unlocked}>
                  {t('offers.edit.newVersion')}
                </Button>
              }
            />
          ) : null}

          {/* Not a Field: a <label> would lend its text to the first button. */}
          <div className="flex flex-col gap-2">
            <span className="text-caption font-semibold tracking-wide text-slate-600 uppercase">{t('offers.fields.language')}</span>
            <span>
              <Segmented
                value={offer.language}
                ariaLabel={t('offers.fields.language')}
                options={OFFER_LANGS.map((l) => ({ key: l, label: t(`offers.languages.${l}`), disabled: l !== offer.language }))}
                onChange={() => undefined}
              />
            </span>
            <span className="text-caption text-slate-500">{t('offers.edit.languageFixed')}</span>
          </div>

          <fieldset className="flex flex-col gap-2" disabled={!editing}>
            <legend className="mb-2 text-caption font-semibold tracking-wide text-slate-600 uppercase">{t('offers.fields.cover')}</legend>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('offers.fields.cover')}>
              {OFFER_COVERS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={draft.cover === c}
                  onClick={() => set({ cover: c })}
                  className={`flex flex-col items-stretch gap-2 rounded-md border p-2 text-caption font-medium focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
                    draft.cover === c ? 'border-accent-600 ring-1 ring-accent-600 text-accent-700' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                  data-cover={c}
                >
                  <span
                    aria-hidden
                    className="flex h-12 items-end rounded-sm border border-slate-200 p-2"
                    style={{ background: COVER_SWATCH[c].bg }}
                  >
                    <span className="h-1.5 w-8" style={{ background: COVER_SWATCH[c].fg }} />
                  </span>
                  {t(`offers.covers.${c}`)}
                </button>
              ))}
            </div>
          </fieldset>

          <Field label={t('offers.fields.validUntil')}>
            <DateInput value={draft.validUntil} onChange={(v) => set({ validUntil: v })} min={offerToday()} disabled={!editing} />
          </Field>

          <label className="flex items-start gap-2 text-body text-slate-700">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-accent-600"
              checked={draft.includeBrochure}
              disabled={!editing}
              onChange={(e) => set({ includeBrochure: e.target.checked })}
            />
            <span>
              {t('offers.fields.includeBrochure')}
              <span className="block text-small text-slate-500">{t('offers.edit.brochureHint')}</span>
            </span>
          </label>

          <Field
            label={t('offers.fields.clientNote')}
            hint={t('offers.edit.clientNoteHint', { chars: draft.note.length, max: NOTE_MAX })}
          >
            <Textarea
              value={draft.note}
              onChange={(e) => set({ note: e.target.value })}
              maxLength={NOTE_MAX}
              rows={4}
              disabled={!editing}
            />
          </Field>

          {writer && (
            <Field label={t('offers.fields.note')} hint={t('offers.edit.noteHint')}>
              <Input value={versionNote} onChange={(e) => setVersionNote(e.target.value)} maxLength={200} disabled={!editing} />
            </Field>
          )}

          <dl className="mt-auto grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 rounded-md bg-accent-50 p-4 text-small">
            <dt className="text-slate-500">{t('offers.edit.summary.number')}</dt>
            <dd className="text-right font-mono font-medium">{offer.offer_number}</dd>
            <dt className="text-slate-500">{t('offers.edit.summary.status')}</dt>
            <dd className="text-right font-medium">{t(`offers.statuses.${offer.effective_status}`)}</dd>
            <dt className="text-slate-500">{t('offers.edit.summary.premium')}</dt>
            <dd className="text-right font-semibold tabular-nums" data-testid="offer-premium">
              {typeof premiumDue === 'number' ? `${formatAmount(premiumDue, locale, Number.isInteger(premiumDue) ? 0 : 2)} ${currency}` : '—'}
            </dd>
            <dt className="text-slate-500">{t('offers.edit.buyers')}</dt>
            <dd className="text-right tabular-nums">
              {t('offers.edit.buyersValue', { approved: buyers.filter((b) => b.basis === 'approved').length, total: buyers.length })}
            </dd>
            <dt className="text-slate-500">{t('offers.edit.composedAt')}</dt>
            <dd className="text-right">{formatDate(version.data?.composed_at, locale)}</dd>
          </dl>
        </Card>
        <SplitHandle containerRef={splitFrame} rem={split.rem} onChange={split.setRem} minRem={20} />

        {/* The preview takes the row's height, set by the form beside it: out
            of the flow, it cannot stretch the row to its thousands of pixels. */}
        <div className="relative h-[calc(100vh-10rem)] min-h-[32.5rem] min-w-0 lg:h-auto">
          <OfferPreview ref={preview} doc={doc} className="absolute inset-0" />
        </div>
      </div>
    </div>
  )
}
