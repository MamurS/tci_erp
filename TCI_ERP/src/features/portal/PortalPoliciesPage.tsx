/** «Мои полисы» — the portal's home: the cover the policyholder actually has,
 * its terms in full, and where to go next. Read-only by construction: there
 * is no write path for a policy in the portal at all.
 *
 * The terms are shown, not hidden behind a toggle: they are what the client
 * signed, and on the home page they ARE the content. */

import { ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Callout,
  Card,
  DescriptionList,
  EmptyState,
  KeyFigures,
  HeroBand,
  KpiCard,
  SectionTitle,
  Spinner,
  StatusTimeline,
} from '../../components/ui'
import type { Fact } from '../../components/ui'
import { EM_DASH, formatAmount, formatDate, formatPercent, formatRate } from '../../lib/format'
import { useMyClaims, useMyEntity, useMyLimitRequests, useMyLimits, useMyPolicies, useMySubmissions } from './api'
import { TIMELINE_STEPS, timelineStep, waitsOnYou } from './timelines'
import type { TimelineKind } from './timelines'
import type { ClientPolicy } from './types'

/** Where a client goes from home, in the order the work arises. Each path is
 * one of PORTAL_NAV_ITEMS; nothing here is a figure, so nothing can be stale. */
const NEXT_STEPS = [
  { key: 'limits', path: '/portal/limits' },
  { key: 'declarations', path: '/portal/declarations' },
  { key: 'overdues', path: '/portal/overdues' },
  { key: 'claims', path: '/portal/claims' },
] as const

const STATUS_TONE: Record<string, 'pos' | 'warn' | 'neg'> = {
  active: 'pos',
  suspended: 'warn',
  cancelled: 'neg',
  annulled: 'neg',
}

export function PortalPoliciesPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: policies, isLoading, isError } = useMyPolicies()
  const { data: entity } = useMyEntity()
  const { data: limits } = useMyLimits()

  if (isLoading) return <Spinner label={t('common.loading')} />

  const activePolicies = (policies ?? []).filter((p) => p.status === 'active')
  const hasActive = activePolicies.length > 0
  const nextExpiry = activePolicies.map((p) => p.expiry_date).sort()[0] ?? null
  // A limit the policyholder holds: released, approved in full or in part.
  const limitsInForce = (limits ?? []).filter(
    (l) => l.outcome === 'approved' || l.outcome === 'partial',
  ).length

  return (
    <div>
      <HeroBand
        bleed="portal"
        eyebrow={t('portal.policies.title')}
        title={entity?.name ?? t('portal.policies.title')}
        subtitle={t('portal.policies.subtitle')}
      >
        <KpiCard
          tone="inverse"
          label={t('portal.hero.inForce')}
          value={formatAmount(activePolicies.length, locale)}
          meta={t('portal.hero.inForceMeta', { count: (policies ?? []).length })}
        />
        <KpiCard
          tone="inverse"
          to="/portal/limits"
          label={t('portal.hero.limits')}
          value={limits ? formatAmount(limitsInForce, locale) : EM_DASH}
          meta={t('portal.hero.limitsMeta')}
        />
        <KpiCard
          tone="inverse"
          label={t('portal.hero.nextExpiry')}
          value={nextExpiry ? formatDate(nextExpiry, locale) : EM_DASH}
          meta={nextExpiry ? t('portal.hero.nextExpiryMeta') : t('portal.hero.noActive')}
        />
      </HeroBand>

      {isError && <Callout tone="neg" title={t('portal.loadFailed')} className="mb-6" />}

      <InProgress />

      {!policies?.length ? (
        !isError && (
          <EmptyState title={t('portal.policies.empty')} hint={t('portal.policies.emptyHint')} />
        )
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="flex min-w-0 flex-col gap-8">
            {policies.map((policy) => (
              <PolicyOverview key={policy.id} policy={policy} />
            ))}
          </div>
          {/* The four things a policyholder does, all of which need a policy
              in force — so the panel waits for one. */}
          {hasActive && <NextSteps />}
        </div>
      )}
    </div>
  )
}

