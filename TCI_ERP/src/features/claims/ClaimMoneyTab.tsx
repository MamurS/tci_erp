/** Payments out and recoveries back, with the cumulative position between them.
 * The split is computed and frozen by tci.record_recovery; this only shows it. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Spinner,
  Table,
} from '../../components/ui'
import { EM_DASH, formatAmount } from '../../lib/format'
import {
  useClaimPayments,
  useClaimPosition,
  useRecordPayment,
  useRecordRecovery,
  useRecoveries,
} from './api'
import { claimErrorKey } from './errors'
import type { Claim } from './types'

export function ClaimMoneyTab({ claim }: { claim: Claim }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { roles } = useAuth()
  const { data: position, isLoading } = useClaimPosition(claim.id)
  const { data: payments } = useClaimPayments(claim.id)
  const { data: recoveries } = useRecoveries(claim.id)
  const [paying, setPaying] = useState(false)
  const [recovering, setRecovering] = useState(false)

  const isClaims = roles.includes('claims') || roles.includes('admin')
  const canPay = isClaims && ['approved', 'partially_approved', 'paid'].includes(claim.status)
  const canRecover = isClaims && (payments ?? []).length > 0

  if (isLoading) return <Spinner label={t('common.loading')} />
  const cur = claim.currency_code

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">
        <Figure label={t('claims.money.approved')} value={position?.approved_indemnity ?? null} cur={cur} locale={locale} />
        <Figure label={t('claims.money.paid')} value={position?.paid_total ?? 0} cur={cur} locale={locale} />
        <Figure label={t('claims.money.outstanding')} value={position?.outstanding_indemnity ?? 0} cur={cur} locale={locale} />
        <Figure label={t('claims.money.insurerNet')} value={position?.insurer_net_position ?? 0} cur={cur} locale={locale} />
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('claims.money.payments')}</h2>
          {canPay && <Button variant="secondary" onClick={() => setPaying(true)}>{t('claims.actions.recordPayment')}</Button>}
        </div>
        {(payments ?? []).length === 0 ? (
          <p className="mt-3 text-[13px] text-slate-500">{t('claims.money.noPayments')}</p>
        ) : (
          <Table dense>
            <thead>
              <tr>
                <th>{t('claims.fields.paidAt')}</th>
                <th>{t('claims.fields.reference')}</th>
                <th className="num">{t('claims.fields.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {(payments ?? []).map((p) => (
                <tr key={p.id}>
                  <td>{p.paid_at}</td>
                  <td className="text-slate-600">{p.reference ?? EM_DASH}</td>
                  <td className="num">
                    {formatAmount(Number(p.amount), locale)} {p.currency_code}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t('claims.money.recoveries')}</h2>
          {canRecover && (
            <Button variant="secondary" onClick={() => setRecovering(true)}>
              {t('claims.actions.recordRecovery')}
            </Button>
          )}
        </div>
        <p className="mt-1 text-[13px] text-slate-600">{t('claims.money.splitRule')}</p>
        {(recoveries ?? []).length === 0 ? (
          <p className="mt-3 text-[13px] text-slate-500">{t('claims.money.noRecoveries')}</p>
        ) : (
          <Table dense>
            <thead>
              <tr>
                <th>{t('claims.fields.receivedAt')}</th>
                <th className="num">{t('claims.fields.gross')}</th>
                <th className="num">{t('claims.fields.recoveryCosts')}</th>
                <th className="num">{t('claims.fields.net')}</th>
                <th className="num">{t('claims.fields.insurerShare')}</th>
                <th className="num">{t('claims.fields.policyholderShare')}</th>
              </tr>
            </thead>
            <tbody>
              {(recoveries ?? []).map((r) => (
                <tr key={r.id}>
                  <td>{r.received_at}</td>
                  <td className="num">{formatAmount(Number(r.gross_amount), locale)}</td>
                  <td className="num">{formatAmount(Number(r.recovery_costs), locale)}</td>
                  <td className="num">{formatAmount(Number(r.net_amount), locale)}</td>
                  <td className="num">{formatAmount(Number(r.insurer_share), locale)}</td>
                  <td className="num">{formatAmount(Number(r.policyholder_share), locale)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {!canPay && !canRecover && (payments ?? []).length === 0 && (
        <EmptyState title={t('claims.money.emptyTitle')} hint={t('claims.money.emptyHint')} />
      )}

      {paying && <PaymentModal claim={claim} onClose={() => setPaying(false)} />}
      {recovering && <RecoveryModal claim={claim} onClose={() => setRecovering(false)} />}
    </div>
  )
}

function Figure({
  label,
  value,
  cur,
  locale,
}: {
  label: string
  value: number | null
  cur: string
  locale: string
}) {
  return (
    <Card>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="num mt-1 text-xl font-semibold">
        {value === null ? EM_DASH : `${formatAmount(Number(value), locale)} ${cur}`}
      </p>
    </Card>
  )
}

function PaymentModal({ claim, onClose }: { claim: Claim; onClose: () => void }) {
  const { t } = useTranslation()
  const record = useRecordPayment()
  const [amount, setAmount] = useState('')
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10))
  const [reference, setReference] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal
      open
      title={t('claims.actions.recordPayment')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() =>
              record
                .mutateAsync({
                  claim_id: claim.id,
                  amount: Number(amount),
                  paid_at: paidAt,
                  reference: reference || null,
                })
                .then(onClose)
                .catch((e: unknown) => {
                  const k = claimErrorKey(e)
                  setError(k ? t(k) : t('common.somethingWentWrong'))
                })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" className="mb-3 rounded-md bg-neg-50 px-3 py-2 text-[13px] text-neg-500">
          {error}
        </p>
      )}
      <p className="text-[13px] text-slate-600">{t('claims.money.paymentHint')}</p>
      <Field label={`${t('claims.fields.amount')} (${claim.currency_code})`}>
        <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label={t('claims.fields.paidAt')}>
        <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
      </Field>
      <Field label={t('claims.fields.reference')}>
        <Input value={reference} onChange={(e) => setReference(e.target.value)} />
      </Field>
    </Modal>
  )
}

function RecoveryModal({ claim, onClose }: { claim: Claim; onClose: () => void }) {
  const { t } = useTranslation()
  const record = useRecordRecovery()
  const [gross, setGross] = useState('')
  const [costs, setCosts] = useState('0')
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal
      open
      title={t('claims.actions.recordRecovery')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() =>
              record
                .mutateAsync({
                  claim_id: claim.id,
                  gross_amount: Number(gross),
                  recovery_costs: Number(costs || 0),
                  received_at: receivedAt,
                  note: note || null,
                })
                .then(onClose)
                .catch((e: unknown) => {
                  const k = claimErrorKey(e)
                  setError(k ? t(k) : t('common.somethingWentWrong'))
                })
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" className="mb-3 rounded-md bg-neg-50 px-3 py-2 text-[13px] text-neg-500">
          {error}
        </p>
      )}
      <p className="text-[13px] text-slate-600">{t('claims.money.recoveryHint')}</p>
      <Field label={`${t('claims.fields.gross')} (${claim.currency_code})`}>
        <Input type="number" value={gross} onChange={(e) => setGross(e.target.value)} />
      </Field>
      <Field label={t('claims.fields.recoveryCosts')}>
        <Input type="number" value={costs} onChange={(e) => setCosts(e.target.value)} />
      </Field>
      <Field label={t('claims.fields.receivedAt')}>
        <Input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
      </Field>
      <Field label={t('claims.fields.note')}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  )
}
