/**
 * Policy page: header with status transitions (driven by the SQL status
 * machine, mirrored in statusMachine.ts), grouped terms card per DESIGN.md
 * financial display rules, Phase 2b placeholder for buyers & limits, and
 * the compact status history timeline.
 */

import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  Spinner,
  Tabs,
} from '../../components/ui'
import type { TabDef } from '../../components/ui'
import { EM_DASH, formatAmount, formatPercent } from '../../lib/format'
import { PolicyLimitsSection } from '../limits/PolicyLimitsSection'
import { usePolicyOriginRequest } from '../requests/api'
import { PolicyPremiumTab } from './PolicyPremiumTab'
import { useChangePolicyStatus, usePolicy, usePolicyStatusHistory } from './api'
import {
  allowedTargets,
  commentMandatory,
  isExpiryDue,
  requiresComment,
  statusTone,
} from './statusMachine'
import type { PolicyStatus, PolicyWithRefs } from './types'

export function PolicyDetailPage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const { data: policy, isLoading } = usePolicy(id)

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!policy) {
    return (
      <EmptyState
        title={t('policies.notFound')}
        action={
          <Link to="/policies" className="text-sm font-medium text-accent-700 hover:underline">
            {t('policies.backToList')}
          </Link>
        }
      />
    )
  }

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-3">
            <span>{policy.policy_number}</span>
            <Badge tone={statusTone(policy.status)} size="lg">
              {t(`policies.statuses.${policy.status}`)}
            </Badge>
          </span>
        }
        subtitle={
          <span>
            <Link to="/policies" className="text-accent-700 hover:underline">
              {t('nav.policies')}
            </Link>
            {' / '}
            <Link
              to={`/entities/${policy.entity_id}`}
              className="text-accent-700 hover:underline"
            >
              {policy.legal_entities?.name ?? EM_DASH}
            </Link>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void navigate(`/policies/${id}/edit`)}>
              {t('common.edit')}
            </Button>
            <StatusActions policy={policy} />
          </div>
        }
      />

      <PolicyOrigin policyId={id} />

      {isExpiryDue(policy, new Date().toISOString().slice(0, 10)) && (
        <div className="mb-4 rounded-md border border-warn-500/30 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500">
          {t('policies.expiryDueHint', { date: policy.expiry_date })}
        </div>
      )}

      <PolicyBody policy={policy} policyId={id} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Terms and premium are two different readings of the same policy, and the
// premium one is long enough to deserve its own surface. The Agenda deep-links
// straight to it (?tab=premium) because an instalment has no page of its own.
// ---------------------------------------------------------------------------

