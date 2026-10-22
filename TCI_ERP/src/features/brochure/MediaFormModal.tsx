/**
 * Upload an image to the media library, or edit what is recorded about one.
 * Alt text in all three languages, the source and the licence are required —
 * the database refuses the row without them — and the file is checked here
 * first (type, 5 MB) and measured in the browser before it is registered.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload } from 'lucide-react'

import { Button, Callout, Field, Input, Modal, Select } from '../../components/ui'
import { readImageSize, useUpdateMediaAsset, useUploadMediaAsset } from './api'
import { brochureErrorKey } from './errors'
import {
  EMPTY_META,
  LICENCE_PRESETS,
  MEDIA_MIME_TYPES,
  byteSize,
  fileProblem,
  licenceNeedsAuthor,
  licenceValue,
  metaFromAsset,
  metaProblems,
} from './media'
import type { LicenceChoice, MediaMetaForm, MetaField } from './media'
import { MediaThumb } from './MediaThumb'
import { BROCHURE_LANGS } from './model'
import type { MediaAsset } from './model'

interface MediaFormModalProps {
  open: boolean
  /** Edit this asset; upload a new one when absent. */
  asset?: MediaAsset | null
  onClose: () => void
  onDone?: (asset: MediaAsset) => void
}

export function MediaFormModal({ open, asset, onClose, onDone }: MediaFormModalProps) {
  // A fresh form every time it opens.
  if (!open) return null
  return (
    <MediaForm key={asset?.id ?? 'new'} asset={asset ?? null} onClose={onClose} onDone={onDone} />
  )
}

