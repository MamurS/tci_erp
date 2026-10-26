/** Policy registry with status/policyholder/structure filters. */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  COL,
  EmptyState,
  Input,
  labelCol,
  Select,
  Spinner,
  Table,
  Truncate,
  ViewBar,
} from '../../components/ui'
import { EM_DASH, formatAmount, formatDate } from '../../lib/format'
import { usePolicies } from './api'
import { useAuth } from '../../auth/AuthContext'
import { mayWritePolicies, statusTone } from './statusMachine'
import { POLICY_STATUSES, PRODUCT_STRUCTURES } from './types'
import type { PolicyStatus, ProductStructure } from './types'

export function PoliciesPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()
  const { roles } = useAuth()

  const { data: policies, isLoading } = usePolicies()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [policyholderFilter, setPolicyholderFilter] = useState('')
  const [structureFilter, setStructureFilter] = useState('')

  // The filter offers the companies that actually hold a policy, not the
  // whole registry.
  const policyholders = useMemo(() => {
    const byId = new Map<string, string>()
    for (const p of policies ?? []) if (p.legal_entities) byId.set(p.entity_id, p.legal_entities.name)
    return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [policies])
  // The filters offer only the statuses and structures the register holds,
  // each with its count.
  const counted = useMemo(() => {
    const status = new Map<PolicyStatus, number>()
    const structure = new Map<ProductStructure, number>()
    for (const p of policies ?? []) {
      status.set(p.status, (status.get(p.status) ?? 0) + 1)
      structure.set(p.product_structure, (structure.get(p.product_structure) ?? 0) + 1)
    }
    return { status, structure }
  }, [policies])
  const filtering = Boolean(search.trim() || statusFilter || policyholderFilter || structureFilter)
  const resetFilters = () => {
    setSearch('')
    setStatusFilter('')
    setPolicyholderFilter('')
    setStructureFilter('')
  }

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (policies ?? []).filter((p) => {
      if (
        query &&
        !p.policy_number.toLowerCase().includes(query) &&
        !(p.legal_entities?.name ?? '').toLowerCase().includes(query)
      )
        return false
      if (statusFilter && p.status !== statusFilter) return false
      if (policyholderFilter && p.entity_id !== policyholderFilter) return false
      if (structureFilter && p.product_structure !== structureFilter) return false
      return true
    })
  }, [policies, search, statusFilter, policyholderFilter, structureFilter])

  return (
    <div>
      <ViewBar
        hint={t('policies.subtitle')}
        actions={
          mayWritePolicies(roles) ? (
            <Button onClick={() => void navigate('/policies/new')}>{t('policies.newPolicy')}</Button>
          ) : undefined
        }
      />

      {/* Fixed widths, so the four filters sit on one line at 1280px. */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('policies.searchPlaceholder')}
          className="sm:w-64"
        />
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="sm:w-44"
        >
          <option value="">{t('policies.allStatuses')}</option>
          {POLICY_STATUSES.filter((s) => counted.status.has(s) || s === statusFilter).map((s) => (
            <option key={s} value={s}>
              {t(`policies.statuses.${s}`)} ({counted.status.get(s) ?? 0})
            </option>
          ))}
        </Select>
        <Select
          value={policyholderFilter}
          onChange={(e) => setPolicyholderFilter(e.target.value)}
          className="sm:w-56"
        >
          <option value="">{t('policies.allPolicyholders')}</option>
          {policyholders.map((ph) => (
            <option key={ph.id} value={ph.id}>
              {ph.name}
            </option>
          ))}
        </Select>
        <Select
          value={structureFilter}
          onChange={(e) => setStructureFilter(e.target.value)}
          className="sm:w-52"
        >
          <option value="">{t('policies.allStructures')}</option>
          {PRODUCT_STRUCTURES.filter((s) => counted.structure.has(s) || s === structureFilter).map((s) => (
            <option key={s} value={s}>
              {t(`policies.structures.${s}`)} ({counted.structure.get(s) ?? 0})
            </option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : filtered.length === 0 ? (
        // «New policy» lives in the bar above; the empty state never repeats it.
        filtering ? (
          <EmptyState
            title={t('common.noMatches')}
            hint={t('common.noMatchesHint')}
            action={
              <Button variant="secondary" onClick={resetFilters}>
                {t('common.resetFilters')}
              </Button>
            }
          />
        ) : (
          <EmptyState title={t('policies.empty')} hint={t('policies.emptyHint')} />
        )
      ) : (
        <Table columns={[COL.code, COL.fill, COL.period, labelCol('policyStatus'), COL.money]}>
          <thead>
            <tr>
              <th>{t('policies.fields.policyNumber')}</th>
              <th>{t('policies.fields.policyholder')}</th>
              <th>{t('policies.fields.period')}</th>
              <th>{t('policies.fields.status')}</th>
              <th className="num">{t('policies.terms.discretionaryLimit')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.id}
                onClick={() => void navigate(`/policies/${p.id}`)}
                className="cursor-pointer transition-colors hover:bg-slate-50"
              >
                <td className="font-medium whitespace-nowrap text-slate-800">{p.policy_number}</td>
                <td className="text-slate-600">
                  <Truncate text={p.legal_entities?.name} className="max-w-none">
                    {p.legal_entities?.name ?? EM_DASH}
                  </Truncate>
                  {/* The structure under the name: a column of its own pushed
                      the register past a laptop's width. */}
                  <span className="block text-[0.75rem] text-slate-500">{t(`policies.structures.${p.product_structure}`)}</span>
                </td>
                <td className="whitespace-nowrap text-slate-500">
                  {formatDate(p.inception_date, locale)} — {formatDate(p.expiry_date, locale)}
                </td>
                <td>
                  <Badge tone={statusTone(p.status)}>{t(`policies.statuses.${p.status}`)}</Badge>
                </td>
                {/* The amount with its currency, as everywhere else. */}
                <td className="num">
                  {formatAmount(Number(p.discretionary_limit), locale)}{' '}
                  <span className="text-slate-500">{p.currency_code}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
