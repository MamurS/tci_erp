/** One claim: what is claimed, whether it is covered, what is owed, what has
 * been paid and what came back. The tabs follow the order an assessor works in.
 */

import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
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
  PageHeader,
  Spinner,
  Tabs,
} from '../../components/ui'
import type { TabDef } from '../../components/ui'
import { EM_DASH, formatAmount, formatMoment } from '../../lib/format'
import { CLAIM_STATUS_TONE } from './ClaimsPage'
import { ClaimDocumentsTab } from './ClaimDocumentsTab'
import { ClaimHistoryTab } from './ClaimHistoryTab'
import { ClaimIndemnityTab } from './ClaimIndemnityTab'
import { ClaimInvoicesTab } from './ClaimInvoicesTab'
import { ClaimMoneyTab } from './ClaimMoneyTab'
import { useApproveClaim, useChangeClaimStatus, useClaim, useClaimReadiness } from './api'
import { noaWarning } from './coverage'
import { claimErrorKey } from './errors'
import { offeredTransitions, requiresReason } from './machine'
import type { ClaimStatus } from './types'

const TAB_KEYS = ['overview', 'invoices', 'documents', 'indemnity', 'money', 'history'] as const
type TabKey = (typeof TAB_KEYS)[number]

export function ClaimDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { roles } = useAuth()
  const [params, setParams] = useSearchParams()
  const { data: claim, isLoading } = useClaim(id)
  const { data: readiness } = useClaimReadiness(id)
  const changeStatus = useChangeClaimStatus()
  const approve = useApproveClaim()
  const [pending, setPending] = useState<ClaimStatus | 'approve' | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const requested = params.get('tab') as TabKey | null
  const active: TabKey = requested && TAB_KEYS.includes(requested) ? requested : 'overview'

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!claim) return <EmptyState title={t('claims.notFound')} />

  const tabs: TabDef[] = TAB_KEYS.map((key) => ({ key, label: t(`claims.tabs.${key}`) }))
  const moves = offeredTransitions(roles, claim.status)
  const canApprove =
    (roles.includes('claims') || roles.includes('admin')) &&
    ['submitted', 'under_assessment', 'info_requested'].includes(claim.status)
  const warning = noaWarning(claim)
  const blockers = readiness?.blockers ?? []

  function run(promise: Promise<unknown>) {
    setError(null)
    promise
      .then(() => {
        setPending(null)
        setComment('')
      })
      .catch((e: unknown) => {
        const key = claimErrorKey(e)
        setError(key ? t(key) : t('common.somethingWentWrong'))
      })
  }

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={`${claim.claim_number} · ${claim.buyer_name}`}
        subtitle={`${claim.policy_number} · ${claim.policyholder_name}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={CLAIM_STATUS_TONE[claim.status]}>
              {t(`claims.statuses.${claim.status}`)}
            </Badge>
            {canApprove && (
              <Button onClick={() => setPending('approve')}>{t('claims.actions.approve')}</Button>
            )}
            {moves.map((to) => (
              <Button key={to} variant="secondary" onClick={() => setPending(to)}>
                {t(`claims.actions.${to}`)}
              </Button>
            ))}
          </div>
        }
      />

      {error && (
        <p role="alert" className="rounded-md bg-neg-50 px-3 py-2 text-[13px] text-neg-500">
          {error}
        </p>
      )}

      {warning && (
        <Card className="border-neg-500/40 bg-neg-50">
          <p className="text-sm font-semibold text-neg-500">
            {warning.key === 'late'
              ? t('claims.noaLateTitle', { days: warning.days })
              : t('claims.noaMissingTitle')}
          </p>
          <p className="mt-1 text-[13px] text-slate-700">
            {warning.key === 'late' ? t('claims.noaLateExplain') : t('claims.noaMissingExplain')}
          </p>
          {claim.overdue_notification_id && (
            <Link
              to={`/overdues/${claim.overdue_notification_id}`}
              className="mt-2 inline-block text-[13px] text-accent-600 hover:underline"
            >
              {t('claims.openNoa')}
            </Link>
          )}
        </Card>
      )}

      {claim.status === 'draft' && blockers.length > 0 && (
        <Card className="border-warn-500/40 bg-warn-50">
          <p className="text-sm font-semibold text-slate-800">{t('claims.blockersTitle')}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-slate-700">
            {blockers.map((b) => (
              <li key={b}>{t(b)}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <p className="text-xs text-slate-500">{t('claims.fields.claimed')}</p>
          <p className="num mt-1 text-xl font-semibold">
            {formatAmount(Number(claim.claimed_amount), locale)} {claim.currency_code}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">{t('claims.fields.indemnity')}</p>
          <p className="num mt-1 text-xl font-semibold">
            {claim.approved_indemnity === null
              ? EM_DASH
              : `${formatAmount(Number(claim.approved_indemnity), locale)} ${claim.currency_code}`}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">{t('claims.fields.cause')}</p>
          <p className="mt-1 text-sm font-semibold">
            {t(`claims.causes.${claim.cause_of_loss}`)}
          </p>
          {claim.insolvency_reference && (
            <p className="mt-1 text-xs text-slate-500">{claim.insolvency_reference}</p>
          )}
        </Card>
        <Card>
          <p className="text-xs text-slate-500">{t('claims.fields.age')}</p>
          <p className="num mt-1 text-xl font-semibold">
            {claim.assessment_age_days === null
              ? EM_DASH
              : Math.round(Number(claim.assessment_age_days))}
          </p>
          <p className="mt-1 text-xs text-slate-500">{t('claims.ageHint')}</p>
        </Card>
      </div>

      <Tabs tabs={tabs} active={active} onChange={(key) => setParams({ tab: key })} />

      {active === 'overview' && <OverviewTab claimId={claim.id} />}
      {active === 'invoices' && <ClaimInvoicesTab claim={claim} />}
      {active === 'documents' && <ClaimDocumentsTab claim={claim} />}
      {active === 'indemnity' && <ClaimIndemnityTab claim={claim} />}
      {active === 'money' && <ClaimMoneyTab claim={claim} />}
      {active === 'history' && <ClaimHistoryTab claimId={claim.id} />}

      <Modal
        open={pending !== null}
        title={
          pending === 'approve'
            ? t('claims.actions.approve')
            : pending
              ? t(`claims.actions.${pending}`)
              : ''
        }
        onClose={() => setPending(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={
                pending !== null &&
                pending !== 'approve' &&
                requiresReason(pending) &&
                comment.trim() === ''
              }
              onClick={() => {
                if (pending === 'approve') {
                  run(approve.mutateAsync({ id: claim.id, comment: comment || null }))
                } else if (pending) {
                  run(changeStatus.mutateAsync({ id: claim.id, to: pending, comment: comment || null }))
                }
              }}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-slate-600">
          {pending === 'approve' ? t('claims.approveHint') : t('claims.transitionHint')}
        </p>
        <Field label={t('claims.fields.comment')}>
          <Input value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        {pending !== null && pending !== 'approve' && requiresReason(pending) && (
          <p className="mt-1 text-xs text-slate-500">{t('claims.reasonRequiredHint')}</p>
        )}
      </Modal>
    </div>
  )
}

function OverviewTab({ claimId }: { claimId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: claim } = useClaim(claimId)
  if (!claim) return null
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <h2 className="text-sm font-semibold">{t('claims.overview.file')}</h2>
        <dl className="mt-3 space-y-2 text-[13px]">
          <Row label={t('claims.fields.filedAt')} value={claim.filed_at ? formatMoment(claim.filed_at, locale) : EM_DASH} />
          <Row label={t('claims.fields.assessedAt')} value={claim.assessed_at ? formatMoment(claim.assessed_at, locale) : EM_DASH} />
          <Row label={t('claims.fields.invoices')} value={String(claim.invoice_count)} />
          <Row
            label={t('claims.fields.eligibleFrom')}
            value={claim.eligible_from ?? t('claims.waitingPeriodWaived')}
          />
          <Row label={t('claims.fields.decisionReason')} value={claim.decision_reason ?? EM_DASH} />
        </dl>
      </Card>
      <Card>
        <h2 className="text-sm font-semibold">{t('claims.overview.terms')}</h2>
        <dl className="mt-3 space-y-2 text-[13px]">
          <Row label={t('claims.fields.insuredPercentage')} value={`${claim.insured_percentage}%`} />
          <Row
            label={t('claims.fields.nql')}
            value={`${formatAmount(Number(claim.nql_amount), locale)} ${claim.currency_code}`}
          />
          <Row
            label={t('claims.fields.deductible')}
            value={
              claim.deductible_each_loss === null
                ? EM_DASH
                : `${formatAmount(Number(claim.deductible_each_loss), locale)} ${claim.currency_code}`
            }
          />
          <Row
            label={t('claims.fields.aggregateFirstLoss')}
            value={
              claim.aggregate_first_loss === null
                ? EM_DASH
                : `${formatAmount(Number(claim.aggregate_first_loss), locale)} ${claim.currency_code}`
            }
          />
          <Row
            label={t('claims.fields.maxLiability')}
            value={
              claim.max_liability_amount === null
                ? EM_DASH
                : `${formatAmount(Number(claim.max_liability_amount), locale)} ${claim.currency_code}`
            }
          />
          <Row label={t('claims.fields.maxPaymentTerms')} value={String(claim.max_payment_terms_days)} />
          <Row label={t('claims.fields.waitingPeriod')} value={String(claim.waiting_period_days)} />
        </dl>
      </Card>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="num text-right font-medium text-slate-800">{value}</dd>
    </div>
  )
}
