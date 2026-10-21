/** The evidence file: what is required for this cause of loss, what is here,
 * and what is still missing. The checklist is the same one the database
 * refuses submission on. */

import { CheckCircle2, CircleDashed, Trash2, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import { Button, Callout, ConfirmDialog, EmptyState, Panel, PanelGrid, Select, Spinner, Table } from '../../components/ui'
import { formatMoment } from '../../lib/format'
import {
  signedDocumentUrl,
  useClaimDocuments,
  useClaimReadiness,
  useDeleteClaimDocument,
  useUploadClaimDocument,
} from './api'
import { ACCEPTED_MIME_TYPES, documentRejection, requiredDocuments } from './documents'
import { claimErrorKey } from './errors'
import type { Claim, ClaimDocument, ClaimDocumentType } from './types'
import { CLAIM_DOCUMENT_TYPES } from './types'

export function ClaimDocumentsTab({ claim }: { claim: Claim }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { roles } = useAuth()
  const { data: docs, isLoading } = useClaimDocuments(claim.id)
  const { data: readiness } = useClaimReadiness(claim.id)
  const upload = useUploadClaimDocument()
  const remove = useDeleteClaimDocument()
  const fileRef = useRef<HTMLInputElement>(null)
  const [type, setType] = useState<ClaimDocumentType>('invoice')
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<ClaimDocument | null>(null)

  const canUpload =
    (roles.includes('claims') || roles.includes('sales') || roles.includes('admin')) &&
    !['paid', 'closed', 'withdrawn'].includes(claim.status)
  const required = requiredDocuments(claim.cause_of_loss)
  const missing = readiness?.missing ?? []

  if (isLoading) return <Spinner label={t('common.loading')} />

  function onPick(file: File | undefined) {
    if (!file) return
    setError(null)
    const rejection = documentRejection(file)
    if (rejection) {
      setError(t(`claims.errors.document${rejection[0]!.toUpperCase()}${rejection.slice(1)}`))
      return
    }
    upload
      .mutateAsync({ claim_id: claim.id, file, document_type: type })
      .catch((e: unknown) => {
        const k = claimErrorKey(e)
        setError(k ? t(k) : t('common.somethingWentWrong'))
      })
      .finally(() => {
        if (fileRef.current) fileRef.current.value = ''
      })
  }

  const counts = new Map<string, number>()
  for (const d of docs ?? []) counts.set(d.document_type, (counts.get(d.document_type) ?? 0) + 1)

  return (
    <div>
      {error && <Callout tone="neg" title={error} className="mb-5" />}

      <PanelGrid cols="lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Panel
          title={t('claims.documents.checklistTitle')}
          hint={t(`claims.documents.checklistHint.${claim.cause_of_loss}`)}
        >
          <ul>
            {required.map((r) => {
              const ok = !missing.includes(r)
              return (
                <li
                  key={r}
                  className="flex items-center gap-3 border-b border-slate-100 py-2.5 text-[13px] first:pt-0 last:border-b-0"
                >
                  {ok ? (
                    <CheckCircle2 className="size-4 shrink-0 text-pos-500" aria-hidden />
                  ) : (
                    <CircleDashed className="size-4 shrink-0 text-warn-500" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 text-slate-800">{t(`claims.documentTypes.${r}`)}</span>
                  <span className={ok ? 'text-slate-500' : 'font-medium text-warn-500'}>
                    {ok
                      ? t('claims.documents.filesCount', { count: counts.get(r) ?? 0 })
                      : t('claims.documents.missing')}
                  </span>
                </li>
              )
            })}
          </ul>
        </Panel>

        <Panel
          title={t('claims.documents.filesTitle')}
          // Always a hint, like the checklist beside it: two panels whose
          // heads differ in shape do not line their titles up.
          hint={canUpload ? t('claims.documents.uploadHint') : t('claims.documents.filesHint')}
        >
          {/* The upload sits in the body, not beside the title: a select and a
              button in the head made it taller than the checklist's, and the
              two titles no longer lined up. */}
          {canUpload && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="w-64 max-w-full">
                <Select
                  value={type}
                  aria-label={t('claims.fields.documentType')}
                  onChange={(e) => setType(e.target.value as ClaimDocumentType)}
                >
                  {CLAIM_DOCUMENT_TYPES.map((d) => (
                    <option key={d} value={d}>
                      {t(`claims.documentTypes.${d}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <input
                ref={fileRef}
                type="file"
                hidden
                accept={ACCEPTED_MIME_TYPES.join(',')}
                onChange={(e) => onPick(e.target.files?.[0])}
              />
              <Button variant="secondary" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
                <Upload aria-hidden />
                {t('claims.documents.upload')}
              </Button>
            </div>
          )}
          {(docs ?? []).length === 0 ? (
            <EmptyState title={t('claims.documents.emptyTitle')} hint={t('claims.documents.emptyHint')} />
          ) : (
            <Table dense>
              <thead>
                <tr>
                  <th>{t('claims.fields.filename')}</th>
                  <th>{t('claims.fields.documentType')}</th>
                  <th>{t('claims.fields.uploadedAt')}</th>
                  {canUpload && <th className="w-px" />}
                </tr>
              </thead>
              <tbody>
                {(docs ?? []).map((d) => (
                  <tr key={d.id}>
                    <td className="max-w-72">
                      <button
                        type="button"
                        className="block truncate text-left font-medium text-accent-600 hover:underline"
                        title={d.original_filename}
                        onClick={() =>
                          signedDocumentUrl(d.storage_path, { filename: d.original_filename, contentType: d.content_type })
                            .then((url) => window.open(url, '_blank', 'noopener'))
                            .catch(() => setError(t('claims.errors.documentUnavailable')))
                        }
                      >
                        {d.original_filename}
                      </button>
                    </td>
                    <td className="text-slate-600">{t(`claims.documentTypes.${d.document_type}`)}</td>
                    <td className="whitespace-nowrap text-slate-500">{formatMoment(d.uploaded_at, locale)}</td>
                    {canUpload && (
                      <td className="text-right">
                        <button
                          type="button"
                          aria-label={t('claims.documents.remove', { name: d.original_filename })}
                          title={t('claims.documents.remove', { name: d.original_filename })}
                          className="rounded-md p-1.5 text-slate-400 hover:bg-neg-50 hover:text-neg-500"
                          onClick={() => setRemoving(d)}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </PanelGrid>

      <ConfirmDialog
        open={removing !== null}
        title={t('claims.documents.removeTitle')}
        message={removing ? t('claims.documents.removeConfirm', { name: removing.original_filename }) : ''}
        confirmLabel={t('claims.documents.removeAction')}
        pending={remove.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return
          setError(null)
          remove
            .mutateAsync({ claim_id: claim.id, document_id: removing.id })
            .catch((e: unknown) => {
              const k = claimErrorKey(e)
              setError(k ? t(k) : t('common.somethingWentWrong'))
            })
            .finally(() => setRemoving(null))
        }}
      />
    </div>
  )
}
