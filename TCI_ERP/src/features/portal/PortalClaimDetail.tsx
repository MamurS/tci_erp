/** The open claim, expanded: its invoices and what was covered, the documents
 * still needed, what has been paid, and the policyholder's share of anything
 * recovered from the buyer. */

import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, Select, Spinner, Table } from '../../components/ui'
import { signedDocumentUrl } from '../claims/api'
import { verdictTone } from '../claims/coverage'
import { ACCEPTED_MIME_TYPES, documentRejection } from '../claims/documents'
import { claimErrorKey } from '../claims/errors'
import { CLAIM_DOCUMENT_TYPES } from '../claims/types'
import { EM_DASH, formatAmount, formatMoment } from '../../lib/format'
import {
  useClientSaveClaimInvoice,
  useClientUploadClaimDocument,
  useMyClaimDocuments,
  useMyClaimInvoices,
  useMyClaimPayments,
  useMyClaimReadiness,
  useMyRecoveries,
} from './api'
import type { ClientClaim } from './types'

export function PortalClaimDetail({ claim }: { claim: ClientClaim }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: invoices, isLoading } = useMyClaimInvoices(claim.id)
  const { data: readiness } = useMyClaimReadiness(claim.id)
  const { data: payments } = useMyClaimPayments(claim.id)
  const { data: recoveries } = useMyRecoveries(claim.id)
  const { data: documents } = useMyClaimDocuments(claim.id)
  const [error, setError] = useState<string | null>(null)

  if (isLoading) return <Spinner label={t('common.loading')} />
  const editable = claim.status === 'draft' || claim.status === 'info_requested'

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-md bg-neg-50 px-3 py-2 text-[13px] text-neg-500">
          {error}
        </p>
      )}

      {claim.decision_reason && (
        <Card className={claim.status === 'declined' ? 'border-neg-500/40 bg-neg-50' : ''}>
          <p className="text-sm font-semibold">{t('portal.claims.decisionTitle')}</p>
          <p className="mt-1 text-[13px] text-slate-700">{claim.decision_reason}</p>
          {claim.assessed_at && (
            <p className="mt-1 text-xs text-slate-500">{formatMoment(claim.assessed_at, locale)}</p>
          )}
        </Card>
      )}

      {(readiness?.blockers.length ?? 0) > 0 && claim.status === 'draft' && (
        <Card className="border-warn-500/40 bg-warn-50">
          <p className="text-sm font-semibold text-slate-800">{t('portal.claims.blockersTitle')}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-slate-700">
            {(readiness?.blockers ?? []).map((b) => (
              <li key={b}>{t(b)}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{t('portal.claims.invoicesTitle')}</h3>
          {editable && <AddInvoice claim={claim} onError={(e) => setError(mapError(e, t))} />}
        </div>
        {(invoices ?? []).length === 0 ? (
          <p className="mt-3 text-[13px] text-slate-500">{t('portal.claims.noInvoices')}</p>
        ) : (
          <Table dense>
            <thead>
              <tr>
                <th>{t('portal.claims.fields.invoiceNumber')}</th>
                <th>{t('portal.claims.fields.shipmentDate')}</th>
                <th>{t('portal.claims.fields.dueDate')}</th>
                <th className="num">{t('portal.claims.fields.outstanding')}</th>
                <th className="num">{t('portal.claims.fields.covered')}</th>
                <th>{t('portal.claims.fields.verdict')}</th>
              </tr>
            </thead>
            <tbody>
              {(invoices ?? []).map((i) => (
                <tr key={i.id}>
                  <td>{i.invoice_number}</td>
                  <td>{i.shipment_date}</td>
                  <td>{i.due_date}</td>
                  <td className="num">{formatAmount(Number(i.claimable_amount), locale)}</td>
                  <td className="num">
                    {i.effective_covered_amount === null
                      ? EM_DASH
                      : formatAmount(Number(i.effective_covered_amount), locale)}
                  </td>
                  <td>
                    {i.effective_verdict === null ? (
                      <span className="text-slate-400">{EM_DASH}</span>
                    ) : (
                      <>
                        <Badge tone={verdictTone(i.effective_verdict)}>
                          {t(`claims.verdicts.${i.effective_verdict}`)}
                        </Badge>
                        {(i.system_reasons ?? []).length > 0 && (
                          <p className="mt-1 text-xs text-slate-500">
                            {(i.system_reasons ?? [])
                              .map((r) => t(`claims.reasons.${r}`))
                              .join(' · ')}
                          </p>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <h3 className="text-sm font-semibold">{t('portal.claims.documentsTitle')}</h3>
        <ul className="mt-2 flex flex-wrap gap-2">
          {(readiness?.required_documents ?? []).map((d) => (
            <li key={d}>
              <Badge tone={(readiness?.missing_documents ?? []).includes(d) ? 'warn' : 'pos'}>
                {t(`claims.documentTypes.${d}`)}
              </Badge>
            </li>
          ))}
        </ul>
        {editable && <UploadDocument claim={claim} onError={(e) => setError(mapError(e, t))} />}
        {(documents ?? []).length > 0 && (
          <ul className="mt-3 space-y-1 text-[13px]">
            {(documents ?? []).map((d) => (
              <li key={d.id}>
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
                <span className="ml-2 text-slate-500">
                  {t(`claims.documentTypes.${d.document_type}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {((payments ?? []).length > 0 || (recoveries ?? []).length > 0) && (
        <Card>
          <h3 className="text-sm font-semibold">{t('portal.claims.moneyTitle')}</h3>
          {(payments ?? []).map((p) => (
            <p key={p.id} className="mt-2 text-[13px]">
              {t('portal.claims.paidOn', { date: p.paid_at })}{' '}
              <span className="num font-semibold">
                {formatAmount(Number(p.amount), locale)} {p.currency_code}
              </span>
            </p>
          ))}
          {(recoveries ?? []).length > 0 && (
            <>
              <p className="mt-3 text-[13px] text-slate-600">{t('portal.claims.recoveryHint')}</p>
              {(recoveries ?? []).map((r) => (
                <p key={r.id} className="mt-1 text-[13px]">
                  {t('portal.claims.recoveredOn', { date: r.received_at })}{' '}
                  <span className="num font-semibold">
                    {formatAmount(Number(r.policyholder_share), locale)} {r.currency_code}
                  </span>
                </p>
              ))}
            </>
          )}
        </Card>
      )}
    </div>
  )
}

function mapError(e: unknown, t: (k: string) => string): string {
  const key = claimErrorKey(e)
  return key ? t(key) : t('common.somethingWentWrong')
}

function AddInvoice({ claim, onError }: { claim: ClientClaim; onError: (e: unknown) => void }) {
  const { t } = useTranslation()
  const save = useClientSaveClaimInvoice()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    invoice_number: '',
    invoice_date: '',
    shipment_date: '',
    due_date: '',
    amount: '',
  })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  if (!open) {
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {t('portal.claims.actions.addInvoice')}
      </Button>
    )
  }
  return (
    <div className="flex flex-wrap items-end gap-2">
      <input className="rounded border px-2 py-1 text-[13px]" placeholder={t('portal.claims.fields.invoiceNumber')} value={form.invoice_number} onChange={set('invoice_number')} />
      <input className="rounded border px-2 py-1 text-[13px]" type="date" value={form.invoice_date} onChange={set('invoice_date')} />
      <input className="rounded border px-2 py-1 text-[13px]" type="date" value={form.shipment_date} onChange={set('shipment_date')} />
      <input className="rounded border px-2 py-1 text-[13px]" type="date" value={form.due_date} onChange={set('due_date')} />
      <input className="rounded border px-2 py-1 text-[13px]" type="number" placeholder={t('portal.claims.fields.amount')} value={form.amount} onChange={set('amount')} />
      <Button
        size="sm"
        onClick={() =>
          save
            .mutateAsync({
              claim_id: claim.id,
              invoice_number: form.invoice_number,
              invoice_date: form.invoice_date,
              shipment_date: form.shipment_date,
              due_date: form.due_date,
              amount: Number(form.amount),
            })
            .then(() => {
              setOpen(false)
              setForm({ invoice_number: '', invoice_date: '', shipment_date: '', due_date: '', amount: '' })
            })
            .catch(onError)
        }
      >
        {t('common.save')}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
        {t('common.cancel')}
      </Button>
    </div>
  )
}

function UploadDocument({ claim, onError }: { claim: ClientClaim; onError: (e: unknown) => void }) {
  const { t } = useTranslation()
  const upload = useClientUploadClaimDocument()
  const fileRef = useRef<HTMLInputElement>(null)
  const [type, setType] = useState<string>('invoice')

  return (
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <Select value={type} onChange={(e) => setType(e.target.value)}>
        {CLAIM_DOCUMENT_TYPES.map((d) => (
          <option key={d} value={d}>
            {t(`claims.documentTypes.${d}`)}
          </option>
        ))}
      </Select>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPTED_MIME_TYPES.join(',')}
        className="text-[13px]"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (!file) return
          const rejection = documentRejection(file)
          if (rejection) {
            onError({
              message:
                rejection === 'tooLarge'
                  ? 'a claim document must be between 1 byte and 20 MiB'
                  : 'this file type is not accepted for claim documents',
            })
            return
          }
          upload
            .mutateAsync({ claim_id: claim.id, file, document_type: type })
            .catch(onError)
            .finally(() => {
              if (fileRef.current) fileRef.current.value = ''
            })
        }}
      />
    </div>
  )
}
