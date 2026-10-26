/** Invoices and their coverage verdicts. Every line shows what the engine
 * decided, the numbers behind it, and — where a human disagreed — both. */

import { ChevronRight, PenLine, Plus, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import {
  AmountInput,
  Badge,
  Button,
  Callout,
  Card,
  COL,
  DateInput,
  EmptyState,
  Field,
  Input,
  KeyFigures,
  Modal,
  RowActions,
  Select,
  Spinner,
  Table,
  ViewBar,
} from '../../components/ui'
import { amountToPlain } from '../../components/ui/amount'
import { EM_DASH, formatAmount, formatDate } from '../../lib/format'
import {
  useClaimCoverage,
  useClearOverride,
  useOverrideVerdict,
  useSaveClaimInvoice,
  useVerifyCoverage,
} from './api'
import { coverageTotals, decidingReasons, reasonTone, verdictTone } from './coverage'
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

  const isClaims = roles.includes('claims')
  const canEdit =
    (isClaims || roles.includes('sales')) &&
    ['draft', 'submitted', 'under_assessment', 'info_requested'].includes(claim.status)

  if (isLoading) return <Spinner label={t('common.loading')} />
  const rows = lines ?? []
  const totals = coverageTotals(rows)

  const cur = claim.currency_code
  const money = (v: number) => `${formatAmount(v, locale)} ${cur}`
  // Coverage is re-checked while the claim is being assessed; once decided
  // the verdicts are what the indemnity was frozen on.
  const canVerify =
    isClaims && ['draft', 'submitted', 'under_assessment', 'info_requested'].includes(claim.status)

  return (
    <div>
      {error && <Callout tone="neg" title={error} className="mb-5" />}

      <KeyFigures
        items={[
          { label: t('claims.fields.claimable'), value: money(totals.claimable) },
          { label: t('claims.fields.covered'), value: money(totals.covered), tone: 'pos' },
          {
            label: t('claims.fields.uncovered'),
            value: money(totals.uncovered),
            tone: totals.uncovered > 0 ? 'neg' : 'muted',
          },
        ]}
      />

      <ViewBar
        hint={t('claims.invoices.hint')}
        actions={
          <>
            {canVerify && (
              <Button
                variant="secondary"
                loading={verify.isPending}
                onClick={() => {
                  setError(null)
                  verify.mutateAsync(claim.id).catch((e: unknown) => {
                    const k = claimErrorKey(e)
                    setError(k ? t(k) : t('common.somethingWentWrong'))
                  })
                }}
              >
                <RefreshCw aria-hidden />
                {t('claims.actions.verify')}
              </Button>
            )}
            {canEdit && (
              // Secondary: the claim's next step in the header is the page's one primary.
              <Button variant="secondary" onClick={() => setAdding(true)}>
                <Plus aria-hidden />
                {t('claims.actions.addInvoice')}
              </Button>
            )}
          </>
        }
      />

      {rows.length === 0 ? (
        <Card className="p-6">
          <EmptyState title={t('claims.invoices.emptyTitle')} hint={t('claims.invoices.emptyHint')} />
        </Card>
      ) : (
        <Table dense columns={[COL.code, COL.date, COL.date, COL.money, COL.money, COL.fill, COL.icon]}>
          <thead>
            <tr>
              <th>{t('claims.fields.invoiceNumber')}</th>
              <th>{t('claims.fields.shipmentDate')}</th>
              <th>{t('claims.fields.dueDate')}</th>
              <th className="num">{t('claims.fields.claimable')}</th>
              <th className="num">{t('claims.fields.covered')}</th>
              {/* The verdict and the reasons behind it share a column: side by
                  side they pushed the table past a laptop's width. */}
              <th>{t('claims.fields.verdict')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((line) => (
              <InvoiceRow
                key={line.claim_invoice_id}
                line={line}
                locale={locale}
                currency={cur}
                canOverride={isClaims && !['paid', 'closed', 'withdrawn'].includes(claim.status)}
                onOverride={() => setEditing(line)}
              />
            ))}
          </tbody>
        </Table>
      )}

      {editing && (
        <OverrideModal claim={claim} line={editing} onClose={() => setEditing(null)} />
      )}
      {adding && <InvoiceModal claim={claim} onClose={() => setAdding(false)} />}
    </div>
  )
}

