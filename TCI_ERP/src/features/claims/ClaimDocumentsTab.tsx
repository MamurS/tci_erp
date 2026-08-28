/** The evidence file: what is required for this cause of loss, what is here,
 * and what is still missing. The checklist is the same one the database
 * refuses submission on. */

import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import { Badge, Button, Card, EmptyState, Select, Spinner, Table } from '../../components/ui'
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
import type { Claim, ClaimDocumentType } from './types'
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

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-md bg-neg-50 px-3 py-2 text-[13px] text-neg-500">
          {error}
        </p>
      )}

      <Card>
        <h2 className="text-sm font-semibold">{t('claims.documents.checklistTitle')}</h2>
        <p className="mt-1 text-[13px] text-slate-600">
          {t(`claims.documents.checklistHint.${claim.cause_of_loss}`)}
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {required.map((r) => (
            <li key={r}>
              <Badge tone={missing.includes(r) ? 'warn' : 'pos'}>
                {t(`claims.documentTypes.${r}`)}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>

      {canUpload && (
        <Card>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[13px]">
              <span className="mb-1 block text-slate-600">{t('claims.fields.documentType')}</span>
              <Select value={type} onChange={(e) => setType(e.target.value as ClaimDocumentType)}>
                {CLAIM_DOCUMENT_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {t(`claims.documentTypes.${d}`)}
                  </option>
                ))}
              </Select>
            </label>
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPTED_MIME_TYPES.join(',')}
              className="text-[13px]"
              onChange={(e) => onPick(e.target.files?.[0])}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">{t('claims.documents.uploadHint')}</p>
        </Card>
      )}

      {(docs ?? []).length === 0 ? (
        <EmptyState title={t('claims.documents.emptyTitle')} hint={t('claims.documents.emptyHint')} />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>{t('claims.fields.documentType')}</th>
                <th>{t('claims.fields.filename')}</th>
                <th>{t('claims.fields.uploadedAt')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(docs ?? []).map((d) => (
                <tr key={d.id}>
                  <td>{t(`claims.documentTypes.${d.document_type}`)}</td>
                  <td>
                    <button
                      type="button"
                      className="text-accent-600 hover:underline"
                      onClick={() =>
                        signedDocumentUrl(d.storage_path)
                          .then((url) => window.open(url, '_blank', 'noopener'))
                          .catch(() => setError(t('claims.errors.documentUnavailable')))
                      }
                    >
                      {d.original_filename}
                    </button>
                  </td>
                  <td>{formatMoment(d.uploaded_at, locale)}</td>
                  <td className="text-right">
                    {canUpload && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          remove
                            .mutateAsync({ claim_id: claim.id, document_id: d.id })
                            .catch((e: unknown) => {
                              const k = claimErrorKey(e)
                              setError(k ? t(k) : t('common.somethingWentWrong'))
                            })
                        }
                      >
                        {t('common.delete')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  )
}