function PolicyOverview({ policy }: { policy: ClientPolicy }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const ccy = policy.currency_code
  const money = (v: number | null) => (v === null ? EM_DASH : `${formatAmount(v, locale)} ${ccy}`)
  const days = (v: number | null) =>
    v === null ? EM_DASH : t('portal.days', { count: v, value: v })

  const maxLiability =
    policy.max_liability_amount !== null
      ? money(policy.max_liability_amount)
      : policy.max_liability_premium_multiple !== null
        ? t('portal.policies.premiumMultiple', {
            value: formatAmount(policy.max_liability_premium_multiple, locale, 1),
          })
        : EM_DASH

  const term = (key: string, value: string): Fact => ({ label: t(`requests.terms.${key}`), value })

  const terms: Fact[] = [
    term(
      'product_structure',
      policy.product_structure ? t(`policies.structures.${policy.product_structure}`) : EM_DASH,
    ),
    term('currency_code', ccy),
    term('premium_rate_pct', formatRate(policy.premium_rate_pct, locale)),
    term('minimum_premium', money(policy.minimum_premium)),
    term('nql_amount', money(policy.nql_amount)),
    term('deductible_each_loss', money(policy.deductible_each_loss)),
    term('aggregate_first_loss', money(policy.aggregate_first_loss)),
    term('waiting_period_days', days(policy.waiting_period_days)),
    term('max_extension_period_days', days(policy.max_extension_period_days)),
    term('max_payment_terms_days', days(policy.max_payment_terms_days)),
    term(
      'declaration_frequency',
      policy.declaration_frequency
        ? t(`policies.frequencies.${policy.declaration_frequency}`)
        : EM_DASH,
    ),
  ]

  return (
    <section>
      <SectionTitle
        className="mb-3"
        actions={
          <Badge tone={STATUS_TONE[policy.status] ?? 'neutral'}>
            {t(`policies.statuses.${policy.status}`)}
          </Badge>
        }
      >
        {policy.policy_number}
      </SectionTitle>
      <KeyFigures
        className="mb-4"
        items={[
          {
            label: t('portal.policies.period'),
            // Each date stays whole; a narrow cell breaks after the dash.
            value: (
              <>
                <span className="whitespace-nowrap">
                  {formatDate(policy.inception_date, locale)} —
                </span>{' '}
                <span className="whitespace-nowrap">{formatDate(policy.expiry_date, locale)}</span>
              </>
            ),
            text: true,
          },
          {
            label: t('requests.terms.insured_percentage'),
            value:
              policy.insured_percentage === null
                ? EM_DASH
                : formatPercent(
                    policy.insured_percentage / 100,
                    locale,
                    Number.isInteger(Number(policy.insured_percentage)) ? 0 : 1,
                  ),
          },
          {
            label: t('requests.terms.discretionary_limit'),
            value: money(policy.discretionary_limit),
          },
          { label: t('requests.terms.max_liability_amount'), value: maxLiability },
        ]}
      />
      <Card className="p-5">
        <SectionTitle className="mb-3">{t('portal.policies.terms')}</SectionTitle>
        {/* Two lists rather than columns={2}: each column then starts on the
            same line (the primitive trims only the first row of the whole
            list, so its second column sat lower). */}
        <div className="grid gap-x-10 md:grid-cols-2">
          <DescriptionList items={terms.slice(0, Math.ceil(terms.length / 2))} />
          <div className="border-t border-slate-100 pt-3 md:border-t-0 md:pt-0">
            <DescriptionList items={terms.slice(Math.ceil(terms.length / 2))} />
          </div>
        </div>
      </Card>
    </section>
  )
}

function NextSteps() {
  const { t } = useTranslation()
  // The title sits above the card, as each policy's number does on the left,
  // so the two columns' cards start on one line.
  return (
    <section>
      <SectionTitle className="mb-3">{t('portal.policies.next.title')}</SectionTitle>
      <Card className="px-5 py-3">
        <ul className="-mx-2 flex flex-col">
          {NEXT_STEPS.map((step) => (
            <li key={step.key}>
              <Link
                to={step.path}
                className="group flex items-center gap-3 rounded-md px-2 py-3 hover:bg-accent-50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-semibold text-accent-700">
                    {t(`portal.policies.next.${step.key}.title`)}
                  </span>
                  <span className="block text-small leading-snug text-slate-500">
                    {t(`portal.policies.next.${step.key}.hint`)}
                  </span>
                </span>
                <ChevronRight
                  className="size-4 shrink-0 text-slate-400 group-hover:text-accent-500"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  )
}

interface Followed {
  id: string
  kind: TimelineKind
  title: string
  sub: string
  status: string
  to: string
}

/** What the policyholder is waiting on, each with a simple status timeline
 * (Prompt 30): open limit requests, submissions and offers, and claims. Shown
 * only when something is open; what waits on THEM is marked and listed first. */
function InProgress() {
  const { t } = useTranslation()
  const { data: requests } = useMyLimitRequests()
  const { data: submissions } = useMySubmissions()
  const { data: claims } = useMyClaims()
  const items: Followed[] = [
    ...(submissions ?? []).map((s) => ({
      id: `s-${s.id}`,
      kind: 'submission' as const,
      title: s.request_number,
      sub: t('portal.timeline.kinds.submission'),
      status: s.status,
      to: '/portal/submissions',
    })),
    ...(requests ?? []).map((r) => ({
      id: `l-${r.id}`,
      kind: 'limit' as const,
      title: r.buyer_name ?? r.proposed_name ?? EM_DASH,
      sub: t('portal.timeline.kinds.limit', { policy: r.policy_number }),
      status: r.status,
      to: '/portal/limits',
    })),
    ...(claims ?? []).map((c) => ({
      id: `c-${c.id}`,
      kind: 'claim' as const,
      title: c.buyer_name,
      sub: t('portal.timeline.kinds.claim', { number: c.claim_number }),
      status: c.status,
      to: '/portal/claims',
    })),
  ]
    .filter((item) => timelineStep(item.kind, item.status) !== null)
    .sort((a, b) => Number(waitsOnYou(b.kind, b.status)) - Number(waitsOnYou(a.kind, a.status)))
  if (items.length === 0) return null
  return (
    <Card className="mb-8 p-6">
      <SectionTitle className="mb-4">{t('portal.timeline.title')}</SectionTitle>
      <ul className="flex flex-col divide-y divide-slate-100">
        {items.map((item) => {
          const step = timelineStep(item.kind, item.status) ?? 0
          const mine = waitsOnYou(item.kind, item.status)
          return (
            <li
              key={item.id}
              className="grid items-center gap-x-8 gap-y-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <p className="truncate text-body font-semibold text-slate-900">{item.title}</p>
                <p className="truncate text-small text-slate-500">{item.sub}</p>
                {mine && (
                  <Badge tone="warn" size="sm">
                    {t('portal.timeline.yourTurn')}
                  </Badge>
                )}
              </div>
              <StatusTimeline
                label={t(`portal.timeline.kinds.${item.kind}Label`)}
                steps={TIMELINE_STEPS[item.kind].map((key) => t(`portal.timeline.${item.kind}.${key}`))}
                current={step}
                attention={mine}
              />
              <Link
                to={item.to}
                className="inline-flex items-center gap-1 text-small font-semibold text-accent-700 hover:underline"
              >
                {t('portal.timeline.open')}
                <ChevronRight className="size-4" />
              </Link>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
