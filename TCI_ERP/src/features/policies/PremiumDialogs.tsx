/**
 * The three writes of the «Премия» tab, each a dialog over one RPC:
 * invoice an instalment, record a payment, reverse a payment. Each paints the
 * schedule at once (premiumApi.ts) and closes; a refusal rolls the paint back
 * and is said in words here, never as server text.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AmountInput, Button, Callout, Field, Input, Modal, Select, Textarea } from '../../components/ui'
import { DateInput } from '../../components/ui/DateInput'
import { todayIso } from '../../components/ui/dateEntry'
import { formatAmount, formatDate } from '../../lib/format'
import { refusalKey } from '../../lib/refusals'
import { PAYMENT_SOURCES } from './premium'
import type { PaymentSource, PremiumInstalment, PremiumPayment } from './premium'
import { useInvoiceInstalment, useRecordPayment, useReversePayment } from './premiumApi'

function useMoney(currency: string) {
  const { i18n } = useTranslation()
  return (v: number | string) => `${formatAmount(Number(v), i18n.language)} ${currency}`
}

export function InvoiceDialog({
  policyId,
  policyNumber,
  currency,
  instalment,
  onClose,
  onError,
}: {
  policyId: string
  policyNumber: string
  currency: string
  instalment: PremiumInstalment
  onClose: () => void
  onError: (message: string) => void
}) {
  const { t, i18n } = useTranslation()
  const money = useMoney(currency)
  const invoice = useInvoiceInstalment(policyId)
  const [number, setNumber] = useState(`INV-${policyNumber}-${String(instalment.sequence).padStart(2, '0')}`)
  const [date, setDate] = useState(todayIso())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    if (!number.trim()) return setError(t('premium.errors.invoiceNumberRequired'))
    setError(null)
    // The row repaints at once; the dialog does not wait for the round trip.
    invoice
      .mutateAsync({ instalmentId: instalment.id, invoiceNumber: number.trim(), invoiceDate: date, note: note.trim() || null })
      .catch((e: unknown) => onError(t(refusalKey(e))))
    onClose()
  }

  return (
    <Modal
      open
      title={t('premium.invoice.title', { sequence: instalment.sequence })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={invoice.isPending}>
            {t('premium.invoice.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{t('premium.invoice.hint')}</p>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-slate-500">{t('premium.fields.dueDate')}</dt>
            <dd className="font-medium text-slate-900">{formatDate(instalment.due_date, i18n.language)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">{t('premium.fields.amount')}</dt>
            <dd className="num font-medium text-slate-900">{money(instalment.amount)}</dd>
          </div>
        </dl>
        <Field label={t('premium.fields.invoiceNumber')} hint={t('premium.invoice.numberHint')}>
          <Input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={64} autoFocus />
        </Field>
        <Field label={t('premium.fields.invoiceDate')}>
          <DateInput value={date} onChange={setDate} max={todayIso()} />
        </Field>
        <Field label={t('premium.fields.note')}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
        </Field>
        {error && <Callout tone="neg" title={error} />}
      </div>
    </Modal>
  )
}

export function PaymentDialog({
  policyId,
  currency,
  outstanding,
  suggested,
  onClose,
  onError,
}: {
  policyId: string
  currency: string
  /** What is still owed on the whole policy: the most a payment may be. */
  outstanding: number
  /** The amount offered: what the instalment the dialog was opened from owes. */
  suggested: number
  onClose: () => void
  onError: (message: string) => void
}) {
  const { t } = useTranslation()
  const money = useMoney(currency)
  const record = useRecordPayment(policyId)
  const [amount, setAmount] = useState(suggested > 0 ? String(suggested) : '')
  const [date, setDate] = useState(todayIso())
  const [reference, setReference] = useState('')
  const [source, setSource] = useState<PaymentSource>('manual')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const value = Number(amount)
  const submit = () => {
    if (!amount || !(value > 0)) return setError(t('premium.payment.amountRequired'))
    if (Math.round(value * 100) > Math.round(outstanding * 100)) {
      return setError(t('premium.payment.amountTooHigh', { amount: money(outstanding) }))
    }
    if (date > todayIso()) return setError(t('premium.payment.dateInFuture'))
    setError(null)
    record
      .mutateAsync({
        amount: value,
        paymentDate: date,
        currency,
        reference: reference.trim() || null,
        source,
        note: note.trim() || null,
      })
      .catch((e: unknown) => onError(t(refusalKey(e))))
    onClose()
  }

  return (
    <Modal
      open
      title={t('premium.payment.title')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={submit} loading={record.isPending}>
            {t('premium.payment.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{t('premium.payment.hint', { amount: money(outstanding) })}</p>
        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <Field label={t('premium.fields.amount')}>
            <AmountInput value={amount} onChange={setAmount} suffix={currency} autoFocus invalid={Boolean(error) && !(value > 0)} />
          </Field>
          <Field label={t('premium.fields.currency')} hint={t('premium.payment.currencyHint')}>
            <Input value={currency} readOnly disabled />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('premium.fields.paymentDate')}>
            <DateInput value={date} onChange={setDate} max={todayIso()} />
          </Field>
          <Field label={t('premium.fields.source')}>
            <Select value={source} onChange={(e) => setSource(e.target.value as PaymentSource)}>
              {PAYMENT_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(`premium.sources.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('premium.fields.reference')}>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} />
        </Field>
        <Field label={t('premium.fields.note')}>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} />
        </Field>
        {error && <Callout tone="neg" title={error} />}
      </div>
    </Modal>
  )
}

export function ReverseDialog({
  policyId,
  currency,
  payment,
  onClose,
  onError,
}: {
  policyId: string
  currency: string
  payment: PremiumPayment
  onClose: () => void
  onError: (message: string) => void
}) {
  const { t } = useTranslation()
  const money = useMoney(currency)
  const reverse = useReversePayment(policyId)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    if (!reason.trim()) return setError(t('premium.reverse.reasonRequired'))
    reverse.mutateAsync({ paymentId: payment.id, reason: reason.trim() }).catch((e: unknown) => onError(t(refusalKey(e))))
    onClose()
  }

  return (
    <Modal
      open
      title={t('premium.reverse.title', { amount: money(payment.amount) })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={submit} loading={reverse.isPending}>
            {t('premium.reverse.submit')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">{t('premium.reverse.hint')}</p>
        <Field label={t('premium.fields.reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} autoFocus />
        </Field>
        {error && <Callout tone="neg" title={error} />}
      </div>
    </Modal>
  )
}
