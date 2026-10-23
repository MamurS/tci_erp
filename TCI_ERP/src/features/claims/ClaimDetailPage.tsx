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
  Callout,
  DescriptionList,
  DetailHeader,
  EmptyState,
  Field,
  KeyFigures,
  Modal,
  Panel,
  PanelGrid,
  Spinner,
  Tabs,
  Textarea,
  ActionsMenu,
} from '../../components/ui'
import type { MenuAction } from '../../components/ui'
import type { TabDef } from '../../components/ui'
import { EM_DASH, formatAmount, formatDate, formatMoment } from '../../lib/format'
import { CLAIM_STATUS_TONE } from './status'
import { ClaimDocumentsTab } from './ClaimDocumentsTab'
import { ClaimHistoryTab } from './ClaimHistoryTab'
import { GroupChip } from '../groups'
import { ClaimIndemnityTab } from './ClaimIndemnityTab'
import { ClaimInvoicesTab } from './ClaimInvoicesTab'
import { ClaimMoneyTab } from './ClaimMoneyTab'
import { useApproveClaim, useChangeClaimStatus, useClaim, useClaimReadiness } from './api'
import { noaWarning } from './coverage'
import { claimErrorKey } from './errors'
import { isDestructive, nextStep, offeredTransitions, requiresReason } from './machine'
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
    roles.includes('claims') &&
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

  // ONE primary — the step the file is waiting for — and everything else in
  // the «Действия» menu, the moves that end the file in its danger section.
  const step = nextStep(claim.status)
  const primary = step === 'approve' ? (canApprove ? step : null) : step && moves.includes(step) ? step : null
  const menu: MenuAction[] = [
    ...(canApprove && primary !== 'approve'
      ? [{ key: 'approve', label: t('claims.actions.approve'), onSelect: () => setPending('approve') }]
      : []),
    ...moves
      .filter((to) => to !== primary)
      .sort((a, b) => Number(isDestructive(a)) - Number(isDestructive(b)))
      .map((to) => ({
        key: to,
        label: t(`claims.actions.${to}`),
        danger: isDestructive(to),
        onSelect: () => setPending(to),
      })),
  ]
  const pendingDestructive = pending !== null && pending !== 'approve' && isDestructive(pending)
  const reasonMissing = pending !== null && pending !== 'approve' && requiresReason(pending) && comment.trim() === ''
  const money = (value: number | null) =>
    value === null ? EM_DASH : `${formatAmount(Number(value), locale)} ${claim.currency_code}`

  return (
    <div>
      <DetailHeader
        eyebrow={`${t('claims.eyebrow')} · ${claim.claim_number}`}
        title={claim.buyer_name}
        status={
          <>
            <Badge tone={CLAIM_STATUS_TONE[claim.status]}>{t(`claims.statuses.${claim.status}`)}</Badge>
          </>
        }
        meta={[
          <Link key="p" to={`/policies/${claim.policy_id}`} className="text-accent-600 hover:underline">
            {claim.policy_number}
          </Link>,
          <Link
            key="h"
            to={`/entities/${claim.policyholder_entity_id}`}
            className="text-accent-600 hover:underline"
          >
            {claim.policyholder_name}
          </Link>,
          // An open claim on a sister company is exactly the thing a group
          // view exists to surface, so the group is named where it is judged.
          <GroupChip key="g" compact entityId={claim.buyer_entity_id} />,
        ]}
        actions={
          primary || menu.length > 0 ? (
            <>
              {primary && (
                <Button onClick={() => setPending(primary)} loading={changeStatus.isPending && changeStatus.variables?.to === primary}>
                  {t(`claims.actions.${primary}`)}
                </Button>
              )}
              <ActionsMenu actions={menu} />
            </>
          ) : undefined
        }
      />

      <div className="space-y-3 empty:hidden [&:not(:empty)]:mb-6">
        {/* While a dialog is open its failure is shown inside it. */}
        {error && pending === null && <Callout tone="neg" title={error} />}

        {warning && (
          <Callout
            tone="neg"
            title={
              warning.key === 'late'
                ? t('claims.noaLateTitle', { days: warning.days })
                : t('claims.noaMissingTitle')
            }
            action={
              claim.overdue_notification_id && (
                <Link
                  to={`/overdues/${claim.overdue_notification_id}`}
                  className="font-medium text-accent-600 hover:underline"
                >
                  {t('claims.openNoa')}
                </Link>
              )
            }
          >
            {warning.key === 'late' ? t('claims.noaLateExplain') : t('claims.noaMissingExplain')}
          </Callout>
        )}

        {claim.status === 'draft' && blockers.length > 0 && (
          <Callout tone="warn" title={t('claims.blockersTitle')}>
            <ul className="list-disc space-y-0.5 pl-5">
              {blockers.map((b) => (
                <li key={b}>{t(b)}</li>
              ))}
            </ul>
          </Callout>
        )}
      </div>

      <KeyFigures
        items={[
          { label: t('claims.fields.claimed'), value: money(claim.claimed_amount) },
          {
            label: t('claims.fields.indemnity'),
            value: claim.approved_indemnity === null ? t('claims.indemnityPending') : money(claim.approved_indemnity),
            tone: claim.approved_indemnity === null ? 'muted' : 'default',
          },
          {
            label: t('claims.fields.ageColumn'),
            value:
              claim.assessment_age_days === null
                ? EM_DASH
                : t('policies.terms.days', { count: Math.round(Number(claim.assessment_age_days)) }),
            meta: t('claims.ageHint'),
          },
        ]}
      />

      <div className="mb-5">
        <Tabs tabs={tabs} active={active} onChange={(key) => setParams({ tab: key })} />
      </div>

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
        onClose={() => {
          setPending(null)
          setError(null)
        }}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setPending(null)
                setError(null)
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant={pendingDestructive ? 'danger' : 'primary'}
              disabled={reasonMissing}
              loading={approve.isPending || changeStatus.isPending}
              title={reasonMissing ? t('claims.reasonRequiredHint') : undefined}
              onClick={() => {
                if (pending === 'approve') {
                  // The indemnity is the database's computation: the dialog
                  // stays, working, until it answers.
                  run(approve.mutateAsync({ id: claim.id, comment: comment || null }))
                } else if (pending) {
                  // The status paints at once (optimistic), so the dialog
                  // closes at once; a refusal reopens it with its message.
                  const to = pending
                  setPending(null)
                  run(
                    changeStatus.mutateAsync({ id: claim.id, to, comment: comment || null }).catch((e: unknown) => {
                      setPending(to)
                      throw e
                    }),
                  )
                }
              }}
            >
              {pending ? t(`claims.actions.${pending}`) : t('common.confirm')}
            </Button>
          </>
        }
      >
        {error && <Callout tone="neg" title={error} />}
        <p className="text-[13px] leading-relaxed text-slate-600">
          {pending === 'approve' ? t('claims.approveHint') : t('claims.transitionHint')}
        </p>
        <Field
          label={t('claims.fields.comment')}
          hint={pending !== null && pending !== 'approve' && requiresReason(pending) ? t('claims.reasonRequiredHint') : undefined}
        >
          <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
      </Modal>
    </div>
  )
}

