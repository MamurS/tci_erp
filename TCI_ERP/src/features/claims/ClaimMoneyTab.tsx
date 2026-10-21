/** Payments out and recoveries back, with the cumulative position between them.
 * The split is computed and frozen by tci.record_recovery; this only shows it. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import {
  AmountInput,
  Button,
  Callout,
  Card,
  DateInput,
  EmptyState,
  Field,
  Input,
  KeyFigures,
  Modal,
  Panel,
  PanelGrid,
  Spinner,
  Table,
} from '../../components/ui'
import { todayIso } from '../../components/ui/dateEntry'
import { EM_DASH, formatAmount, formatDate } from '../../lib/format'
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
  const canRecover = isClaims && (payments ?? []).length > 0

  if (isLoading) return <Spinner label={t('common.loading')} />
  // A payment is offered while something approved is still unpaid — the
  // database caps payments at the indemnity, so a fully paid claim has
  // nothing left to record.
  const canPay =
    isClaims &&
    ['approved', 'partially_approved', 'paid'].includes(claim.status) &&
    Number(position?.outstanding_indemnity ?? 0) > 0
  const cur = claim.currency_code
  const decided = position?.approved_indemnity !== null && position?.approved_indemnity !== undefined
  // Until the claim is decided nothing is owed, paid or recovered: every
  // figure is "—", not a 0 that reads like a settled account.
  const figure = (value: number | null | undefined) =>
    !decided || value === null || value === undefined ? EM_DASH : `${formatAmount(Number(value), locale)} ${cur}`
  const noMovement = (payments ?? []).length === 0 && (recoveries ?? []).length === 0

  return (
    <div>
      <KeyFigures
        items={[
          { label: t('claims.money.approved'), value: figure(position?.approved_indemnity), tone: decided ? 'default' : 'muted' },
          { label: t('claims.money.paid'), value: figure(position?.paid_total), tone: decided ? 'default' : 'muted' },
          {
            label: t('claims.money.outstanding'),
            value: figure(position?.outstanding_indemnity),
            tone: !decided ? 'muted' : Number(position?.outstanding_indemnity ?? 0) > 0 ? 'warn' : 'default',
          },
          {
            label: t('claims.money.insurerNet'),
            value: figure(position?.insurer_net_position),
            meta: t('claims.money.insurerNetHint'),
            tone: decided ? 'default' : 'muted',
          },
        ]}
      />

      {noMovement && !canPay ? (
        <Card className="p-6">
          <EmptyState title={t('claims.money.emptyTitle')} hint={t('claims.money.emptyHint')} />
        </Card>
      ) : (
        <PanelGrid>
          <Panel
            title={t('claims.money.payments')}
            hint={t('claims.money.paymentsHint')}
            actions={
              canPay && (
                <Button size="sm" variant="secondary" onClick={() => setPaying(true)}>
                  {t('claims.actions.recordPayment')}
                </Button>
              )
            }
          >
            {(payments ?? []).length === 0 ? (
              <p className="py-2 text-[13px] text-slate-500">{t('claims.money.noPayments')}</p>
            ) : (
              <Table dense>
                <thead>
                  <tr>
                    <th>{t('claims.fields.paidAt')}</th>
                    <th>{t('claims.fields.reference')}</th>
                    <th className="text-right">{t('claims.fields.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(payments ?? []).map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap">{formatDate(p.paid_at, locale)}</td>
                      <td className="text-slate-600">{p.reference ?? EM_DASH}</td>
                      <td className="num">
                        {formatAmount(Number(p.amount), locale)} {p.currency_code}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <Panel
            title={t('claims.money.recoveries')}
            hint={t('claims.money.splitRule')}
            actions={
              canRecover && (
                <Button size="sm" variant="secondary" onClick={() => setRecovering(true)}>
                  {t('claims.actions.recordRecovery')}
                </Button>
              )
            }
          >
            {(recoveries ?? []).length === 0 ? (
              <p className="py-2 text-[13px] text-slate-500">{t('claims.money.noRecoveries')}</p>
            ) : (
              <Table dense>
                <thead>
                  <tr>
                    <th>{t('claims.fields.receivedAt')}</th>
                    <th className="text-right">{t('claims.fields.net')}</th>
                    <th className="text-right">{t('claims.fields.insurerShare')}</th>
                    <th className="text-right">{t('claims.fields.policyholderShare')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(recoveries ?? []).map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">
                        {formatDate(r.received_at, locale)}
                        <span className="block text-[11.5px] text-slate-400">
                          {t('claims.money.grossLessCosts', {
                            gross: formatAmount(Number(r.gross_amount), locale),
                            costs: formatAmount(Number(r.recovery_costs), locale),
                          })}
                        </span>
                      </td>
                      <td className="num">{formatAmount(Number(r.net_amount), locale)}</td>
                      <td className="num">{formatAmount(Number(r.insurer_share), locale)}</td>
                      <td className="num">{formatAmount(Number(r.policyholder_share), locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </PanelGrid>
      )}

      {paying && <PaymentModal claim={claim} onClose={() => setPaying(false)} />}
      {recovering && <RecoveryModal claim={claim} onClose={() => setRecovering(false)} />}
    </div>
  )
}

function PaymentModal({ claim, onClose }: { claim: Claim; onClose: () => void }) {
  const { t } = useTranslation()
  const record = useRecordPayment()
  const [amount, setAmount] = useState('')
  const [paidAt, setPaidAt] = useState(todayIso())
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
            disabled={!(Number(amount) > 0) || paidAt === '' || record.isPending}
            title={Number(amount) > 0 && paidAt !== '' ? undefined : t('claims.money.paymentRequiredHint')}
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
      {error && <Callout tone="neg" title={error} />}
      <p className="text-[13px] leading-relaxed text-slate-600">{t('claims.money.paymentHint')}</p>
      <Field label={t('claims.fields.amount')}>
        <AmountInput value={amount} onChange={setAmount} suffix={claim.currency_code} />
      </Field>
      <Field label={t('claims.fields.paidAt')}>
        <DateInput value={paidAt} max={todayIso()} onChange={setPaidAt} />
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
  const [receivedAt, setReceivedAt] = useState(todayIso())
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
            disabled={!(Number(gross) > 0) || receivedAt === '' || record.isPending}
            title={Number(gross) > 0 && receivedAt !== '' ? undefined : t('claims.money.recoveryRequiredHint')}
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
      {error && <Callout tone="neg" title={error} />}
      <p className="text-[13px] leading-relaxed text-slate-600">{t('claims.money.recoveryHint')}</p>
      <Field label={t('claims.fields.gross')}>
        <AmountInput value={gross} onChange={setGross} suffix={claim.currency_code} />
      </Field>
      <Field label={t('claims.fields.recoveryCosts')}>
        <AmountInput value={costs} onChange={setCosts} suffix={claim.currency_code} />
      </Field>
      <Field label={t('claims.fields.receivedAt')}>
        <DateInput value={receivedAt} max={todayIso()} onChange={setReceivedAt} />
      </Field>
      <Field label={t('claims.fields.note')}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  )
}
