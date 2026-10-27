/**
 * The buyer behind a limit task, as the limit request page shows it — grade
 * and score, where it sits, its other limits in force and its group — with
 * the strengths and weaknesses of its latest rating beside it, and the open
 * overdue notifications that should stop anyone raising a limit in passing.
 */

import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Callout, Skeleton } from '../../../components/ui'
import { todayIso } from '../../../components/ui/dateEntry'
import { EM_DASH, formatAmount, formatDate } from '../../../lib/format'
import { bandForGrade } from '../../../lib/roles'
import { useUzsRates } from '../../declarations/api'
import { refName, useEntity } from '../../entities/api'
import { useAssessments } from '../../entities/rating/assessmentsApi'
import { buildFactorChips } from '../../entities/rating/chips'
import { useEntityGroup, useGroupExposure } from '../../groups'
import { useEffectiveLimits } from '../../limits/api'
import { latestUzsRate } from '../../limits/authority'
import { BandBadge } from '../../limits/workbench/parts'
import { useOpenOverduesForBuyer } from './api'
import { num, otherLimitsInForce } from './figures'
import { ChipList, Muted, SubTitle } from './parts'
import type { ChipItem } from './parts'

const MAX_CHIPS = 3

export function BuyerBlock({ entityId, excludeScope }: { entityId: string; excludeScope: string | null }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: assessments, isLoading: l1 } = useAssessments(entityId)
  const { data: entity, isLoading: l2 } = useEntity(entityId)
  const { data: limits, isLoading: l3 } = useEffectiveLimits({ entityId })
  const { data: rates, isLoading: l4 } = useUzsRates((limits ?? []).map((l) => l.currency_code))
  const { data: members, isLoading: l5 } = useEntityGroup(entityId)
  const inGroup = (members?.length ?? 0) > 1
  const parentId = inGroup ? members?.[0]?.ultimate_parent_id : undefined
  const { data: exposure, isLoading: l6 } = useGroupExposure(parentId)

  // One block, shown whole: a half-loaded one would say «no other limits»
  // or «no rate» before the answer arrives.
  if (l1 || l2 || l3 || l4 || l5 || l6) {
    return (
      <section className="mt-6 grid gap-x-8 gap-y-3 border-t border-slate-100 pt-5 md:grid-cols-2" aria-busy="true">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/5" />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-6 w-1/2" />
        </div>
      </section>
    )
  }

  const latest = assessments?.[0] ?? null
  const today = todayIso()
  const others = otherLimitsInForce(limits ?? [], excludeScope, (ccy) => latestUzsRate(rates ?? [], ccy, today))

  const place = [
    refName(entity?.countries, locale) || entity?.country_code,
    refName(entity?.industries, locale),
    latest ? t('agenda.triage.buyer.assessed', { date: formatDate(latest.created_at, locale) }) : t('rating.notRated'),
  ]
    .filter(Boolean)
    .join(' · ')

  const { strengths, weaknesses } = latest?.calculation_trace?.rating?.components
    ? buildFactorChips(latest.calculation_trace.rating.components, t, locale)
    : { strengths: [], weaknesses: [] }
  const chips: ChipItem[] = [
    ...strengths.slice(0, MAX_CHIPS).map((c) => ({ key: c.factor, text: c.text, tone: 'pos' as const })),
    ...weaknesses.slice(0, MAX_CHIPS).map((c) => ({ key: c.factor, text: c.text, tone: 'neg' as const })),
  ]

  return (
    <section className="mt-6 grid gap-x-8 gap-y-5 border-t border-slate-100 pt-5 md:grid-cols-2">
      <div className="min-w-0">
        <SubTitle>{t('agenda.triage.buyer.title')}</SubTitle>
        <p className="flex flex-wrap items-center gap-2 text-body">
          {latest && <BandBadge band={bandForGrade(latest.rating_grade)} grade={latest.rating_grade} />}
          {latest && (
            <span className="font-semibold text-slate-900 tabular-nums">{formatAmount(num(latest.rating_score), locale, 1)}</span>
          )}
          <Link to={`/entities/${entityId}`} className="min-w-0 truncate font-semibold text-accent-600 hover:underline">
            {entity?.name ?? EM_DASH}
          </Link>
        </p>
        <ul className="mt-2 flex flex-col gap-1 text-small text-slate-700">
          <li>{place}</li>
          <li className="tabular-nums">
            {others.count === 0
              ? t('agenda.triage.buyer.otherNone')
              : t('agenda.triage.buyer.other', {
                  count: others.count,
                  amount: others.uzs === null ? EM_DASH : formatAmount(others.uzs, locale),
                })}
            {others.missingRates > 0 && ` · ${t('agenda.triage.missingRates', { count: others.missingRates })}`}
          </li>
          <li>
            {inGroup
              ? t('agenda.triage.buyer.group', {
                  body: t('groups.chip.body', {
                    parent: exposure?.ultimate_parent_name ?? EM_DASH,
                    count: members?.length ?? 0,
                    exposure: exposure ? formatAmount(num(exposure.exposure_uzs), locale) : EM_DASH,
                  }),
                })
              : t('agenda.triage.buyer.noGroup')}
          </li>
        </ul>
      </div>
      <div className="min-w-0">
        <SubTitle>{t('agenda.triage.buyer.factors')}</SubTitle>
        {chips.length > 0 ? (
          <ChipList chips={chips} />
        ) : (
          <Muted>{latest ? t('agenda.triage.buyer.noFactors') : t('report.noAssessment')}</Muted>
        )}
      </div>
    </section>
  )
}

/** Open overdue notifications on the buyer, under this policy or another. */
export function OverdueWarning({ entityId, policyId }: { entityId: string; policyId: string | null }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data } = useOpenOverduesForBuyer(entityId)
  if (!data || data.length === 0) return null
  return (
    <Callout tone="warn" className="mt-5" title={t('agenda.triage.noa.title', { count: data.length })}>
      <ul className="flex flex-col gap-1">
        {data.map((noa) => (
          <li key={noa.id}>
            {[
              t('agenda.triage.noa.line', {
                date: formatDate(noa.first_due_date, locale),
                amount: `${formatAmount(num(noa.overdue_amount), locale)} ${noa.currency_code}`,
                policy: noa.policy_number,
              }),
              noa.policy_id === policyId ? t('agenda.triage.noa.thisPolicy') : t('agenda.triage.noa.otherPolicy'),
              noa.limit_suspended ? t('agenda.triage.noa.suspended') : null,
            ]
              .filter(Boolean)
              .join(' · ')}{' '}
            <Link to={`/overdues/${noa.id}`} className="font-medium whitespace-nowrap text-accent-600 hover:underline">
              {t('claims.openNoa')}
            </Link>
          </li>
        ))}
      </ul>
    </Callout>
  )
}
