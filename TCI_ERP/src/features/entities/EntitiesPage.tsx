/** Unified legal-entities registry: search, country/industry filters, role
 * chips. Roles (policyholder / buyer) are computed server-side
 * (tci.v_entity_roles) - an entity with neither is an analysis prospect. */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'

import {
  Badge,
  Button,
  Card,
  actionsCol,
  BulkBar,
  COL,
  CountryFlag,
  DescriptionList,
  downloadCsv,
  EmptyState,
  GradeBadge,
  Highlight,
  LinkButton,
  LinkRow,
  PageHeader,
  QuickViewButton,
  RowActions,
  Segmented,
  SelectCheckbox,
  SidePanel,
  SkeletonRows,
  Table,
  TableSettings,
  toCsv,
  Truncate,
  useRowSelection,
} from '../../components/ui'
import { usePageSearch } from '../../components/layout/usePageSearch'
import { searchRows } from '../../lib/pageSearch'
import {
  refName,
  useEntities,
  useEntityRoles,
  useLatestGrades,
} from './api'
import { useAuth } from '../../auth/AuthContext'
import { RequestEntityModal } from '../data/RequestEntityModal'
import { canWorkRequests } from '../data/requests'
import { mayWriteEntities } from './access'
import { EntityFormModal } from './EntityFormModal'
import { EM_DASH, formatDate } from '../../lib/format'
import type { EntityRoles } from './types'
import { IndustrySectorBadge } from '../risk/badges'
import { CountryRiskCompact, CountryWithRisk, IndustryWithSector, RiskSubline } from '../risk/integrationBadges'
import { SANCTIONS_CELL, SANCTIONS_COLUMN, SanctionsCell, SanctionsColumnHeader } from '../sanctions/components'
import { TierMark } from '../tiers'

type RoleChip = 'all' | 'policyholders' | 'buyers'

