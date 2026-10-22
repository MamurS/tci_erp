/**
 * Edit an offer: its text blocks in the Prompt 25 editor (a lazy chunk — only
 * this route downloads TipTap), its validity and whether the brochure is
 * appended. Saving makes a NEW version; the terms, premium and limits are not
 * edited here: the database composes them from the submission on every save,
 * so the version always prints what underwriting agreed.
 */

import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SectionTitle,
  Spinner,
} from '../../components/ui'
import { DateInput } from '../../components/ui/DateInput'
import { formatDate } from '../../lib/format'
import { refusalKey } from '../../lib/refusals'
import type { ContractDoc } from '../contracts/model'
import { useOffer, useOfferVersion, useSaveOfferVersion } from './api'
import { canEdit, offerToday, statusTone } from './machine'
import { OFFER_BLOCKS } from './model'
import type { OfferBlock, OfferTexts } from './model'
import { offerPrintPath } from './paths'
import { textToDoc } from './texts'

const ContractEditor = lazy(() => import('../contracts/editor/ContractEditor'))
const NO_STALE: ReadonlySet<string> = new Set()

export function OfferEditPage() {
  const { offerId } = useParams<{ offerId: string }>()
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()
  const { data: offer, isLoading } = useOffer(offerId)
  const { data: version } = useOfferVersion(offerId, offer?.current_version_no ?? null)
  const save = useSaveOfferVersion()

  const [texts, setTexts] = useState<OfferTexts | null>(null)
  const [validUntil, setValidUntil] = useState('')
  const [brochure, setBrochure] = useState(true)
  const [note, setNote] = useState('')
  const [block, setBlock] = useState<OfferBlock>('intro')
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Start from the newest version, once.
  useEffect(() => {
    if (version && texts === null) {
      setTexts(version.texts)
      setValidUntil(version.valid_until < offerToday() ? '' : version.valid_until)
      setBrochure(version.include_brochure)
    }
  }, [version, texts])

  // Leaving with unsaved edits asks first (the browser's own prompt).
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const initial = useMemo<ContractDoc>(() => texts?.[block] ?? textToDoc(''), [texts, block])

  if (isLoading || (offer && !version)) return <Spinner />
  if (!offer || !version) return <EmptyState title={t('offers.print.missing')} hint={t('offers.print.missingHint')} />

  const editable = canEdit(offer)
  const back = `/requests/${offer.insurance_request_id}?focus=offer`

  const submit = () => {
    if (!texts) return
    if (!validUntil || validUntil < offerToday()) return setError(t('offers.errors.validUntilPast'))
    setError(null)
    save
      .mutateAsync({
        offer,
        baseVersionNo: version.version_no,
        texts,
        validUntil,
        includeBrochure: brochure,
        note: note.trim() || null,
      })
      .then(() => {
        setDirty(false)
        navigate(back)
      })
      .catch((e: unknown) => setError(t(refusalKey(e))))
  }

  return (
    <div>
      <Link to={back} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-slate-600 hover:text-slate-900">
        <ArrowLeft className="size-4" />
        {t('offers.edit.back', { number: offer.request_number })}
      </Link>
      <PageHeader
        title={t('offers.edit.title', { number: offer.offer_number })}
        subtitle={
          <span className="inline-flex items-center gap-2">
            {offer.entity_name}
            <Badge tone={statusTone(offer.effective_status)}>{t(`offers.statuses.${offer.effective_status}`)}</Badge>
            <span className="text-slate-500">
              {t('offers.edit.basedOn', { version: version.version_no, language: t(`offers.languages.${offer.language}`) })}
            </span>
          </span>
        }
        actions={
          <span className="flex gap-2">
            <Link
              to={offerPrintPath(offer.id, version.version_no)}
              className="inline-flex h-9 items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              {t('offers.actions.view')}
            </Link>
            <Button onClick={submit} loading={save.isPending} disabled={!editable || !texts}>
              {t('offers.edit.save')}
            </Button>
          </span>
        }
      />

      {!editable && <Callout tone="warn" title={t('offers.edit.notEditable')} className="mb-4" />}
      {error && <Callout tone="neg" title={error} className="mb-4" />}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="p-5">
          <SectionTitle className="mb-3" hint={t('offers.edit.textsHint')}>
            {t('offers.edit.texts')}
          </SectionTitle>
          <div role="tablist" className="mb-3 flex flex-wrap gap-1.5">
            {OFFER_BLOCKS.map((b) => (
              <button
                key={b}
                type="button"
                role="tab"
                aria-selected={b === block}
                onClick={() => setBlock(b)}
                className={`rounded-md border px-3 py-1.5 text-[13px] font-medium ${
                  b === block
                    ? 'border-accent-500 bg-accent-50 text-accent-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t(`offers.blocks.${b}`)}
              </button>
            ))}
          </div>
          <div className="min-h-[24rem] rounded-md border border-slate-200">
            <Suspense fallback={<Spinner />}>
              {texts && (
                <ContractEditor
                  key={block}
                  initial={initial}
                  stale={NO_STALE}
                  context={null}
                  onChange={(doc) => {
                    setTexts((prev) => ({ ...(prev ?? {}), [block]: doc }))
                    setDirty(true)
                  }}
                />
              )}
            </Suspense>
          </div>
        </Card>

        <div className="flex flex-col gap-5">
          <Card className="p-5">
            <SectionTitle className="mb-3">{t('offers.edit.settings')}</SectionTitle>
            <div className="space-y-4">
              <Field label={t('offers.fields.validUntil')}>
                <DateInput
                  value={validUntil}
                  onChange={(v) => {
                    setValidUntil(v)
                    setDirty(true)
                  }}
                  min={offerToday()}
                />
              </Field>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-accent-600"
                  checked={brochure}
                  onChange={(e) => {
                    setBrochure(e.target.checked)
                    setDirty(true)
                  }}
                />
                <span>{t('offers.fields.includeBrochure')}</span>
              </label>
              <Field label={t('offers.fields.note')} hint={t('offers.edit.noteHint')}>
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
              </Field>
            </div>
          </Card>
          <Card className="p-5">
            <SectionTitle className="mb-2">{t('offers.edit.fromSubmission')}</SectionTitle>
            <p className="mb-3 text-[12.5px] text-slate-500">{t('offers.edit.fromSubmissionHint')}</p>
            <dl className="space-y-1.5 text-[13px]">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">{t('offers.edit.buyers')}</dt>
                <dd className="font-medium tabular-nums">{version.data.buyers.length}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">{t('offers.edit.approvedBuyers')}</dt>
                <dd className="font-medium tabular-nums">
                  {version.data.buyers.filter((b) => b.basis === 'approved').length}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">{t('offers.edit.composedAt')}</dt>
                <dd className="font-medium">{formatDate(version.data.composed_at, locale)}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  )
}
