/** "Policies & portfolio" tab — the entity as POLICYHOLDER: their policies
 * plus the effective limits granted to buyers under those policies. */

import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { Plus } from 'lucide-react'

import {
  Badge,
  Button,
  Callout,
  Card,
  COL,
  EmptyState,
  labelCol,
  LinkRow,
  SectionTitle,
  Skeleton,
  Spinner,
  Table,
  Truncate,
} from '../../components/ui'
import { tci } from '../../lib/supabase'
import { EM_DASH, formatAmount, formatDate } from '../../lib/format'
import { usePolicies } from '../policies/api'
import { statusTone } from '../policies/statusMachine'
import type { EffectiveLimit } from '../limits/types'
import { outcomeTone } from '../limits/machine'
import { TierPanel } from '../tiers'

export function PoliciesTab({ entityId }: { entityId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()

  const { data: allPolicies, isLoading } = usePolicies()
  const policies = (allPolicies ?? []).filter((p) => p.entity_id === entityId)
  const policyIds = policies.map((p) => p.id)

  const limits = useQuery({
    queryKey: ['entities', entityId, 'portfolio-limits', policyIds.join(',')],
    enabled: policyIds.length > 0,
    queryFn: async (): Promise<(EffectiveLimit & { legal_entities?: { name: string } })[]> => {
      const { data, error } = await tci()
        .from('v_effective_limits')
        .select('*')
        .in('policy_id', policyIds)
      if (error) throw error
      const rows = (data ?? []) as EffectiveLimit[]
      // Resolve buyer names in one extra query (views cannot embed).
      const ids = [...new Set(rows.map((r) => r.entity_id))]
      if (!ids.length) return rows
      const { data: names, error: nameError } = await tci()
        .from('legal_entities')
        .select('id, name')
        .in('id', ids)
      if (nameError) throw nameError
      const nameMap = new Map((names ?? []).map((n) => [n.id as string, n.name as string]))
      return rows.map((r) => ({ ...r, legal_entities: { name: nameMap.get(r.entity_id) ?? '' } }))
    },
  })

  // A disabled query (no policies) is not loading; an enabled one that has
  // no answer yet is.
  const limitsLoading = policyIds.length > 0 && limits.isPending

  // Loading is not "no policies": the tab must not claim an empty book
  // while the list is still on its way.
  if (isLoading) return <Spinner label={t('common.loading')} />

  return (
    <div className="flex flex-col gap-5">
      {/* 0094: the policyholder's tier, its measures and the manual tier */}
      <TierPanel entityId={entityId} />
      <Card className="p-5">
        <SectionTitle
          className="mb-3"
          actions={
            <Button size="sm" onClick={() => void navigate(`/policies/new?entity=${entityId}`)}>
              <Plus />
              {t('policies.newPolicy')}
            </Button>
          }
        >
          {t('policyholders.policiesTitle')}
        </SectionTitle>
        {policies.length === 0 ? (
          <EmptyState title={t('policies.emptyForPolicyholder')} />
        ) : (
          <Table dense columns={[COL.code, COL.fill, COL.period, COL.currency, labelCol('policyStatus')]}>
            <thead>
              <tr>
                <th>{t('policies.fields.policyNumber')}</th>
                <th>{t('policies.fields.productStructure')}</th>
                <th>{t('policies.fields.period')}</th>
                <th>{t('policies.fields.currency')}</th>
                <th>{t('policies.fields.status')}</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((p) => (
                <LinkRow key={p.id} to={`/policies/${p.id}`} className="transition-colors hover:bg-slate-50">
                  <td className="font-medium whitespace-nowrap text-slate-800">{p.policy_number}</td>
                  <td className="text-slate-500">{t(`policies.structures.${p.product_structure}`)}</td>
                  <td className="whitespace-nowrap text-slate-500">
                    {formatDate(p.inception_date, locale)} — {formatDate(p.expiry_date, locale)}
                  </td>
                  <td>{p.currency_code}</td>
                  <td>
                    <Badge tone={statusTone(p.status)}>{t(`policies.statuses.${p.status}`)}</Badge>
                  </td>
                </LinkRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle className="mb-3">{t('entities.portfolioLimitsTitle')}</SectionTitle>
        {limitsLoading ? (
          // Still on its way: never claim "no limits" before the answer is in.
          <div className="flex flex-col gap-2" aria-busy="true" aria-label={t('common.loading')}>
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
            <Skeleton className="h-8" />
          </div>
        ) : limits.isError ? (
          <Callout tone="neg" title={t('common.loadFailed')}>
            {t('common.tryAgain')}
          </Callout>
        ) : !limits.data?.length ? (
          <EmptyState title={t('entities.portfolioLimitsEmpty')} />
        ) : (
          <Table dense columns={[COL.fill, COL.code, COL.money, labelCol('limitOutcome'), COL.review]}>
            <thead>
              <tr>
                <th>{t('limits.fields.buyer')}</th>
                <th>{t('policies.fields.policyNumber')}</th>
                <th className="num">{t('limits.fields.approvedAmount')}</th>
                <th>{t('limits.fields.outcome')}</th>
                <th>{t('limits.fields.validUntil')}</th>
              </tr>
            </thead>
            <tbody>
              {limits.data.map((l) => {
                const policyNumber = policies.find((p) => p.id === l.policy_id)?.policy_number
                // The row opens the limit; the buyer opens the company, the
                // policy number the policy.
                return (
                  <LinkRow key={l.decision_id} to={`/limits/${l.request_id}`}>
                    <td>
                      {l.legal_entities?.name ? (
                        <Truncate text={l.legal_entities.name} className="max-w-none">
                          <Link to={`/entities/${l.entity_id}`} className="font-medium text-accent-600 hover:text-accent-500">
                            {l.legal_entities.name}
                          </Link>
                        </Truncate>
                      ) : (
                        <span className="text-slate-500">{EM_DASH}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {policyNumber ? (
                        <Link to={`/policies/${l.policy_id}`} className="text-accent-600 hover:text-accent-500">
                          {policyNumber}
                        </Link>
                      ) : (
                        <span className="text-slate-500">{EM_DASH}</span>
                      )}
                    </td>
                    <td className="num">
                      {l.approved_amount !== null
                        ? `${formatAmount(Number(l.approved_amount), locale)} ${l.currency_code}`
                        : EM_DASH}
                    </td>
                    <td>
                      <Badge tone={outcomeTone(l.outcome)}>{t(`limits.outcomes.${l.outcome}`)}</Badge>
                    </td>
                    <td className="whitespace-nowrap text-slate-500">
                      {l.valid_until ? formatDate(l.valid_until, locale) : t('limits.untilReview')}
                    </td>
                  </LinkRow>
                )
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