function PolicyBody({ policy, policyId }: { policy: PolicyWithRefs; policyId: string }) {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const active = params.get('tab') === 'premium' ? 'premium' : 'terms'

  const tabs: TabDef[] = [
    { key: 'terms', label: t('policies.tabs.terms') },
    { key: 'premium', label: t('policies.tabs.premium') },
  ]

  return (
    <>
      <div className="mb-4">
        <Tabs
          tabs={tabs}
          active={active}
          onChange={(id) => {
            const next = new URLSearchParams(params)
            if (id === 'premium') next.set('tab', 'premium')
            else next.delete('tab')
            setParams(next, { replace: true })
          }}
        />
      </div>

      {active === 'premium' ? (
        <PolicyPremiumTab policyId={policyId} />
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-5">
            <TermsCard policy={policy} />

            <PolicyLimitsSection policy={policy} />
          </div>

          <HistoryTimeline policyId={policyId} />
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Provenance: a policy issued by tci.bind_insurance_request names its
// submission, so the agreed terms stay one click away. Silent for a policy
// captured by hand — there is nothing to point at.
// ---------------------------------------------------------------------------

function PolicyOrigin({ policyId }: { policyId: string }) {
  const { t } = useTranslation()
  const { data: origin } = usePolicyOriginRequest(policyId)
  if (!origin) return null
  return (
    <p className="mb-4 text-[13px] text-slate-500">
      {t('policies.createdFromRequest')}{' '}
      <Link to={`/requests/${origin.id}`} className="num text-accent-700 hover:underline">
        {origin.request_number}
      </Link>
    </p>
  )
}

// ---------------------------------------------------------------------------
// Status transition actions + confirmation modal
// ---------------------------------------------------------------------------

function StatusActions({ policy }: { policy: PolicyWithRefs }) {
  const { t } = useTranslation()
  const changeStatus = useChangePolicyStatus(policy.id)
  const [pending, setPending] = useState<PolicyStatus | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const targets = allowedTargets(policy.status)
  if (!targets.length) return null

  const run = async (to: PolicyStatus, withComment: string) => {
    setError(null)
    try {
      await changeStatus.mutateAsync({ to, comment: withComment.trim() || undefined })
      setPending(null)
      setComment('')
    } catch {
      setError(t('policies.transitionFailed'))
    }
  }

  return (
    <>
      {targets.map((to) => (
        <Button
          key={to}
          variant={
            to === 'cancelled' || to === 'annulled'
              ? 'danger'
              : to === 'active'
                ? 'primary'
                : 'secondary'
          }
          onClick={() => {
            setComment('')
            setError(null)
            if (requiresComment(to)) setPending(to)
            else void run(to, '')
          }}
          disabled={changeStatus.isPending}
        >
          {t(`policies.transitions.${to}`)}
        </Button>
      ))}
      {error && !pending && (
        <span className="text-[13px] text-neg-500" role="alert">
          {error}
        </span>
      )}

      {pending && (
        <Modal
          open
          onClose={() => setPending(null)}
          title={t(`policies.transitions.${pending}`)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPending(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant={pending === 'cancelled' || pending === 'annulled' ? 'danger' : 'primary'}
                onClick={() => void run(pending, comment)}
                disabled={changeStatus.isPending || (commentMandatory(pending) && !comment.trim())}
              >
                {changeStatus.isPending ? t('common.saving') : t('common.confirm')}
              </Button>
            </>
          }
        >
          <p className="mb-3 text-sm text-slate-600">
            {t(`policies.transitionConfirm.${pending}`, { number: policy.policy_number })}
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-[13px] font-medium text-slate-600">
              {t('policies.transitionComment')}
              {commentMandatory(pending) && <span className="text-neg-500"> *</span>}
            </span>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:outline-2 focus:outline-accent-600"
            />
          </label>
          {error && (
            <p className="mt-2 text-[13px] text-neg-500" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Terms card (Cover | Premium | Operation), dense per DESIGN.md
// ---------------------------------------------------------------------------

function TermsCard({ policy }: { policy: PolicyWithRefs }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const ccy = policy.currency_code

  const amount = (v: number | null): React.ReactNode =>
    v === null ? (
      <span className="text-slate-400">{EM_DASH}</span>
    ) : (
      <span className="num">{formatAmount(Number(v), locale)} {ccy}</span>
    )

  const maxLiability = [
    policy.max_liability_amount !== null
      ? `${formatAmount(Number(policy.max_liability_amount), locale)} ${ccy}`
      : null,
    policy.max_liability_premium_multiple !== null
      ? t('policies.terms.premiumMultiple', {
          value: formatAmount(Number(policy.max_liability_premium_multiple), locale, 1),
        })
      : null,
  ]
    .filter(Boolean)
    .join(' / ')

  const groups: { titleKey: string; rows: { labelKey: string; value: React.ReactNode }[] }[] = [
    {
      titleKey: 'policies.termGroups.cover',
      rows: [
        {
          labelKey: 'policies.terms.insuredPercentage',
          value: (
            <span className="num">
              {formatPercent(Number(policy.insured_percentage) / 100, locale)}
            </span>
          ),
        },
        {
          labelKey: 'policies.terms.maxLiability',
          value: maxLiability || <span className="text-slate-400">{EM_DASH}</span>,
        },
        { labelKey: 'policies.terms.nql', value: amount(policy.nql_amount) },
        {
          labelKey: 'policies.terms.deductibleEachLoss',
          value: amount(policy.deductible_each_loss),
        },
        {
          labelKey: 'policies.terms.aggregateFirstLoss',
          value: amount(policy.aggregate_first_loss),
        },
      ],
    },
    {
      titleKey: 'policies.termGroups.premium',
      rows: [
        {
          labelKey: 'policies.terms.premiumRate',
          value: (
            <span className="num">
              {formatPercent(Number(policy.premium_rate_pct) / 100, locale, 3)}
            </span>
          ),
        },
        { labelKey: 'policies.terms.minimumPremium', value: amount(policy.minimum_premium) },
        {
          labelKey: 'policies.terms.estimatedTurnover',
          value: amount(policy.estimated_annual_turnover),
        },
      ],
    },
    {
      titleKey: 'policies.termGroups.operation',
      rows: [
        {
          labelKey: 'policies.terms.discretionaryLimit',
          value: amount(policy.discretionary_limit),
        },
        {
          labelKey: 'policies.terms.waitingPeriod',
          value: <span className="num">{t('policies.terms.days', { count: policy.waiting_period_days })}</span>,
        },
        {
          labelKey: 'policies.terms.maxExtensionPeriod',
          value: <span className="num">{t('policies.terms.days', { count: policy.max_extension_period_days })}</span>,
        },
        {
          labelKey: 'policies.terms.maxPaymentTerms',
          value: <span className="num">{t('policies.terms.days', { count: policy.max_payment_terms_days })}</span>,
        },
        {
          labelKey: 'policies.terms.declarationFrequency',
          value: t(`policies.frequencies.${policy.declaration_frequency}`),
        },
      ],
    },
  ]

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{t('policies.termsTitle')}</h2>
        <span className="text-[13px] text-slate-500">
          {t(`policies.structures.${policy.product_structure}`)} · {policy.inception_date} —{' '}
          {policy.expiry_date}
        </span>
      </div>
      <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
        {groups.map((group) => (
          <div key={group.titleKey}>
            <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
              {t(group.titleKey)}
            </h3>
            <dl className="flex flex-col text-[13px]">
              {group.rows.map((row) => (
                <div
                  key={row.labelKey}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-slate-100 py-1 last:border-b-0"
                >
                  <dt className="text-slate-500">{t(row.labelKey)}</dt>
                  <dd className="ml-auto text-right font-medium text-slate-800">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      {policy.notes && (
        <p className="mt-4 border-t border-slate-100 pt-3 text-[13px] text-slate-500">
          {policy.notes}
        </p>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Status history timeline (compact)
// ---------------------------------------------------------------------------

function HistoryTimeline({ policyId }: { policyId: string }) {
  const { t } = useTranslation()
  const { data: history } = usePolicyStatusHistory(policyId)

  return (
    <Card className="p-5">
      <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('policies.historyTitle')}</h2>
      {!history?.length ? (
        <p className="text-[13px] text-slate-500">{t('policies.historyEmpty')}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {history.map((row) => (
            <li key={row.id} className="flex gap-3">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent-500" aria-hidden />
              <div className="min-w-0">
                <p className="text-[13px] text-slate-800">
                  {t(`policies.statuses.${row.from_status}`)}
                  <span aria-hidden className="mx-1 text-slate-400">→</span>
                  <Badge tone={statusTone(row.to_status)}>
                    {t(`policies.statuses.${row.to_status}`)}
                  </Badge>
                </p>
                <p className="text-xs text-slate-400">
                  {row.changed_at.slice(0, 16).replace('T', ' ')}
                </p>
                {row.comment && <p className="mt-0.5 text-[13px] text-slate-500">{row.comment}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}
