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
  Callout,
  Card,
  DetailHeader,
  EmptyState,
  Field,
  LinkButton,
  Modal,
  SectionTitle,
  Spinner,
  Tabs,
  Textarea,
  ActionsMenu,
} from '../../components/ui'
import type { MenuAction } from '../../components/ui'
import type { TabDef } from '../../components/ui'
import { ClaimsSection } from '../claims'
import { EM_DASH, formatAmount, formatMoment, formatPercent, formatRate, formatDate } from '../../lib/format'
import { PolicyLimitsSection } from '../limits/PolicyLimitsSection'
import { usePolicyOriginRequest } from '../requests/api'
import { DraftContractSection } from '../wording'
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
  const { t, i18n } = useTranslation()
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const { data: policy, isLoading } = usePolicy(id)

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!policy) {
    return (
      <EmptyState
        title={t('policies.notFound')}
        action={
          <LinkButton to="/policies?view=registry" variant="secondary">
            {t('policies.backToList')}
          </LinkButton>
        }
      />
    )
  }

  return (
    <div>
      <DetailHeader
        eyebrow={t('policies.eyebrow')}
        title={policy.policy_number}
        status={
          <Badge tone={statusTone(policy.status)}>{t(`policies.statuses.${policy.status}`)}</Badge>
        }
        meta={[
          <Link key="h" to={`/entities/${policy.entity_id}`} className="text-accent-600 hover:underline">
            {policy.legal_entities?.name ?? EM_DASH}
          </Link>,
          t(`policies.structures.${policy.product_structure}`),
          `${formatDate(policy.inception_date, i18n.language)} — ${formatDate(policy.expiry_date, i18n.language)}`,
        ]}
        actions={<StatusActions policy={policy} onEdit={() => void navigate(`/policies/${id}/edit`)} />}
      />

      <PolicyOrigin policyId={id} />

      {isExpiryDue(policy, new Date().toISOString().slice(0, 10)) && (
        <Callout
          tone="warn"
          className="mb-5"
          title={t('policies.expiryDueHint', { date: formatDate(policy.expiry_date, i18n.language) })}
        />
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
  const requested = params.get('tab')
  const active =
    requested === 'premium' || requested === 'claims' || requested === 'contract' ? requested : 'terms'

  const tabs: TabDef[] = [
    { key: 'terms', label: t('policies.tabs.terms') },
    { key: 'premium', label: t('policies.tabs.premium') },
    { key: 'claims', label: t('policies.tabs.claims') },
    { key: 'contract', label: t('policies.tabs.contract') },
  ]

  return (
    <>
      <div className="mb-4">
        <Tabs
          tabs={tabs}
          active={active}
          onChange={(id) => {
            const next = new URLSearchParams(params)
            if (id === 'premium' || id === 'claims' || id === 'contract') next.set('tab', id)
            else next.delete('tab')
            setParams(next, { replace: true })
          }}
        />
      </div>

      {active === 'contract' ? (
        <DraftContractSection
          target={{ policyId }}
          reference={policy.policy_number}
          countryCode={policy.legal_entities?.country_code ?? null}
          product={policy.product_structure}
        />
      ) : active === 'claims' ? (
        <ClaimsSection policyId={policyId} />
      ) : active === 'premium' ? (
        <PolicyPremiumTab policyId={policyId} />
      ) : (
        // The terms with their history beside them; the buyers and limits
        // below at the full width — a table of seven columns squeezed into
        // two thirds broke every name over four lines.
        <div className="flex flex-col gap-6">
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <TermsCard policy={policy} />
            <HistoryTimeline policyId={policyId} />
          </div>
          <PolicyLimitsSection policy={policy} />
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

function StatusActions({ policy, onEdit }: { policy: PolicyWithRefs; onEdit: () => void }) {
  const { t } = useTranslation()
  const changeStatus = useChangePolicyStatus(policy.id)
  const [pending, setPending] = useState<PolicyStatus | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const targets = allowedTargets(policy.status)

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

  const start = (to: PolicyStatus) => {
    setComment('')
    setError(null)
    if (requiresComment(to)) setPending(to)
    else void run(to, '')
  }

  // In the header: the edit and the NEXT STEP only — activating a draft or
  // resuming a suspended policy, or marking it expired once its date has
  // passed. Every other move is in «Действия ▾», the destructive ones
  // (cancel, annul) in its red section, each confirmed in a modal.
  const destructive = (to: PolicyStatus) => to === 'cancelled' || to === 'annulled'
  const today = new Date().toISOString().slice(0, 10)
  const next: PolicyStatus | null = targets.includes('active')
    ? 'active'
    : targets.includes('expired') && isExpiryDue(policy, today)
      ? 'expired'
      : null
  const menu: MenuAction[] = targets
    .filter((to) => to !== next)
    .sort((a, b) => Number(destructive(a)) - Number(destructive(b)))
    .map((to) => ({
      key: to,
      label: t(`policies.transitions.${to}`),
      danger: destructive(to),
      onSelect: () => start(to),
    }))

  return (
    <>
      {next && (
        <Button onClick={() => start(next)} disabled={changeStatus.isPending}>
          {t(`policies.transitions.${next}`)}
        </Button>
      )}
      <Button variant="secondary" onClick={onEdit}>
        {t('common.edit')}
      </Button>
      <ActionsMenu actions={menu} disabled={changeStatus.isPending} />
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
                variant={destructive(pending) ? 'danger' : 'primary'}
                onClick={() => void run(pending, comment)}
                disabled={changeStatus.isPending || (commentMandatory(pending) && !comment.trim())}
                title={
                  commentMandatory(pending) && !comment.trim() ? t('policies.commentRequired') : undefined
                }
              >
                {changeStatus.isPending ? t('common.saving') : t(`policies.transitions.${pending}`)}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-600">
            {t(`policies.transitionConfirm.${pending}`, { number: policy.policy_number })}
          </p>
          <Field
            label={`${t('policies.transitionComment')}${commentMandatory(pending) ? ' *' : ''}`}
            hint={commentMandatory(pending) ? t('policies.commentRequired') : undefined}
          >
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
          </Field>
          {error && (
            <p className="text-[13px] text-neg-500" role="alert">
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

  // One basis is stated (the form saves the other as NULL); a policy that
  // still carries both from before shows both, rather than hide a term.
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
              {formatRate(policy.premium_rate_pct, locale)}
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
      <SectionTitle className="mb-4">{t('policies.termsTitle')}</SectionTitle>
      <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
        {groups.map((group) => (
          <div key={group.titleKey}>
            <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
              {t(group.titleKey)}
            </h3>
            <dl className="flex flex-col text-[13px]">
              {group.rows.map((row) => (
                // A long label wraps in its own column; the value stays on one
                // line at the right, never pushed under the label.
                <div
                  key={row.labelKey}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 border-b border-slate-100 py-1.5 last:border-b-0"
                >
                  <dt className="text-slate-500">{t(row.labelKey)}</dt>
                  <dd className="text-right font-medium whitespace-nowrap text-slate-800">{row.value}</dd>
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
  const { t, i18n } = useTranslation()
  const { data: history } = usePolicyStatusHistory(policyId)

  return (
    <Card className="p-5">
      <SectionTitle className="mb-3">{t('policies.historyTitle')}</SectionTitle>
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
                  {formatMoment(row.changed_at, i18n.language)}
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
