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
import { refName, useBuyers, useCreateBuyer, useCountries, useIndustries } from './api'
import { BuyerFormModal } from './BuyerFormModal'
import { countryFlag } from '../../lib/countryFlag'
import { EM_DASH } from '../../lib/format'

export function BuyersPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()

  const { data: buyers, isLoading } = useBuyers()
  const { data: countries } = useCountries()
  const { data: industries } = useIndustries()
  const createBuyer = useCreateBuyer()

  const [search, setSearch] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [industryFilter, setIndustryFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (buyers ?? []).filter((b) => {
      if (query && !b.name.toLowerCase().includes(query)) return false
      if (countryFilter && b.country_code !== countryFilter) return false
      if (industryFilter && b.industry_id !== industryFilter) return false
      return true
    })
  }, [buyers, search, countryFilter, industryFilter])

  const latestPeriod = (periods: { period_end_date: string }[]): string | null =>
    periods.length
      ? periods.reduce((a, b) => (a.period_end_date > b.period_end_date ? a : b)).period_end_date
      : null

  return (
    <div>
      <PageHeader
        title={t('nav.buyers')}
        subtitle={t('buyers.subtitle')}
        actions={<Button onClick={() => setModalOpen(true)}>{t('buyers.addBuyer')}</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('buyers.searchPlaceholder')}
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
          title={t('buyers.empty')}
          hint={t('buyers.emptyHint')}
          action={<Button onClick={() => setModalOpen(true)}>{t('buyers.addBuyer')}</Button>}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('buyers.fields.name')}</th>
              <th>{t('buyers.fields.country')}</th>
              <th>{t('buyers.fields.industry')}</th>
              <th>{t('buyers.latestStatement')}</th>
              <th>{t('buyers.createdAt')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((buyer) => {
              const latest = latestPeriod(buyer.financial_statements)
              return (
                <tr
                  key={buyer.id}
                  onClick={() => void navigate(`/buyers/${buyer.id}`)}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                >
                  <td className="font-medium text-slate-800">{buyer.name}</td>
                  <td>
                    <span className="mr-1.5">{countryFlag(buyer.country_code)}</span>
                    {refName(buyer.countries, locale)}
                  </td>
                  <td className="text-slate-500">{refName(buyer.industries, locale) || EM_DASH}</td>
                  <td className="text-slate-500">{latest ?? EM_DASH}</td>
                  <td className="text-slate-500">{buyer.created_at.slice(0, 10)}</td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      <BuyerFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={async (input) => {
          await createBuyer.mutateAsync(input)
        }}
      />
    </div>
  )
}
