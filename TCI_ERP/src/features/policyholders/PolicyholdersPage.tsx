/** Policyholder registry — mirrors the buyers registry UX. */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Button,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
} from '../../components/ui'
import { refName, useCountries, useIndustries } from '../buyers/api'
import { countryFlag } from '../../lib/countryFlag'
import { EM_DASH } from '../../lib/format'
import { useCreatePolicyholder, usePolicyholders } from './api'
import { PolicyholderFormModal } from './PolicyholderFormModal'

export function PolicyholdersPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()

  const { data: policyholders, isLoading } = usePolicyholders()
  const { data: countries } = useCountries()
  const { data: industries } = useIndustries()
  const createPolicyholder = useCreatePolicyholder()

  const [search, setSearch] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [industryFilter, setIndustryFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (policyholders ?? []).filter((p) => {
      if (query && !p.name.toLowerCase().includes(query)) return false
      if (countryFilter && p.country_code !== countryFilter) return false
      if (industryFilter && p.industry_id !== industryFilter) return false
      return true
    })
  }, [policyholders, search, countryFilter, industryFilter])

  return (
    <div>
      <PageHeader
        title={t('nav.policyholders')}
        subtitle={t('policyholders.subtitle')}
        actions={<Button onClick={() => setModalOpen(true)}>{t('policyholders.add')}</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('policyholders.searchPlaceholder')}
          className="max-w-xs"
        />
        <Select
          value={countryFilter}
          onChange={(e) => setCountryFilter(e.target.value)}
          className="max-w-48"
        >
          <option value="">{t('buyers.allCountries')}</option>
          {(countries ?? []).map((c) => (
            <option key={c.code} value={c.code}>
              {refName(c, locale)}
            </option>
          ))}
        </Select>
        <Select
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
          className="max-w-56"
        >
          <option value="">{t('buyers.allIndustries')}</option>
          {(industries ?? []).map((ind) => (
            <option key={ind.code} value={ind.code}>
              {refName(ind, locale)}
            </option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={t('policyholders.empty')}
          hint={t('policyholders.emptyHint')}
          action={<Button onClick={() => setModalOpen(true)}>{t('policyholders.add')}</Button>}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('policyholders.fields.name')}</th>
              <th>{t('policyholders.fields.country')}</th>
              <th>{t('policyholders.fields.industry')}</th>
              <th className="text-right">{t('policyholders.activePolicies')}</th>
              <th>{t('buyers.createdAt')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ph) => {
              const activeCount = ph.policies.filter((p) => p.status === 'active').length
              return (
                <tr
                  key={ph.id}
                  onClick={() => void navigate(`/policyholders/${ph.id}`)}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                >
                  <td className="font-medium text-slate-800">{ph.name}</td>
                  <td>
                    <span className="mr-1.5">{countryFlag(ph.country_code)}</span>
                    {refName(ph.countries, locale)}
                  </td>
                  <td className="text-slate-500">{refName(ph.industries, locale) || EM_DASH}</td>
                  <td>
                    <span className="num block">{activeCount || EM_DASH}</span>
                  </td>
                  <td className="text-slate-500">{ph.created_at.slice(0, 10)}</td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      <PolicyholderFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={async (input) => {
          await createPolicyholder.mutateAsync(input)
        }}
      />
    </div>
  )
}
