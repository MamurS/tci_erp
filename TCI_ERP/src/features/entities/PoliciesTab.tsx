/** "Policies & portfolio" tab — the entity as POLICYHOLDER: their policies
 * plus the effective limits granted to buyers under those policies. */

import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { Badge, Button, Card, EmptyState, Table, SectionTitle, Spinner } from '../../components/ui'
import { tci } from '../../lib/supabase'
import { EM_DASH, formatAmount, formatDate } from '../../lib/format'
import { usePolicies } from '../policies/api'
import { statusTone } from '../policies/statusMachine'
import type { EffectiveLimit } from '../limits/types'
import { outcomeTone } from '../limits/machine'

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

  // Loading is not "no policies": the tab must not claim an empty book
  // while the list is still on its way.
  if (isLoading) return <Spinner label={t('common.loading')} />

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionTitle
          className="mb-3"
          actions={
            <Button size="sm" onClick={() => void navigate(`/policies/new?entity=${entityId}`)}>
              {t('policies.newPolicy')}
            </Button>
          }
        >
          {t('policyholders.policiesTitle')}
        </SectionTitle>
        {policies.length === 0 ? (
          <EmptyState title={t('policies.emptyForPolicyholder')} />
        ) : (
          <Table dense>
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
                <tr
                  key={p.id}
                  onClick={() => void navigate(`/policies/${p.id}`)}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                >
                  <td className="font-medium text-slate-800">{p.policy_number}</td>
                  <td className="text-slate-500">{t(`policies.structures.${p.product_structure}`)}</td>
                  <td className="whitespace-nowrap text-slate-500">
                    {formatDate(p.inception_date, locale)} — {formatDate(p.expiry_date, locale)}
                  </td>
                  <td>{p.currency_code}</td>
                  <td>
                    <Badge tone={statusTone(p.status)}>{t(`policies.statuses.${p.status}`)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <Card className="p-5">
        <SectionTitle className="mb-3">
          {t('entities.portfolioLimitsTitle')}
        </SectionTitle>
        {!limits.data?.length ? (
          <p className="text-[13px] text-slate-500">{t('limits.noneForPolicy')}</p>
        ) : (
          <Table dense>
            <thead>
              <tr>
                <th>{t('limits.fields.buyer')}</th>
                <th>{t('policies.fields.policyNumber')}</th>
                <th className="text-right">{t('limits.fields.approvedAmount')}</th>
                <th>{t('limits.fields.outcome')}</th>
                <th>{t('limits.fields.validUntil')}</th>
              </tr>
            </thead>
            <tbody>
              {limits.data.map((l) => (
                <tr key={l.decision_id}>
                  <td className="font-medium text-slate-800">
                    {l.legal_entities?.name || EM_DASH}
                  </td>
                  <td className="text-slate-500">
                    {policies.find((p) => p.id === l.policy_id)?.policy_number ?? EM_DASH}
                  </td>
                  <td>
                    <span className="num block">
                      {l.approved_amount !== null
                        ? `${formatAmount(Number(l.approved_amount), locale)} ${l.currency_code}`
                        : EM_DASH}
                    </span>
                  </td>
                  <td>
                    <Badge tone={outcomeTone(l.outcome)}>{t(`limits.outcomes.${l.outcome}`)}</Badge>
                  </td>
                  <td className="text-slate-500">{l.valid_until ? formatDate(l.valid_until, locale) : t('limits.untilReview')}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  )
}