function OverviewTab({ claimId }: { claimId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: claim } = useClaim(claimId)
  if (!claim) return null
  const money = (value: number | null) =>
    value === null ? EM_DASH : `${formatAmount(Number(value), locale)} ${claim.currency_code}`
  const days = (value: number) => t('policies.terms.days', { count: value })
  return (
    <PanelGrid>
      <Panel title={t('claims.overview.file')}>
        <DescriptionList
          items={[
            // A word, not a figure: it belongs with the file's facts, not in
            // the key-figure strip where it read as a headline link.
            {
              label: t('claims.fields.cause'),
              value: (
                <>
                  {t(`claims.causes.${claim.cause_of_loss}`)}
                  {claim.insolvency_reference && (
                    <span className="block text-[12px] font-normal text-slate-500">{claim.insolvency_reference}</span>
                  )}
                </>
              ),
            },
            { label: t('claims.fields.filedAt'), value: claim.filed_at ? formatMoment(claim.filed_at, locale) : EM_DASH },
            {
              label: t('claims.fields.eligibleFrom'),
              value: claim.eligible_from ? formatDate(claim.eligible_from, locale) : t('claims.waitingPeriodWaived'),
            },
            { label: t('claims.fields.invoices'), value: formatAmount(claim.invoice_count, locale, 0) },
            {
              label: t('claims.fields.assessedAt'),
              value: claim.assessed_at ? formatMoment(claim.assessed_at, locale) : EM_DASH,
            },
            { label: t('claims.fields.decisionReason'), value: claim.decision_reason ?? EM_DASH },
          ]}
        />
      </Panel>
      <Panel title={t('claims.overview.terms')}>
        <DescriptionList
          items={[
            { label: t('claims.fields.insuredPercentage'), value: `${claim.insured_percentage}%` },
            { label: t('claims.fields.nql'), value: money(claim.nql_amount) },
            { label: t('claims.fields.deductible'), value: money(claim.deductible_each_loss) },
            { label: t('claims.fields.aggregateFirstLoss'), value: money(claim.aggregate_first_loss) },
            { label: t('claims.fields.maxLiability'), value: money(claim.max_liability_amount) },
            { label: t('claims.fields.maxPaymentTermsShort'), value: days(claim.max_payment_terms_days) },
            { label: t('claims.fields.waitingPeriodShort'), value: days(claim.waiting_period_days) },
          ]}
        />
      </Panel>
    </PanelGrid>
  )
}
