/** Policy registry with status/policyholder/structure filters. */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
} from '../../components/ui'
import { EM_DASH, formatAmount } from '../../lib/format'
import { usePolicyholders } from '../policyholders/api'
import { usePolicies } from './api'
import { statusTone } from './statusMachine'
import { POLICY_STATUSES, PRODUCT_STRUCTURES } from './types'

export function PoliciesPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()

  const { data: policies, isLoading } = usePolicies()
  const { data: policyholders } = usePolicyholders()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [policyholderFilter, setPolicyholderFilter] = useState('')
  const [structureFilter, setStructureFilter] = useState('')

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (policies ?? []).filter((p) => {
      if (query && !p.policy_number.toLowerCase().includes(query)) return false
      if (statusFilter && p.status !== statusFilter) return false
      if (policyholderFilter && p.policyholder_id !== policyholderFilter) return false
      if (structureFilter && p.product_structure !== structureFilter) return false
      return true
    })
  }, [policies, search, statusFilter, policyholderFilter, structureFilter])

  return (
    <div>
      <PageHeader
        title={t('nav.policies')}
        subtitle={t('policies.subtitle')}
        actions={
          <Button onClick={() => void navigate('/policies/new')}>{t('policies.newPolicy')}</Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('policies.searchPlaceholder')}
          className="max-w-xs"
        />
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="max-w-44"
        >
          <option value="">{t('policies.allStatuses')}</option>
          {POLICY_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`policies.statuses.${s}`)}
            </option>
          ))}
        </Select>
        <Select
          value={policyholderFilter}
          onChange={(e) => setPolicyholderFilter(e.target.value)}
          className="max-w-56"
        >
          <option value="">{t('policies.allPolicyholders')}</option>
          {(policyholders ?? []).map((ph) => (
            <option key={ph.id} value={ph.id}>
              {ph.name}
            </option>
          ))}
        </Select>
        <Select
          value={structureFilter}
          onChange={(e) => setStructureFilter(e.target.value)}
          className="max-w-52"
        >
          <option value="">{t('policies.allStructures')}</option>
          {PRODUCT_STRUCTURES.map((s) => (
            <option key={s} value={s}>
              {t(`policies.structures.${s}`)}
            </option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={t('policies.empty')}
          hint={t('policies.emptyHint')}
          action={
            <Button onClick={() => void navigate('/policies/new')}>
              {t('policies.newPolicy')}
            </Button>
          }
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('policies.fields.policyNumber')}</th>
              <th>{t('policies.fields.policyholder')}</th>
              <th>{t('policies.fields.productStructure')}</th>
              <th>{t('policies.fields.period')}</th>
              <th>{t('policies.fields.currency')}</th>
              <th>{t('policies.fields.status')}</th>
              <th className="text-right">{t('policies.terms.discretionaryLimit')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.id}
                onClick={() => void navigate(`/policies/${p.id}`)}
                className="cursor-pointer transition-colors hover:bg-slate-50"
              >
                <td className="font-medium text-slate-800">{p.policy_number}</td>
                <td className="text-slate-600">{p.policyholders?.name ?? EM_DASH}</td>
                <td className="text-slate-500">{t(`policies.structures.${p.product_structure}`)}</td>
                <td className="text-slate-500">
                  {p.inception_date} — {p.expiry_date}
                </td>
                <td>{p.currency_code}</td>
                <td>
                  <Badge tone={statusTone(p.status)}>{t(`policies.statuses.${p.status}`)}</Badge>
                </td>
                <td>
                  <span className="num block">
                    {formatAmount(Number(p.discretionary_limit), locale)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