function MediaForm({
  asset,
  onClose,
  onDone,
}: {
  asset: MediaAsset | null
  onClose: () => void
  onDone?: (a: MediaAsset) => void
}) {
  const { t } = useTranslation()
  const upload = useUploadMediaAsset()
  const update = useUpdateMediaAsset()
  const [meta, setMeta] = useState<MediaMetaForm>(() => (asset ? metaFromAsset(asset) : EMPTY_META))
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const pending = upload.isPending || update.isPending

  // The local preview is a blob URL of the chosen file: nothing is fetched.
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const choose = (chosen: File | undefined) => {
    setError(null)
    setSize(null)
    if (!chosen) return
    const problem = fileProblem(chosen)
    setFileError(problem)
    setFile(problem ? null : chosen)
    if (!problem)
      readImageSize(chosen)
        .then(setSize)
        .catch(() => {
          setFileError('media.errors.unreadable')
          setFile(null)
        })
  }

  const problems = metaProblems(meta)
  const missing: string[] = [
    ...(!asset && !file ? [t('media.fields.file')] : []),
    ...(Object.keys(problems) as MetaField[]).map((field) => fieldLabel(field)),
  ]
  const canSend = missing.length === 0 && !fileError

  function fieldLabel(field: MetaField): string {
    if (field.startsWith('alt.')) {
      const lang = field.slice(4)
      return t('media.fields.altIn', { lang: t(`brochure.langs.${lang}`) })
    }
    return t(`media.fields.${field}`)
  }

  const set = (patch: Partial<MediaMetaForm>) => setMeta((m) => ({ ...m, ...patch }))

  const submit = () => {
    if (!canSend) return
    setError(null)
    const done = (row: MediaAsset) => {
      onDone?.(row)
      onClose()
    }
    const fail = (e: unknown) => setError(t(brochureErrorKey(e)))
    if (asset) update.mutateAsync({ id: asset.id, meta }).then(done, fail)
    else if (file) upload.mutateAsync({ file, meta }).then(done, fail)
  }

  const fileSize = file ? byteSize(file.size) : asset?.byte_size ? byteSize(asset.byte_size) : null
  const dims =
    size ?? (asset?.width && asset.height ? { width: asset.width, height: asset.height } : null)

  return (
    <Modal
      open
      wide
      title={asset ? t('media.edit.title') : t('media.upload.title')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={pending} disabled={!canSend}>
            {asset ? t('common.save') : t('media.upload.submit')}
          </Button>
        </>
      }
    >
      {error && <Callout tone="neg" title={error} />}

      {/* The file: chosen here (upload), fixed once stored (edit). */}
      <div className="flex items-start gap-4">
        {asset ? (
          <MediaThumb path={asset.storage_path} alt={asset.alt.ru} className="h-[7.5rem] w-40" />
        ) : (
          <span className="relative block h-[7.5rem] w-40 shrink-0 overflow-hidden rounded bg-accent-50 ring-1 ring-slate-200 ring-inset">
            {preview && file && (
              <img src={preview} alt="" className="absolute inset-0 size-full object-cover" />
            )}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2 text-[13px] text-slate-600">
          {!asset && (
            <div>
              <input
                ref={input}
                type="file"
                accept={MEDIA_MIME_TYPES.join(',')}
                className="sr-only"
                tabIndex={-1}
                onChange={(e) => choose(e.target.files?.[0])}
              />
              <Button variant="secondary" onClick={() => input.current?.click()}>
                <Upload aria-hidden />
                {file ? t('media.upload.chooseAnother') : t('media.upload.chooseFile')}
              </Button>
            </div>
          )}
          <p className="truncate font-medium text-slate-800" title={file?.name}>
            {file?.name ?? (asset ? asset.storage_path : t('media.upload.noFile'))}
          </p>
          <p className="tabular-nums">
            {fileSize ? t(`media.units.${fileSize.unit}`, { value: fileSize.value }) : '—'}
            {' · '}
            {dims ? t('media.dimensions', { width: dims.width, height: dims.height }) : '—'}
          </p>
          <p
            className={`min-h-5 text-xs ${fileError ? 'font-medium text-neg-500' : 'text-slate-500'}`}
          >
            {fileError
              ? t(fileError)
              : !asset
                ? t('media.upload.fileHint')
                : t('media.edit.fileFixed')}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="grid gap-4 sm:grid-cols-3">
          {BROCHURE_LANGS.map((lang) => (
            <Field
              key={lang}
              label={t('media.fields.altIn', { lang: t(`brochure.langs.${lang}`) })}
            >
              <Input
                lang={lang}
                value={meta.alt[lang]}
                maxLength={300}
                onChange={(e) => set({ alt: { ...meta.alt, [lang]: e.target.value } })}
              />
            </Field>
          ))}
        </div>
        <p className="text-xs text-slate-500">{t('media.fields.altHint')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('media.fields.source')} hint={t('media.fields.sourceHint')}>
          <Input
            value={meta.source}
            maxLength={200}
            onChange={(e) => set({ source: e.target.value })}
          />
        </Field>
        <Field label={t('media.fields.sourceUrl')} hint={t('media.fields.sourceUrlHint')}>
          <Input
            type="url"
            inputMode="url"
            value={meta.sourceUrl}
            maxLength={500}
            onChange={(e) => set({ sourceUrl: e.target.value })}
          />
        </Field>
        <Field label={t('media.fields.licence')}>
          <Select
            value={meta.licenceChoice}
            onChange={(e) => set({ licenceChoice: e.target.value as LicenceChoice | '' })}
          >
            <option value="">{t('media.licences.choose')}</option>
            {LICENCE_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {t(`media.licences.${p.key}`)}
              </option>
            ))}
            <option value="other">{t('media.licences.other')}</option>
          </Select>
        </Field>
        {/* Always here, so choosing «Другое» moves nothing: the licence's own
            name, typed only for «Другое». */}
        <Field label={t('media.fields.licenceText')}>
          <Input
            value={meta.licenceChoice === 'other' ? meta.licenceText : licenceValue(meta)}
            disabled={meta.licenceChoice !== 'other'}
            maxLength={200}
            placeholder={
              meta.licenceChoice === 'other' ? t('media.fields.licenceTextPlaceholder') : ''
            }
            onChange={(e) => set({ licenceText: e.target.value })}
          />
        </Field>
        <Field
          label={t('media.fields.author')}
          hint={
            meta.licenceChoice !== '' &&
            meta.licenceChoice !== 'other' &&
            licenceNeedsAuthor(meta.licenceChoice)
              ? t('media.fields.authorRequiredHint')
              : t('media.fields.authorHint')
          }
        >
          <Input
            value={meta.author}
            maxLength={200}
            onChange={(e) => set({ author: e.target.value })}
          />
        </Field>
      </div>

      {/* One reserved line: what is still missing, never a jump in the form. */}
      <p
        className={`min-h-5 text-xs ${missing.length ? 'text-slate-600' : 'text-pos-500'}`}
        aria-live="polite"
      >
        {missing.length
          ? t('media.form.missing', { fields: missing.join(', ') })
          : t('media.form.ready')}
      </p>
    </Modal>
  )
}
