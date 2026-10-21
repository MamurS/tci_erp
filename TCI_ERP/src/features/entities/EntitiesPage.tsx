/** Unified legal-entities registry: search, country/industry filters, role
 * chips. Roles (policyholder / buyer) are computed server-side
 * (tci.v_entity_roles) - an entity with neither is an analysis prospect. */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Card,
  CountryFlag,
  EmptyState,
  Input,
  PageHeader,
  Segmented,
  Select,
  Spinner,
  Table,
  Truncate,
} from '../../components/ui'
import { normalize } from '../../components/ui/combobox'
import {
  refName,
  useCountries,
  useEntities,
  useEntityRoles,
  useIndustries,
  useLatestGrades,
} from './api'
import { useAuth } from '../../auth/AuthContext'
import { RequestEntityModal } from '../data/RequestEntityModal'
import { canWorkRequests } from '../data/requests'
import { EntityFormModal } from './EntityFormModal'
import { gradeTone } from '../../lib/grade'
import { EM_DASH, formatDate } from '../../lib/format'
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
  const [requesting, setRequesting] = useState(false)
  const { roles: myRoles } = useAuth()
  const dataDesk = canWorkRequests(myRoles)
  const [countryFilter, setCountryFilter] = useState('')
  const [industryFilter, setIndustryFilter] = useState('')
  const [roleChip, setRoleChip] = useState<RoleChip>('all')
  const [modalOpen, setModalOpen] = useState(false)

  // The filters offer what the registry actually holds, with how many —
  // not every country of the world.
  const countryOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of entities ?? []) counts.set(e.country_code, (counts.get(e.country_code) ?? 0) + 1)
    return (countries ?? [])
      .filter((c) => counts.has(c.code))
      .map((c) => ({ code: c.code, name: refName(c, locale), count: counts.get(c.code) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, locale))
  }, [entities, countries, locale])
  const industryOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of entities ?? []) if (e.industry_id) counts.set(e.industry_id, (counts.get(e.industry_id) ?? 0) + 1)
    return (industries ?? [])
      .filter((i) => counts.has(i.code))
      .map((i) => ({ code: i.code, name: refName(i, locale), count: counts.get(i.code) ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, locale))
  }, [entities, industries, locale])

  const filtered = useMemo(() => {
    // Case, diacritics and Uzbek apostrophes do not matter (as in every picker).
    const query = normalize(search)
    return (entities ?? []).filter((e) => {
      if (
        query &&
        !normalize(e.name).includes(query) &&
        !normalize(e.registration_number ?? '').includes(query)
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
          {countryOptions.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name} · {c.count}
            </option>
          ))}
        </Select>
        <Select
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
          className="max-w-56"
        >
          <option value="">{t('buyers.allIndustries')}</option>
          {industryOptions.map((ind) => (
            <option key={ind.code} value={ind.code}>
              {ind.name} · {ind.count}
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
      ) : filtered.length === 0 && search.trim().length >= 3 ? (
        // A search that finds nothing is where a missing company is noticed:
        // offer to have it registered by an information manager (0054), or
        // to add it now for those whose work that is.
        <Card className="p-6">
          <EmptyState
            title={t('data.notFound.title', { query: search.trim() })}
            hint={t(dataDesk ? 'data.notFound.hintDesk' : 'data.notFound.hint')}
            action={
              // One action, the one that fits the person: the data desk
              // registers the company itself (pre-filled with the name),
              // everyone else asks the data desk to.
              dataDesk ? (
                <Button onClick={() => setModalOpen(true)}>
                  {t('data.notFound.add', { query: search.trim() })}
                </Button>
              ) : (
                <Button onClick={() => setRequesting(true)}>{t('data.notFound.request')}</Button>
              )
            }
          />
        </Card>
      ) : filtered.length === 0 ? (
        // «Add company» is in the page header; the empty state does not repeat it.
        <EmptyState title={t('entities.empty')} hint={t('entities.emptyHint')} />
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
                    <Truncate text={entity.name} className="max-w-[20rem]" />
                    {entity.registration_number && (
                      <span className="num block text-xs font-normal text-slate-400">
                        {entity.registration_number}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    <CountryFlag code={entity.country_code} className="mr-1.5" />
                    {refName(entity.countries, locale)}
                  </td>
                  <td className="text-slate-500">{refName(entity.industries, locale) || EM_DASH}</td>
                  <td>
                    <RoleBadges roles={roles.data?.get(entity.id)} />
                  </td>
                  <td className="whitespace-nowrap text-slate-500">{latest ? formatDate(latest, locale) : EM_DASH}</td>
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

      <EntityFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        prefill={search.trim() ? { name: search.trim() } : undefined}
      />
      <RequestEntityModal open={requesting} initialName={search.trim()} onClose={() => setRequesting(false)} />
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
