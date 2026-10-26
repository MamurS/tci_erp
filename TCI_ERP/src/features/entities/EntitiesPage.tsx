/** Unified legal-entities registry: search, country/industry filters, role
 * chips. Roles (policyholder / buyer) are computed server-side
 * (tci.v_entity_roles) - an entity with neither is an analysis prospect. */

import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Eye, Plus, Search, X } from 'lucide-react'

import {
  Badge,
  Button,
  Card,
  actionsCol,
  COL,
  Combobox,
  CountryFlag,
  DescriptionList,
  EmptyState,
  GradeBadge,
  Highlight,
  Input,
  LinkButton,
  PageHeader,
  RowActions,
  Segmented,
  SidePanel,
  SkeletonRows,
  Table,
  TableSettings,
  Truncate,
} from '../../components/ui'
import type { ComboOption } from '../../components/ui'
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
import { mayWriteEntities } from './access'
import { EntityFormModal } from './EntityFormModal'
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

  // The search lives in the URL (?q=): the command palette's «search the
  // registry» lands here with it, and a filtered list can be linked to.
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('q') ?? ''
  const setSearch = (next: string) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        if (next) params.set('q', next)
        else params.delete('q')
        return params
      },
      { replace: true },
    )
  const [requesting, setRequesting] = useState(false)
  const { roles: myRoles } = useAuth()
  const dataDesk = canWorkRequests(myRoles)
  const [countryFilter, setCountryFilter] = useState<string | null>(null)
  const [industryFilter, setIndustryFilter] = useState<string | null>(null)
  const [roleChip, setRoleChip] = useState<RoleChip>('all')
  const [modalOpen, setModalOpen] = useState(false)
  // The quick view: a row's summary beside the list (Table v2).
  const [peekId, setPeekId] = useState<string | null>(null)

  // The filters offer what the registry actually holds, with how many —
  // not every country of the world.
  const countryOptions = useMemo<ComboOption[]>(() => {
    const counts = new Map<string, number>()
    for (const e of entities ?? []) counts.set(e.country_code, (counts.get(e.country_code) ?? 0) + 1)
    return (countries ?? [])
      .filter((c) => counts.has(c.code))
      .map((c) => ({
        id: c.code,
        label: refName(c, locale),
        keywords: [c.code, c.name_en, c.name_ru, c.name_uz],
        meta: (
          <span className="inline-flex items-center gap-2">
            <CountryFlag code={c.code} />
            {t('entities.filterCount', { count: counts.get(c.code) ?? 0 })}
          </span>
        ),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, locale))
  }, [entities, countries, locale, t])
  const industryOptions = useMemo<ComboOption[]>(() => {
    const counts = new Map<string, number>()
    for (const e of entities ?? []) if (e.industry_id) counts.set(e.industry_id, (counts.get(e.industry_id) ?? 0) + 1)
    return (industries ?? [])
      .filter((i) => counts.has(i.code))
      .map((i) => ({
        id: i.code,
        label: refName(i, locale),
        keywords: [i.code, i.name_en, i.name_ru, i.name_uz],
        meta: t('entities.filterCount', { count: counts.get(i.code) ?? 0 }),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, locale))
  }, [entities, industries, locale, t])

  // Case, diacritics and Uzbek apostrophes do not matter (as in every picker).
  const query = normalize(search)
  const searchHits = useMemo(
    () =>
      (entities ?? []).filter(
        (e) =>
          !query ||
          normalize(e.name).includes(query) ||
          normalize(e.registration_number ?? '').includes(query),
      ),
    [entities, query],
  )
  const filtered = useMemo(
    () =>
      searchHits.filter((e) => {
        if (countryFilter && e.country_code !== countryFilter) return false
        if (industryFilter && e.industry_id !== industryFilter) return false
        const r = roles.data?.get(e.id)
        if (roleChip === 'policyholders' && !r?.is_policyholder) return false
        if (roleChip === 'buyers' && !r?.is_buyer) return false
        return true
      }),
    [searchHits, countryFilter, industryFilter, roleChip, roles.data],
  )

  const filtersActive = countryFilter !== null || industryFilter !== null || roleChip !== 'all'
  const resetFilters = () => {
    setCountryFilter(null)
    setIndustryFilter(null)
    setRoleChip('all')
  }
  // "Not in the registry" is a fact about the SEARCH, not about the filters:
  // a company hidden by a country filter is there, and offering to register
  // it again would make a duplicate.
  const notFound = !isLoading && search.trim().length >= 3 && searchHits.length === 0

  const latestPeriod = (periods: { period_end_date: string }[]): string | null =>
    periods.length
      ? periods.reduce((a, b) => (a.period_end_date > b.period_end_date ? a : b)).period_end_date
      : null

  const tableColumns = [COL.fill, '9rem', '10rem', '13.5rem', COL.date, COL.grade, actionsCol([], 1)]
  const columnLabels = [
    t('buyers.fields.name'),
    t('buyers.fields.country'),
    t('buyers.fields.industry'),
    t('entities.rolesHeader'),
    t('buyers.latestStatement'),
    t('limits.fields.grade'),
    '',
  ]
  const tableHead = (
    <thead>
      <tr>
        {columnLabels.map((label, i) => (
          <th key={i}>{label ? label : <span className="sr-only">{t('common.actions')}</span>}</th>
        ))}
      </tr>
    </thead>
  )
  const peek = peekId ? (entities ?? []).find((e) => e.id === peekId) : undefined

  return (
    <div>
      <PageHeader
        title={t('nav.entities')}
        subtitle={t('entities.subtitle')}
        // While a search finds nothing, the empty state below carries the one
        // action that fits (register it pre-filled, or ask the data desk);
        // the header does not offer a competing second one. The slot keeps
        // its height so the title does not move.
        actions={
          <div className="flex h-9 items-center">
            {!notFound && mayWriteEntities(myRoles) && (
              <Button onClick={() => setModalOpen(true)}>
                <Plus />
                {t('entities.add')}
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder={t('entities.searchPlaceholder')}
          clearLabel={t('picker.clear')}
        />
        <div className="w-52">
          <Combobox
            value={countryFilter}
            onChange={setCountryFilter}
            options={countryOptions}
            openOnFocus
            limit={50}
            placeholder={t('buyers.allCountries')}
            aria-label={t('buyers.fields.country')}
          />
        </div>
        <div className="w-60">
          <Combobox
            value={industryFilter}
            onChange={setIndustryFilter}
            options={industryOptions}
            openOnFocus
            limit={50}
            placeholder={t('buyers.allIndustries')}
            aria-label={t('buyers.fields.industry')}
          />
        </div>
        <Segmented
          options={[
            { key: 'all', label: t('entities.roleChips.all') },
            { key: 'policyholders', label: t('entities.roleChips.policyholders') },
            { key: 'buyers', label: t('entities.roleChips.buyers') },
          ]}
          value={roleChip}
          onChange={(key) => setRoleChip(key as RoleChip)}
        />
        <div className="ml-auto">
          <TableSettings table="entities" columns={columnLabels} />
        </div>
      </div>

      {isLoading ? (
        <Table id="entities" columns={tableColumns}>
          {tableHead}
          <tbody>
            <SkeletonRows columns={tableColumns.length} />
          </tbody>
        </Table>
      ) : notFound ? (
        // A search that finds nothing is where a missing company is noticed:
        // offer to have it registered by an information manager (0054), or
        // to add it now for those whose work that is.
        <Card className="p-6">
          <EmptyState
            pictogram="search"
            title={t('data.notFound.title', { query: search.trim() })}
            hint={t(dataDesk ? 'data.notFound.hintDesk' : 'data.notFound.hint')}
            action={
              // One action, the one that fits the person: the data desk
              // registers the company itself (pre-filled with the name),
              // everyone else asks the data desk to.
              dataDesk ? (
                <Button onClick={() => setModalOpen(true)}>
                  <Plus />
                  {t('data.notFound.add', { query: search.trim() })}
                </Button>
              ) : (
                <Button onClick={() => setRequesting(true)}>{t('data.notFound.request')}</Button>
              )
            }
          />
        </Card>
      ) : filtered.length === 0 && (filtersActive || search.trim() !== '') ? (
        // Emptied by the filters (or by a search too short to call the
        // company missing): say so and offer the way back, never «create».
        <EmptyState
          pictogram="search"
          title={t('common.noMatches')}
          hint={t('common.noMatchesHint')}
          action={
            <Button
              variant="secondary"
              onClick={() => {
                resetFilters()
                setSearch('')
              }}
            >
              {t('common.resetFilters')}
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        // «Add company» is in the page header; the empty state does not repeat it.
        <EmptyState pictogram="companies" title={t('entities.empty')} hint={t('entities.emptyHint')} />
      ) : (
        <Table id="entities" columns={tableColumns} stickyHead freezeFirst>
          {tableHead}
          <tbody>
            {filtered.map((entity) => {
              const latest = latestPeriod(entity.financial_statements)
              const grade = grades.data?.get(entity.id)
              const industry = refName(entity.industries, locale)
              return (
                <tr
                  key={entity.id}
                  onClick={() => void navigate(`/entities/${entity.id}`)}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                >
                  <td className="font-medium text-slate-800">
                    <Truncate text={entity.name} className="max-w-none">
                      <Highlight text={entity.name} query={search} />
                    </Truncate>
                    {entity.registration_number && (
                      // A registration number is one token: never broken.
                      <span className="block truncate text-caption font-normal whitespace-nowrap text-slate-500 tabular-nums">
                        <Highlight text={entity.registration_number} query={search} />
                      </span>
                    )}
                  </td>
                  <td>
                    <Truncate text={refName(entity.countries, locale)} className="max-w-none">
                      <CountryFlag code={entity.country_code} className="mr-2" />
                      {refName(entity.countries, locale)}
                    </Truncate>
                  </td>
                  <td className="text-slate-500">
                    {industry ? <Truncate text={industry} className="max-w-none" /> : EM_DASH}
                  </td>
                  <td>
                    <RoleBadges roles={roles.data?.get(entity.id)} />
                  </td>
                  <td className="whitespace-nowrap text-slate-500">{latest ? formatDate(latest, locale) : EM_DASH}</td>
                  <td>
                    {grade ? (
                      <GradeBadge grade={grade} />
                    ) : (
                      <span className="text-slate-500">{EM_DASH}</span>
                    )}
                  </td>
                  <RowActions reveal>
                    <button
                      type="button"
                      onClick={() => setPeekId(entity.id)}
                      aria-label={t('ui.quickView.open', { name: entity.name })}
                      title={t('ui.quickView.label')}
                      className="inline-flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-sky-500"
                    >
                      <Eye className="size-4" aria-hidden />
                    </button>
                  </RowActions>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      <SidePanel
        open={peek !== undefined}
        title={peek?.name}
        meta={peek?.registration_number}
        onClose={() => setPeekId(null)}
        footer={peek && <LinkButton to={`/entities/${peek.id}`}>{t('ui.quickView.openCard')}</LinkButton>}
      >
        {peek && (
          <DescriptionList
            items={[
              {
                label: t('buyers.fields.country'),
                value: (
                  <span className="inline-flex items-center">
                    <CountryFlag code={peek.country_code} className="mr-2" />
                    {refName(peek.countries, locale)}
                  </span>
                ),
              },
              { label: t('buyers.fields.industry'), value: refName(peek.industries, locale) || EM_DASH },
              { label: t('entities.rolesHeader'), value: <RoleBadges roles={roles.data?.get(peek.id)} /> },
              {
                label: t('buyers.latestStatement'),
                value: (() => {
                  const latest = latestPeriod(peek.financial_statements)
                  return latest ? formatDate(latest, locale) : EM_DASH
                })(),
              },
              {
                label: t('limits.fields.grade'),
                value: grades.data?.get(peek.id) ? <GradeBadge grade={grades.data.get(peek.id)} /> : EM_DASH,
              },
            ]}
          />
        )}
      </SidePanel>

      <EntityFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        prefill={search.trim() ? { name: search.trim() } : undefined}
      />
      <RequestEntityModal open={requesting} initialName={search.trim()} onClose={() => setRequesting(false)} />
    </div>
  )
}

/** The registry's search box, with the same magnifier and × as the pickers. */
function SearchField({
  value,
  onChange,
  placeholder,
  clearLabel,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
  clearLabel: string
}) {
  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
      <Input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) onChange('')
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pr-8 pl-8 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label={clearLabel}
          title={clearLabel}
          className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}

export function RoleBadges({ roles }: { roles: EntityRoles | undefined }) {
  const { t } = useTranslation()
  // Every role mark is a pill, «under analysis» too — plain grey text next
  // to pills reads as a missing value, not as a role.
  if (!roles || (!roles.is_policyholder && !roles.is_buyer)) {
    return <Badge tone="neutral">{t('entities.roles.none')}</Badge>
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {roles.is_policyholder && <Badge tone="accent">{t('entities.roles.policyholder')}</Badge>}
      {roles.is_buyer && <Badge tone="pos">{t('entities.roles.buyer')}</Badge>}
    </span>
  )
}
