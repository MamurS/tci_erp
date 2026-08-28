/** Invoices and their coverage verdicts. Every line shows what the engine
 * decided, the numbers behind it, and — where a human disagreed — both. */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  Table,
} from '../../components/ui'
import { EM_DASH, formatAmount } from '../../lib/format'
import {
  useClaimCoverage,
  useClearOverride,
  useOverrideVerdict,
  useSaveClaimInvoice,
  useVerifyCoverage,
} from './api'
import { coverageTotals, sortReasons, verdictTone } from './coverage'
import { claimErrorKey } from './errors'
import type { Claim, ClaimInvoiceCoverage, CoverageVerdict } from './types'
import { COVERAGE_VERDICTS } from './types'

export function ClaimInvoicesTab({ claim }: { claim: Claim }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { roles } = useAuth()
  const { data: lines, isLoading } = useClaimCoverage(claim.id)
  const verify = useVerifyCoverage()
  const [editing, setEditing] = useState<ClaimInvoiceCoverage | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isClaims = roles.includes('claims') || roles.includes('admin')
  const canEdit =
    (isClaims || roles.includes('sales')) &&
    ['draft', 'submitted', 'under_assessment', 'info_requested'].includes(claim.status)

  if (isLoading) return <Spinner label={t('common.loading')} />
  const rows = lines ?? []
  const totals = coverageTotals(rows)

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-md bg-neg-50 px-3 py-2 text-[13px] text-neg-500">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-6 text-[13px]">
          <Total label={t('claims.fields.claimable')} value={totals.claimable} currency={claim.currency_code} locale={locale} />
          <Total label={t('claims.fields.covered')} value={totals.covered} currency={claim.currency_code} locale={locale} />
          <Total label={t('claims.fields.uncovered')} value={totals.uncovered} currency={claim.currency_code} locale={locale} />
        </div>
        <div className="flex gap-2">
          {canEdit && <Button variant="secondary" onClick={() => setAdding(true)}>{t('claims.actions.addInvoice')}</Button>}
          {isClaims && (
            <Button
              variant="secondary"
              onClick={() => {
                setError(null)
                verify.mutateAsync(claim.id).catch((e: unknown) => {
                  const k = claimErrorKey(e)
                  setError(k ? t(k) : t('common.somethingWentWrong'))
                })
              }}
            >
              {t('claims.actions.verify')}
            </Button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState title={t('claims.invoices.emptyTitle')} hint={t('claims.invoices.emptyHint')} />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>{t('claims.fields.invoiceNumber')}</th>
                <th>{t('claims.fields.shipmentDate')}</th>
                <th>{t('claims.fields.dueDate')}</th>
                <th className="num">{t('claims.fields.claimable')}</th>
                <th className="num">{t('claims.fields.covered')}</th>
                <th>{t('claims.fields.verdict')}</th>
                <th>{t('claims.fields.reasons')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((line) => (
                <InvoiceRow
                  key={line.claim_invoice_id}
                  line={line}
                  locale={locale}
                  canOverride={isClaims && !['paid', 'closed', 'withdrawn'].includes(claim.status)}
                  onOverride={() => setEditing(line)}
                />
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {editing && (
        <OverrideModal claim={claim} line={editing} onClose={() => setEditing(null)} />
      )}
      {adding && <InvoiceModal claim={claim} onClose={() => setAdding(false)} />}
    </div>
  )
}

function Total({
  label,
  value,
  currency,
  locale,
}: {
  label: string
  value: number
  currency: string
  locale: string
}) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="num font-semibold">
        {formatAmount(value, locale)} {currency}
      </p>
    </div>
  )
}

function InvoiceRow({
  line,
  locale,
  canOverride,
  onOverride,
}: {
  line: ClaimInvoiceCoverage
  locale: string
  canOverride: boolean
  onOverride: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const reasons = sortReasons(line.system_reasons ?? [])
  return (
    <>
      <tr>
        <td>
          <button type="button" className="text-accent-600 hover:underline" onClick={() => setOpen((v) => !v)}>
            {line.invoice_number}
          </button>
        </td>
        <td>{line.shipment_date}</td>
        <td>{line.due_date}</td>
        <td className="num">{formatAmount(Number(line.claimable_amount), locale)}</td>
        <td className="num">
          {line.effective_covered_amount === null
            ? EM_DASH
            : formatAmount(Number(line.effective_covered_amount), locale)}
        </td>
        <td>
          {line.effective_verdict === null ? (
            <span className="text-slate-400">{EM_DASH}</span>
          ) : (
            <Badge tone={verdictTone(line.effective_verdict)}>
              {t(`claims.verdicts.${line.effective_verdict}`)}
            </Badge>
          )}
          {line.is_overridden && (
            <span className="ml-1">
              <Badge tone="accent">
                {t('claims.overridden')}
              </Badge>
            </span>
          )}
        </td>
        <td className="space-x-1">
          {reasons.map((r) => (
            <Badge key={r} tone="neutral">
              {t(`claims.reasons.${r}`)}
            </Badge>
          ))}
        </td>
        <td className="text-right">
          {canOverride && line.verdict_id && (
            <Button size="sm" variant="secondary" onClick={onOverride}>
              {t('claims.actions.override')}
            </Button>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} className="bg-slate-50">
            <VerdictDetail line={line} locale={locale} />
          </td>
        </tr>
      )}
    </>
  )
}

/** The numbers the reason codes stand on — the point of the whole exercise is
 * that an assessor can see WHY, not just what. */
function VerdictDetail({ line, locale }: { line: ClaimInvoiceCoverage; locale: string }) {
  const { t } = useTranslation()
  const d = line.system_detail
  if (!d) return <p className="p-3 text-[13px] text-slate-500">{t('claims.notVerifiedYet')}</p>
  return (
    <div className="grid gap-3 p-3 text-[13px] sm:grid-cols-3">
      <Detail label={t('claims.detail.basis')} value={d.basis ? t(`claims.basis.${d.basis}`) : EM_DASH} />
      <Detail
        label={t('claims.detail.cap')}
        value={d.cap === null ? EM_DASH : formatAmount(Number(d.cap), locale)}
      />
      <Detail
        label={t('claims.detail.balanceBefore')}
        value={d.balance_before === null ? EM_DASH : formatAmount(Number(d.balance_before), locale)}
      />
      <Detail
        label={t('claims.detail.headroom')}
        value={d.headroom === null ? EM_DASH : formatAmount(Number(d.headroom), locale)}
      />
      <Detail
        label={t('claims.detail.paymentTerms')}
        value={`${d.payment_terms_days ?? EM_DASH} / ${d.max_payment_terms_days ?? EM_DASH}`}
      />
      <Detail
        label={t('claims.detail.decisionValidity')}
        value={
          d.decision_id
            ? `${d.decision_valid_from ?? EM_DASH} — ${d.decision_valid_until ?? '∞'}`
            : t('claims.detail.noDecision')
        }
      />
      {line.is_overridden && (
        <div className="sm:col-span-3 rounded-md bg-white p-3">
          <p className="text-xs text-slate-500">{t('claims.detail.systemSaid')}</p>
          <p className="font-medium">
            {t(`claims.verdicts.${line.system_verdict!}`)} ·{' '}
            {formatAmount(Number(line.system_covered_amount ?? 0), locale)}
          </p>
          <p className="mt-2 text-xs text-slate-500">{t('claims.detail.overrideJustification')}</p>
          <p>{line.override_justification}</p>
        </div>
      )}
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="num font-medium text-slate-800">{value}</p>
    </div>
  )
}

function OverrideModal({
  claim,
  line,
  onClose,
}: {
  claim: Claim
  line: ClaimInvoiceCoverage
  onClose: () => void
}) {
  const { t } = useTranslation()
  const override = useOverrideVerdict()
  const clear = useClearOverride()
  const [verdict, setVerdict] = useState<CoverageVerdict>(line.override_verdict ?? 'covered')
  const [amount, setAmount] = useState(
    String(line.override_covered_amount ?? line.claimable_amount),
  )
  const [justification, setJustification] = useState(line.override_justification ?? '')
  const [error, setError] = useState<string | null>(null)

  function fail(e: unknown) {
    const k = claimErrorKey(e)
    setError(k ? t(k) : t('common.somethingWentWrong'))
  }

  return (
    <Modal
      open
      title={t('claims.override.title', { invoice: line.invoice_number })}
      onClose={onClose}
      footer={
        <>
          {line.is_overridden && (
            <Button
              variant="secondary"
              onClick={() =>
                clear
                  .mutateAsync({ claim_id: claim.id, claim_invoice_id: line.claim_invoice_id })
                  .then(onClose)
                  .catch(fail)
              }
            >
              {t('claims.actions.clearOverride')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={justification.trim() === ''}
            onClick={() =>
              override
                .mutateAsync({
                  claim_id: claim.id,
                  claim_invoice_id: line.claim_invoice_id,
                  verdict,
                  covered_amount: verdict === 'not_covered' ? 0 : Number(amount),
                  justification,
                })
                .then(onClose)
                .catch(fail)
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
      <p className="text-[13px] text-slate-600">{t('claims.override.hint')}</p>
      <Field label={t('claims.fields.verdict')}>
        <Select value={verdict} onChange={(e) => setVerdict(e.target.value as CoverageVerdict)}>
          {COVERAGE_VERDICTS.map((v) => (
            <option key={v} value={v}>
              {t(`claims.verdicts.${v}`)}
            </option>
          ))}
        </Select>
      </Field>
      {verdict !== 'not_covered' && (
        <Field label={t('claims.fields.covered')}>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      )}
      <Field label={t('claims.fields.justification')}>
        <Input value={justification} onChange={(e) => setJustification(e.target.value)} />
      </Field>
      <p className="mt-1 text-xs text-slate-500">{t('claims.override.justificationHint')}</p>
    </Modal>
  )
}

function InvoiceModal({ claim, onClose }: { claim: Claim; onClose: () => void }) {
  const { t } = useTranslation()
  const save = useSaveClaimInvoice()
  const [form, setForm] = useState({
    invoice_number: '',
    invoice_date: '',
    shipment_date: '',
    due_date: '',
    amount: '',
    paid_amount: '0',
    disputed_amount: '0',
  })
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <Modal
      open
      title={t('claims.actions.addInvoice')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() =>
              save
                .mutateAsync({
                  claim_id: claim.id,
                  invoice_number: form.invoice_number,
                  invoice_date: form.invoice_date,
                  shipment_date: form.shipment_date,
                  due_date: form.due_date,
                  amount: Number(form.amount),
                  paid_amount: Number(form.paid_amount || 0),
                  disputed_amount: Number(form.disputed_amount || 0),
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
      <Field label={t('claims.fields.invoiceNumber')}>
        <Input value={form.invoice_number} onChange={set('invoice_number')} />
      </Field>
      <Field label={t('claims.fields.invoiceDate')}>
        <Input type="date" value={form.invoice_date} onChange={set('invoice_date')} />
      </Field>
      <Field label={t('claims.fields.shipmentDate')}>
        <Input type="date" value={form.shipment_date} onChange={set('shipment_date')} />
      </Field>
      <p className="-mt-2 mb-2 text-xs text-slate-500">{t('claims.shipmentDateHint')}</p>
      <Field label={t('claims.fields.dueDate')}>
        <Input type="date" value={form.due_date} onChange={set('due_date')} />
      </Field>
      <Field label={`${t('claims.fields.amount')} (${claim.currency_code})`}>
        <Input type="number" value={form.amount} onChange={set('amount')} />
      </Field>
      <Field label={t('claims.fields.paidAmount')}>
        <Input type="number" value={form.paid_amount} onChange={set('paid_amount')} />
      </Field>
      <Field label={t('claims.fields.disputedAmount')}>
        <Input type="number" value={form.disputed_amount} onChange={set('disputed_amount')} />
      </Field>
      <p className="mt-1 text-xs text-slate-500">{t('claims.disputedHint')}</p>
    </Modal>
  )
}