export function EntitiesPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'

  const { data: entities, isLoading } = useEntities()
  const roles = useEntityRoles()
  const grades = useLatestGrades()

  // The one search (top bar, lib/pageSearch.ts): what was typed lives in the
  // URL (?q=); terms separated by commas narrow the list in order, a country
  // or an industry being just another term.
  const { query: search, setQuery: setSearch } = usePageSearch('entities')
  const [requesting, setRequesting] = useState(false)
  const { roles: myRoles } = useAuth()
  const dataDesk = canWorkRequests(myRoles)
  const [roleChip, setRoleChip] = useState<RoleChip>('all')
  const [modalOpen, setModalOpen] = useState(false)
  // The quick view: a row's summary beside the list (Table v2).
  const [peekId, setPeekId] = useState<string | null>(null)
  // Rows picked for a bulk action (the bulk bar), by id.
  const { selected, toggle, toggleAll, allOf, clear } = useRowSelection()

  // Name, registration number, country (code and name in every language),
  // industry, roles and grade: whatever a person would type to find it.
  const searchHits = useMemo(
    () =>
      searchRows(entities ?? [], search, (e) => {
        const r = roles.data?.get(e.id)
        return [
          e.name,
          e.registration_number,
          e.country_code,
          e.countries?.name_en,
          e.countries?.name_ru,
          e.countries?.name_uz,
          e.industries?.name_en,
          e.industries?.name_ru,
          e.industries?.name_uz,
          r?.is_policyholder ? t('entities.roles.policyholder') : null,
          r?.is_buyer ? t('entities.roles.buyer') : null,
          grades.data?.get(e.id),
        ]
      }),
    [entities, search, roles.data, grades.data, t],
  )
  const filtered = useMemo(
    () =>
      searchHits.filter((e) => {
        const r = roles.data?.get(e.id)
        if (roleChip === 'policyholders' && !r?.is_policyholder) return false
        if (roleChip === 'buyers' && !r?.is_buyer) return false
        return true
      }),
    [searchHits, roleChip, roles.data],
  )

  const filtersActive = roleChip !== 'all'
  const resetFilters = () => setRoleChip('all')
  // "Not in the registry" is a fact about the SEARCH, not about the role
  // switch: a company hidden by it is there, and offering to register it
  // again would make a duplicate. The name offered is the first term.
  const firstTerm = (search.split(',')[0] ?? '').trim()
  const notFound = !isLoading && firstTerm.length >= 3 && searchHits.length === 0

  const latestPeriod = (periods: { period_end_date: string }[]): string | null =>
    periods.length
      ? periods.reduce((a, b) => (a.period_end_date > b.period_end_date ? a : b)).period_end_date
      : null

  const tableColumns = [
    COL.fill,
    '9rem',
    '10rem',
    '13.5rem',
    COL.date,
    COL.grade,
    // 0091: the sanctions screening state, one shield
    SANCTIONS_COLUMN,
    actionsCol([], 1),
  ]
  const columnLabels = [
    t('buyers.fields.name'),
    t('buyers.fields.country'),
    t('buyers.fields.industry'),
    t('entities.rolesHeader'),
    t('buyers.latestStatement'),
    t('limits.fields.grade'),
    t('sanctions.column'),
    '',
  ]
  const SANCTIONS_AT = 6
  const filteredIds = filtered.map((e) => e.id)
  const tableHead = (
    <thead>
      <tr>
        {columnLabels.map((label, i) => (
          <th key={i} className={i === SANCTIONS_AT ? SANCTIONS_CELL : undefined}>
            {i === 0 ? (
              <span className="flex items-center gap-3">
                <SelectCheckbox
                  label={t('ui.bulk.selectAll')}
                  checked={allOf(filteredIds)}
                  onChange={() => toggleAll(filteredIds)}
                />
                {label}
              </span>
            ) : i === SANCTIONS_AT ? (
              <SanctionsColumnHeader />
            ) : label ? (
              label
            ) : (
              <span className="sr-only">{t('common.actions')}</span>
            )}
          </th>
        ))}
      </tr>
    </thead>
  )
  const peek = peekId ? (entities ?? []).find((e) => e.id === peekId) : undefined
  const exportSelected = () => {
    const rows = (entities ?? [])
      .filter((e) => selected.has(e.id))
      .map((e) => {
        const r = roles.data?.get(e.id)
        return [
          e.name,
          e.registration_number,
          refName(e.countries, locale),
          refName(e.industries, locale),
          [
            r?.is_policyholder ? t('entities.roles.policyholder') : null,
            r?.is_buyer ? t('entities.roles.buyer') : null,
          ]
            .filter(Boolean)
            .join(', '),
          latestPeriod(e.financial_statements) ?? '',
          grades.data?.get(e.id) ?? '',
        ]
      })
    downloadCsv('companies.csv', toCsv(columnLabels.slice(0, 6), rows))
  }

  return (
    <div>
      <PageHeader
        band
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
            title={t('data.notFound.title', { query: firstTerm })}
            hint={t(dataDesk ? 'data.notFound.hintDesk' : 'data.notFound.hint')}
            action={
              // One action, the one that fits the person: the data desk
              // registers the company itself (pre-filled with the name),
              // everyone else asks the data desk to.
              dataDesk ? (
                <Button onClick={() => setModalOpen(true)}>
                  <Plus />
                  {t('data.notFound.add', { query: firstTerm })}
                </Button>
              ) : (
                <Button onClick={() => setRequesting(true)}>{t('data.notFound.request')}</Button>
              )
            }
          />
        </Card>
      ) : filtered.length === 0 && (filtersActive || firstTerm !== '') ? (
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
        <EmptyState
          pictogram="companies"
          title={t('entities.empty')}
          hint={t('entities.emptyHint')}
        />
      ) : (
        <Table id="entities" columns={tableColumns} stickyHead freezeFirst>
          {tableHead}
          <tbody>
            {filtered.map((entity) => {
              const latest = latestPeriod(entity.financial_statements)
              const grade = grades.data?.get(entity.id)
              const industry = refName(entity.industries, locale)
              return (
                <LinkRow key={entity.id} to={`/entities/${entity.id}`} className="transition-colors hover:bg-slate-50">
                  <td className="font-medium text-slate-800">
                    <span className="flex min-w-0 items-start gap-3">
                      <SelectCheckbox
                        row
                        label={t('ui.bulk.select', { name: entity.name })}
                        checked={selected.has(entity.id)}
                        onChange={() => toggle(entity.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <Truncate text={entity.name} className="max-w-none">
                          <Highlight text={entity.name} query={search} />
                        </Truncate>
                        <span className="flex min-w-0 items-center gap-2">
                          {entity.registration_number && (
                            // A registration number is one token: never broken.
                            <span className="truncate text-caption font-normal whitespace-nowrap text-slate-500 tabular-nums">
                              <Highlight text={entity.registration_number} query={search} />
                            </span>
                          )}
                          {/* 0094: a policyholder's tier, under the name */}
                          <TierMark entityId={entity.id} size="sm" />
                        </span>
                      </span>
                    </span>
                  </td>
                  <td>
                    <Truncate text={refName(entity.countries, locale)} className="max-w-none">
                      <CountryFlag code={entity.country_code} className="mr-2" />
                      {refName(entity.countries, locale)}
                    </Truncate>
                    {/* Prompt 31: the country's category, or the sanctions
                        badge (the company's or its country's), on a line of
                        its own that is reserved whether or not one arrives. */}
                    <RiskSubline>
                      <CountryRiskCompact countryCode={entity.country_code} entityId={entity.id} />
                    </RiskSubline>
                  </td>
                  <td className="text-slate-500">
                    {industry ? <Truncate text={industry} className="max-w-none" /> : EM_DASH}
                    <RiskSubline>
                      <IndustrySectorBadge industryCode={entity.industry_id} />
                    </RiskSubline>
                  </td>
                  <td>
                    <RoleBadges roles={roles.data?.get(entity.id)} />
                  </td>
                  <td className="whitespace-nowrap text-slate-500">
                    {latest ? formatDate(latest, locale) : EM_DASH}
                  </td>
                  <td>
                    {grade ? (
                      <GradeBadge grade={grade} />
                    ) : (
                      <span className="text-slate-500">{EM_DASH}</span>
                    )}
                  </td>
                  <td className={SANCTIONS_CELL}>
                    <SanctionsCell entityId={entity.id} />
                  </td>
                  <RowActions reveal>
                    <QuickViewButton name={entity.name} onClick={() => setPeekId(entity.id)} />
                  </RowActions>
                </LinkRow>
              )
            })}
          </tbody>
        </Table>
      )}

      <BulkBar count={selected.size} onClear={clear}>
        <Button variant="secondary" size="sm" onClick={exportSelected}>
          {t('ui.bulk.exportCsv')}
        </Button>
      </BulkBar>

      <SidePanel
        open={peek !== undefined}
        title={peek?.name}
        meta={peek?.registration_number}
        onClose={() => setPeekId(null)}
        footer={
          peek && <LinkButton to={`/entities/${peek.id}`}>{t('ui.quickView.openCard')}</LinkButton>
        }
      >
        {peek && (
          <DescriptionList
            items={[
              {
                label: t('buyers.fields.country'),
                value: (
                  <CountryWithRisk
                    countryCode={peek.country_code}
                    entityId={peek.id}
                    name={
                      <span className="inline-flex items-center">
                        <CountryFlag code={peek.country_code} className="mr-2" />
                        {refName(peek.countries, locale)}
                      </span>
                    }
                  />
                ),
              },
              {
                label: t('buyers.fields.industry'),
                value: (
                  <IndustryWithSector
                    industryCode={peek.industry_id}
                    name={refName(peek.industries, locale) || EM_DASH}
                  />
                ),
              },
              {
                label: t('entities.rolesHeader'),
                value: <RoleBadges roles={roles.data?.get(peek.id)} />,
              },
              {
                label: t('buyers.latestStatement'),
                value: (() => {
                  const latest = latestPeriod(peek.financial_statements)
                  return latest ? formatDate(latest, locale) : EM_DASH
                })(),
              },
              {
                label: t('limits.fields.grade'),
                value: grades.data?.get(peek.id) ? (
                  <GradeBadge grade={grades.data.get(peek.id)} />
                ) : (
                  EM_DASH
                ),
              },
            ]}
          />
        )}
      </SidePanel>

      <EntityFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        prefill={firstTerm ? { name: firstTerm } : undefined}
      />
      <RequestEntityModal
        open={requesting}
        initialName={firstTerm}
        onClose={() => setRequesting(false)}
      />
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