function InvoiceRow({
  line,
  locale,
  currency,
  canOverride,
  onOverride,
}: {
  line: ClaimInvoiceCoverage
  locale: string
  currency: string
  canOverride: boolean
  onOverride: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const reasons = decidingReasons(line.system_reasons ?? [])
  return (
    <>
      <tr>
        <td>
          <button
            type="button"
            aria-expanded={open}
            className="flex items-center gap-1 font-medium whitespace-nowrap text-accent-600 hover:underline"
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronRight className={`size-3.5 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
            {line.invoice_number}
          </button>
        </td>
        <td className="whitespace-nowrap">{formatDate(line.shipment_date, locale)}</td>
        <td className="whitespace-nowrap">{formatDate(line.due_date, locale)}</td>
        <td className="num">
          {formatAmount(Number(line.claimable_amount), locale)} {currency}
        </td>
        <td className="num">
          {line.effective_covered_amount === null
            ? EM_DASH
            : `${formatAmount(Number(line.effective_covered_amount), locale)} ${currency}`}
        </td>
        <td>
          <div className="flex flex-wrap gap-1">
            {line.effective_verdict === null ? (
              <span className="text-slate-400">{EM_DASH}</span>
            ) : (
              <Badge tone={verdictTone(line.effective_verdict)}>
                {t(`claims.verdicts.${line.effective_verdict}`)}
              </Badge>
            )}
            {line.is_overridden && <Badge tone="accent">{t('claims.overridden')}</Badge>}
          </div>
          {reasons.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1" aria-label={t('claims.fields.reasons')}>
              {reasons.map((r) => (
                <Badge key={r} tone={reasonTone(r)}>
                  {t(`claims.reasons.${r}`)}
                </Badge>
              ))}
            </div>
          )}
        </td>
        <RowActions>
          {canOverride && line.verdict_id && (
            <button
              type="button"
              title={t('claims.actions.override')}
              aria-label={t('claims.actions.override')}
              className="rounded-md p-1.5 text-slate-400 hover:bg-accent-50 hover:text-accent-600"
              onClick={onOverride}
            >
              <PenLine className="size-4" aria-hidden />
            </button>
          )}
        </RowActions>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} className="bg-slate-50">
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
  if (!d) return <p className="p-3 text-[0.8125rem] text-slate-500">{t('claims.notVerifiedYet')}</p>
  return (
    <div className="grid gap-3 p-3 text-[0.8125rem] sm:grid-cols-3">
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
            ? `${formatDate(d.decision_valid_from, locale)} — ${d.decision_valid_until ? formatDate(d.decision_valid_until, locale) : '∞'}`
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
      <p className="font-medium text-slate-800 tabular-nums">{value}</p>
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
    amountToPlain(line.override_covered_amount ?? line.claimable_amount),
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
              loading={clear.isPending}
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
            loading={override.isPending}
            title={justification.trim() === '' ? t('claims.override.justificationHint') : undefined}
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
      {error && <Callout tone="neg" title={error} />}
      <p className="text-[0.8125rem] leading-relaxed text-slate-600">{t('claims.override.hint')}</p>
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
          <AmountInput value={amount} onChange={setAmount} suffix={claim.currency_code} />
        </Field>
      )}
      <Field label={t('claims.fields.justification')} hint={t('claims.override.justificationHint')}>
        <Input value={justification} onChange={(e) => setJustification(e.target.value)} />
      </Field>
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
  const setField = (k: keyof typeof form) => (value: string) => setForm((f) => ({ ...f, [k]: value }))
  // The database refuses an invoice without these; say so before the click.
  const ready =
    form.invoice_number.trim() !== '' &&
    form.invoice_date !== '' &&
    form.shipment_date !== '' &&
    form.due_date !== '' &&
    Number(form.amount) > 0

  return (
    <Modal
      open
      wide
      title={t('claims.actions.addInvoice')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!ready}
            loading={save.isPending}
            title={ready ? undefined : t('claims.invoices.requiredHint')}
            onClick={() =>
              save
                .mutateAsync({
                  claim_id: claim.id,
                  invoice_number: form.invoice_number.trim(),
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
      {error && <Callout tone="neg" title={error} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('claims.fields.invoiceNumber')}>
          <Input
            autoFocus
            value={form.invoice_number}
            onChange={(e) => setField('invoice_number')(e.target.value)}
          />
        </Field>
        <Field label={t('claims.fields.invoiceDate')}>
          <DateInput value={form.invoice_date} onChange={setField('invoice_date')} />
        </Field>
        <Field label={t('claims.fields.shipmentDate')} hint={t('claims.shipmentDateHint')}>
          <DateInput value={form.shipment_date} onChange={setField('shipment_date')} />
        </Field>
        <Field label={t('claims.fields.dueDate')}>
          <DateInput value={form.due_date} min={form.invoice_date || undefined} onChange={setField('due_date')} />
        </Field>
        <Field label={t('claims.fields.amount')} className="sm:col-span-2">
          <AmountInput value={form.amount} onChange={setField('amount')} suffix={claim.currency_code} />
        </Field>
        <Field label={t('claims.fields.paidAmount')}>
          <AmountInput value={form.paid_amount} onChange={setField('paid_amount')} suffix={claim.currency_code} />
        </Field>
        <Field label={t('claims.fields.disputedAmount')} hint={t('claims.disputedHint')}>
          <AmountInput
            value={form.disputed_amount}
            onChange={setField('disputed_amount')}
            suffix={claim.currency_code}
          />
        </Field>
      </div>
    </Modal>
  )
}
