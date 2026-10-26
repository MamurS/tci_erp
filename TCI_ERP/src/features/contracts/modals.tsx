/** The draft screens' dialogs: a status change (with its comment or the
 * reason the database requires), signing with the scan, and saving a
 * version with its change note. */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Callout, Field, Input, Modal, Textarea } from '../../components/ui'
import { useChangeStatus, useSignDraft } from './api'
import { contractErrorKey } from './errors'
import type { OfferedAction } from './machine'

export function StatusModal({
  draftId,
  action,
  onClose,
}: {
  draftId: string
  action: OfferedAction | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const change = useChangeStatus()
  useEffect(() => {
    if (action) {
      setComment('')
      setError(null)
    }
  }, [action])
  if (!action || action.action === 'sign') return null

  const submit = () => {
    setError(null)
    change
      .mutateAsync({ draftId, to: action.to, comment })
      .then(onClose)
      .catch((e: unknown) => setError(t(contractErrorKey(e))))
  }
  return (
    <Modal
      open
      title={t(`contractDrafts.status.${action.action}.title`)}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={change.isPending || (action.needsReason && !comment.trim())}>
            {t(`contractDrafts.status.${action.action}.confirm`)}
          </Button>
        </>
      }
    >
      <p className="text-body text-slate-600">{t(`contractDrafts.status.${action.action}.body`)}</p>
      <Field
        label={action.needsReason ? t('contractDrafts.status.reason') : t('contractDrafts.status.comment')}
        hint={action.needsReason ? t('contractDrafts.status.reasonHint') : undefined}
      >
        <Textarea rows={3} value={comment} maxLength={1000} onChange={(e) => setComment(e.target.value)} />
      </Field>
      {error && (
        <p className="text-small text-neg-500" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}

export function SignModal({
  draftId,
  versionNo,
  open,
  onClose,
}: {
  draftId: string
  versionNo: number
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sign = useSignDraft()
  useEffect(() => {
    if (open) {
      setFile(null)
      setError(null)
    }
  }, [open])

  const submit = () => {
    if (!file) return
    if (file.type && file.type !== 'application/pdf') {
      setError(t('contractDrafts.errors.scanNotPdf'))
      return
    }
    setError(null)
    sign
      .mutateAsync({ draftId, versionNo, file })
      .then(onClose)
      .catch((e: unknown) => setError(t(contractErrorKey(e))))
  }

  return (
    <Modal
      open={open}
      title={t('contractDrafts.sign.title', { version: versionNo })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} disabled={!file || sign.isPending}>
            {sign.isPending ? t('common.saving') : t('contractDrafts.sign.submit')}
          </Button>
        </>
      }
    >
      <Callout tone="warn" title={t('contractDrafts.sign.finalTitle')}>
        {t('contractDrafts.sign.finalBody')}
      </Callout>
      <Field label={t('contractDrafts.sign.file')} hint={t('contractDrafts.sign.fileHint')}>
        <Input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      {error && (
        <p className="text-small text-neg-500" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}

export function SaveModal({
  open,
  baseVersionNo,
  pending,
  error,
  onSave,
  onClose,
}: {
  open: boolean
  baseVersionNo: number
  pending: boolean
  error: string | null
  onSave: (note: string) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [note, setNote] = useState('')
  useEffect(() => {
    if (open) setNote('')
  }, [open])
  return (
    <Modal
      open={open}
      title={t('contractDrafts.save.title', { version: baseVersionNo + 1 })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onSave(note)} disabled={pending}>
            {pending ? t('common.saving') : t('contractDrafts.save.submit')}
          </Button>
        </>
      }
    >
      <p className="text-body text-slate-600">{t('contractDrafts.save.body', { version: baseVersionNo + 1 })}</p>
      <Field label={t('contractDrafts.save.note')} hint={t('contractDrafts.save.noteHint')}>
        <Input
          autoFocus
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !pending) onSave(note)
          }}
        />
      </Field>
      {error && (
        <p className="text-small text-neg-500" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
