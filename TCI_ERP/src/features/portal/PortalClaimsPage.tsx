/** The policyholder's claims: what can be claimed, what has been filed, and
 * what the insurer decided. Every read is a tci.v_client_* view and every
 * write a tci.client_* function — nothing here touches a base table. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
  Table,
} from '../../components/ui'
import { claimErrorKey } from '../claims/errors'
import { EM_DASH, formatAmount, formatMoment } from '../../lib/format'
import {
  useClientOpenClaim,
  useClientRespondToInfoRequest,
  useClientSubmitClaim,
  useClientWithdrawClaim,
  useMyClaimable,
  useMyClaims,
} from './api'
import { PortalClaimDetail } from './PortalClaimDetail'
import type { ClientClaim, ClientClaimable } from './types'

const TONE: Record<ClientClaim['status'], 'neutral' | 'accent' | 'pos' | 'neg' | 'warn'> = {
  draft: 'neutral',
  submitted: 'accent',
  under_assessment: 'accent',
  info_requested: 'warn',
  approved: 'pos',
  partially_approved: 'warn',
  declined: 'neg',
  paid: 'pos',
  closed: 'neutral',
  withdrawn: 'neutral',
}

export function PortalClaimsPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: claims, isLoading } = useMyClaims()
  const { data: claimable } = useMyClaimable()
  const [open, setOpen] = useState<string | null>(null)
  const [filing, setFiling] = useState<ClientClaimable | null>(null)
  const [responding, setResponding] = useState<ClientClaim | null>(null)
  const [error, setError] = useState<string | null>(null)
  const submit = useClientSubmitClaim()
  const withdraw = useClientWithdrawClaim()

  if (isLoading) return <Spinner label={t('common.loading')} />

  const ready = (claimable ?? []).filter((c) => !c.claim_exists)

  function fail(e: unknown) {
    const k = claimErrorKey(e)
    setError(k ? t(k) : t('common.somethingWentWrong'))
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('portal.claims.title')} subtitle={t('portal.claims.subtitle')} />

      {error && (
        <p role="alert" className="rounded-md bg-neg-50 px-3 py-2 text-[13px] text-neg-500">
          {error}
        </p>
      )}

      {ready.length > 0 && (
        <Card>
          <h2 className="text-sm font-semibold">{t('portal.claims.claimableTitle')}</h2>
          <p className="mt-1 text-[13px] text-slate-600">{t('portal.claims.claimableHint')}</p>
          <Table dense>
            <thead>
              <tr>
                <th>{t('portal.claims.fields.buyer')}</th>
                <th>{t('portal.claims.fields.policy')}</th>
                <th className="num">{t('portal.claims.fields.overdueAmount')}</th>
                <th>{t('portal.claims.fields.claimableFrom')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ready.map((c) => (
                <tr key={c.noa_id}>
                  <td>{c.buyer_name}</td>
                  <td className="text-slate-600">{c.policy_number}</td>
                  <td className="num">
                    {formatAmount(Number(c.overdue_amount), locale)} {c.currency_code}
                  </td>
                  <td>
                    {c.claimable_from}
                    {!c.claimable_now && (
                      <span className="ml-2">
                        <Badge tone="warn">{t('portal.claims.waiting')}</Badge>
                      </span>
                    )}
                  </td>
                  <td className="text-right">
                    <Button size="sm" disabled={!c.claimable_now} onClick={() => setFiling(c)}>
                      {t('portal.claims.actions.file')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {(claims ?? []).length === 0 ? (
        <EmptyState title={t('portal.claims.emptyTitle')} hint={t('portal.claims.emptyHint')} />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>{t('portal.claims.fields.number')}</th>
                <th>{t('portal.claims.fields.buyer')}</th>
                <th className="num">{t('portal.claims.fields.claimed')}</th>
                <th className="num">{t('portal.claims.fields.indemnity')}</th>
                <th>{t('portal.claims.fields.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(claims ?? []).map((c) => (
                <tr key={c.id}>
                  <td>
                    <button
                      type="button"
                      className="text-accent-600 hover:underline"
                      onClick={() => setOpen(open === c.id ? null : c.id)}
                    >
                      {c.claim_number}
                    </button>
                  </td>
                  <td>{c.buyer_name}</td>
                  <td className="num">
                    {formatAmount(Number(c.claimed_amount), locale)} {c.currency_code}
                  </td>
                  <td className="num">
                    {c.approved_indemnity === null
                      ? EM_DASH
                      : `${formatAmount(Number(c.approved_indemnity), locale)} ${c.currency_code}`}
                  </td>
                  <td>
                    <Badge tone={TONE[c.status]}>{t(`claims.statuses.${c.status}`)}</Badge>
                  </td>
                  <td className="space-x-2 text-right">
                    {c.status === 'draft' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => submit.mutateAsync(c.id).catch(fail)}
                        >
                          {t('portal.claims.actions.submit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            withdraw.mutateAsync({ claim_id: c.id }).catch(fail)
                          }
                        >
                          {t('portal.claims.actions.withdraw')}
                        </Button>
                      </>
                    )}
                    {c.status === 'info_requested' && (
                      <Button size="sm" onClick={() => setResponding(c)}>
                        {t('portal.claims.actions.respond')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {open && <PortalClaimDetail claim={(claims ?? []).find((c) => c.id === open)!} />}

      {filing && <FileClaimModal source={filing} onClose={() => setFiling(null)} onError={fail} />}
      {responding && (
        <RespondModal claim={responding} onClose={() => setResponding(null)} onError={fail} />
      )}

      {(claims ?? []).some((c) => c.decision_reason && c.status === 'declined') && (
        <p className="text-xs text-slate-500">
          {t('portal.claims.declinedNote', { at: formatMoment(new Date(), locale) })}
        </p>
      )}
    </div>
  )
}

function FileClaimModal({
  source,
  onClose,
  onError,
}: {
  source: ClientClaimable
  onClose: () => void
  onError: (e: unknown) => void
}) {
  const { t } = useTranslation()
  const openClaim = useClientOpenClaim()
  const [cause, setCause] = useState<'protracted_default' | 'insolvency' | 'other'>(
    'protracted_default',
  )
  const [reference, setReference] = useState('')

  return (
    <Modal
      open
      title={t('portal.claims.file.title', { buyer: source.buyer_name })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() =>
              openClaim
                .mutateAsync({
                  policy_id: source.policy_id,
                  entity_id: source.buyer_id,
                  cause_of_loss: cause,
                  overdue_notification_id: source.noa_id,
                  insolvency_reference: reference || null,
                })
                .then(onClose)
                .catch(onError)
            }
          >
            {t('portal.claims.actions.create')}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-slate-600">{t('portal.claims.file.hint')}</p>
      <Field label={t('portal.claims.fields.cause')}>
        <Select
          value={cause}
          onChange={(e) =>
            setCause(e.target.value as 'protracted_default' | 'insolvency' | 'other')
          }
        >
          <option value="protracted_default">{t('claims.causes.protracted_default')}</option>
          <option value="insolvency">{t('claims.causes.insolvency')}</option>
          <option value="other">{t('claims.causes.other')}</option>
        </Select>
      </Field>
      {cause === 'insolvency' && (
        <Field label={t('portal.claims.fields.insolvencyReference')}>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      )}
    </Modal>
  )
}

function RespondModal({
  claim,
  onClose,
  onError,
}: {
  claim: ClientClaim
  onClose: () => void
  onError: (e: unknown) => void
}) {
  const { t } = useTranslation()
  const respond = useClientRespondToInfoRequest()
  const [comment, setComment] = useState('')
  return (
    <Modal
      open
      title={t('portal.claims.respond.title', { number: claim.claim_number })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={comment.trim() === ''}
            onClick={() =>
              respond
                .mutateAsync({ claim_id: claim.id, comment })
                .then(onClose)
                .catch(onError)
            }
          >
            {t('portal.claims.actions.send')}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-slate-600">{t('portal.claims.respond.hint')}</p>
      <Field label={t('portal.claims.fields.message')}>
        <Input value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
    </Modal>
  )
}
