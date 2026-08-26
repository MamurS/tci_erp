/** Unified legal-entities registry: search, country/industry filters, role
 * chips. Roles (policyholder / buyer) are computed server-side
 * (tci.v_entity_roles) - an entity with neither is an analysis prospect. */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  EmptyState,
  Input,
  PageHeader,
  Segmented,
  Select,
  Spinner,
  Table,
} from '../../components/ui'
import {
  refName,
  useCountries,
  useEntities,
  useEntityRoles,
  useIndustries,
  useLatestGrades,
} from './api'
import { EntityFormModal } from './EntityFormModal'
import { countryFlag } from '../../lib/countryFlag'
import { gradeTone } from '../../lib/grade'
import { EM_DASH } from '../../lib/format'
import type { EntityRoles } from './types'

type RoleChip = 'all' | 'policyholders' | 'buyers'

export function EntitiesPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()

  const { data: entities, isLoading } = useEntities()
  const roles = useEntityRoles()
  const grades = useLatestGrades()
  const { data: countries } = useCountries()
  const { data: industries } = useIndustries()

  const [search, setSearch] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [industryFilter, setIndustryFilter] = useState('')
  const [roleChip, setRoleChip] = useState<RoleChip>('all')
  const [modalOpen, setModalOpen] = useState(false)

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return (entities ?? []).filter((e) => {
      if (
        query &&
        !e.name.toLowerCase().includes(query) &&
        !(e.registration_number ?? '').toLowerCase().includes(query)
      )
        return false
      if (countryFilter && e.country_code !== countryFilter) return false
      if (industryFilter && e.industry_id !== industryFilter) return false
      const r = roles.data?.get(e.id)
      if (roleChip === 'policyholders' && !r?.is_policyholder) return false
      if (roleChip === 'buyers' && !r?.is_buyer) return false
      return true
    })
  }, [entities, search, countryFilter, industryFilter, roleChip, roles.data])

  const latestPeriod = (periods: { period_end_date: string }[]): string | null =>
    periods.length
      ? periods.reduce((a, b) => (a.period_end_date > b.period_end_date ? a : b)).period_end_date
      : null

  return (
    <div>
      <PageHeader
        title={t('nav.entities')}
        subtitle={t('entities.subtitle')}
        actions={<Button onClick={() => setModalOpen(true)}>{t('entities.add')}</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('entities.searchPlaceholder')}
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
        <Segmented
          options={[
            { key: 'all', label: t('entities.roleChips.all') },
            { key: 'policyholders', label: t('entities.roleChips.policyholders') },
            { key: 'buyers', label: t('entities.roleChips.buyers') },
          ]}
          value={roleChip}
          onChange={(key) => setRoleChip(key as RoleChip)}
        />
      </div>

      {isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={t('entities.empty')}
          hint={t('entities.emptyHint')}
          action={<Button onClick={() => setModalOpen(true)}>{t('entities.add')}</Button>}
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('buyers.fields.name')}</th>
              <th>{t('buyers.fields.country')}</th>
              <th>{t('buyers.fields.industry')}</th>
              <th>{t('entities.rolesHeader')}</th>
              <th>{t('buyers.latestStatement')}</th>
              <th>{t('limits.fields.grade')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entity) => {
              const latest = latestPeriod(entity.financial_statements)
              const grade = grades.data?.get(entity.id)
              return (
                <tr
                  key={entity.id}
                  onClick={() => void navigate(`/entities/${entity.id}`)}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                >
                  <td className="font-medium text-slate-800">
                    {entity.name}
                    {entity.registration_number && (
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        {entity.registration_number}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="mr-1.5">{countryFlag(entity.country_code)}</span>
                    {refName(entity.countries, locale)}
                  </td>
                  <td className="text-slate-500">{refName(entity.industries, locale) || EM_DASH}</td>
                  <td>
                    <RoleBadges roles={roles.data?.get(entity.id)} />
                  </td>
                  <td className="text-slate-500">{latest ?? EM_DASH}</td>
                  <td>
                    {grade ? (
                      <Badge tone={gradeTone(grade)}>{grade}</Badge>
                    ) : (
                      <span className="text-slate-400">{EM_DASH}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      <EntityFormModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  )
}

export function RoleBadges({ roles }: { roles: EntityRoles | undefined }) {
  const { t } = useTranslation()
  if (!roles || (!roles.is_policyholder && !roles.is_buyer)) {
    return <span className="text-xs text-slate-400">{t('entities.roles.none')}</span>
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {roles.is_policyholder && <Badge tone="accent">{t('entities.roles.policyholder')}</Badge>}
      {roles.is_buyer && <Badge tone="pos">{t('entities.roles.buyer')}</Badge>}
    </span>
  )
}
