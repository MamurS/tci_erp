/**
 * «Сектора» — every sector (one per industry) with its grade in force and
 * outlook, when it was last reviewed and by whom it is kept, the book in it
 * (companies, buyers with limits, exposure in UZS with the limits whose
 * currency has no rate counted apart) and what needs attention: a review
 * from an earlier quarter, this quarter's review overdue, a review waiting
 * for a second analyst. A row opens the sector. Admin names the responsible
 * analyst; nobody else may.
 */

import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import {
  Button,
  Callout,
  Card,
  COL,
  EmptyState,
  Field,
  Highlight,
  LinkRow,
  Modal,
  RowActions,
  Segmented,
  Select,
  SkeletonRows,
  Table,
  ViewBar,
} from '../../components/ui'
import { usePageSearch } from '../../components/layout/usePageSearch'
import { formatAmount, formatDate } from '../../lib/format'
import { searchRows } from '../../lib/pageSearch'
import { refusalKey } from '../../lib/refusals'
import { useStaffDirectory } from '../data/api'
import { staffName } from '../data/staff'
import { useAssignSectorAnalyst, useSectorGrades } from '../risk/api'
import { SectorStateBadges } from './SectorStateBadges'
import type { SectorRow } from '../risk/api'
import { SectorBadge } from '../risk/badges'
import { SECTOR_FILTERS, analystCandidates, filterCounts, filterSectors, industryName, mayAssignAnalyst, parseSectorFilter, uiLang } from './model'
import type { SectorFilter } from './model'

export function SectorListView() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const lang = uiLang(locale)
  const { actingRole } = useAuth()
  const [params, setParams] = useSearchParams()
  const filter = parseSectorFilter(params.get('filter'))
  const { query } = usePageSearch('sectors')
  const { data, isLoading } = useSectorGrades()
  const staff = useStaffDirectory()
  const admin = mayAssignAnalyst(actingRole)
  const [assigning, setAssigning] = useState<SectorRow | null>(null)

  const all = useMemo(() => data ?? [], [data])
  // The one search (top bar): the sector in any language, its code, the analyst.
  const searched = useMemo(
    () =>
      searchRows(all, query, (r) => [
        r.name_en,
        r.name_ru,
        r.name_uz,
        r.industry_code,
        r.grade,
        r.analyst_id ? staffName(staff.data, r.analyst_id) : null,
      ]),
    [all, query, staff.data],
  )
  const counts = filterCounts(searched)
  const rows = useMemo(
    () =>
      filterSectors(searched, filter).sort((a, b) => industryName(a, lang).localeCompare(industryName(b, lang), locale)),
    [searched, filter, lang, locale],
  )
  const graded = all.some((r) => r.grade !== null)

  const setFilter = (next: SectorFilter) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (next === 'all') p.delete('filter')
        else p.set('filter', next)
        return p
      },
      { replace: true },
    )

  const columns = [COL.fill, '6rem', COL.date, COL.person, COL.count, COL.count, '12rem', '12rem', ...(admin ? ['11rem'] : [])]
  const head = (
    <thead>
      <tr>
        <th>{t('risk.sectors.fields.sector')}</th>
        <th>{t('risk.sectors.fields.grade')}</th>
        <th>{t('risk.sectors.fields.reviewed')}</th>
        <th>{t('risk.sectors.fields.analyst')}</th>
        <th className="num">{t('risk.sectors.fields.companies')}</th>
        <th className="num">{t('risk.sectors.fields.buyersWithLimits')}</th>
        <th className="num">{t('risk.sectors.fields.exposure')}</th>
        <th>{t('risk.sectors.fields.state')}</th>
        {admin && (
          <th>
            <span className="sr-only">{t('common.actions')}</span>
          </th>
        )}
      </tr>
    </thead>
  )

  return (
    <div>
      <ViewBar
        hint={t('risk.sectors.list.hint')}
        actions={
          all.length ? (
            <Segmented
              value={filter}
              onChange={(key) => setFilter(key as SectorFilter)}
              ariaLabel={t('risk.sectors.filters.label')}
              options={SECTOR_FILTERS.map((f) => ({ key: f, label: `${t(`risk.sectors.filters.${f}`)} · ${counts[f]}` }))}
            />
          ) : undefined
        }
      />

      {isLoading ? (
        <Table id="sectors" columns={columns}>
          {head}
          <tbody>
            <SkeletonRows columns={columns.length} />
          </tbody>
        </Table>
      ) : !all.length ? (
        <Card className="p-6">
          <EmptyState pictogram="chart" title={t('risk.sectors.list.noSectors')} hint={t('risk.sectors.list.noSectorsHint')} />
        </Card>
      ) : (
        <div className="grid gap-4">
          {!graded && (
            <Callout tone="info" title={t('risk.sectors.list.noneGraded')}>
              {t(admin ? 'risk.sectors.list.noneGradedAdmin' : 'risk.sectors.list.noneGradedHint')}
            </Callout>
          )}
          {!rows.length ? (
            <Card className="p-6">
              <EmptyState
                pictogram="search"
                title={t('common.noMatches')}
                hint={t('common.noMatchesHint')}
                action={
                  filter !== 'all' ? (
                    <Button variant="secondary" onClick={() => setFilter('all')}>
                      {t('common.resetFilters')}
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          ) : (
            <Table id="sectors" columns={columns} stickyHead>
              {head}
              <tbody>
                {rows.map((r) => (
                  <LinkRow key={r.sector_id} to={`/sectors/${r.sector_id}`}>
                    <td>
                      <Link to={`/sectors/${r.sector_id}`} className="block truncate font-medium text-accent-600 hover:underline">
                        <Highlight text={industryName(r, lang)} query={query} />
                      </Link>
                      <span className="block truncate font-mono text-caption text-slate-500">{r.industry_code}</span>
                    </td>
                    <td>
                      {r.grade ? (
                        <SectorBadge
                          grade={r.grade}
                          outlook={r.outlook}
                          stale={r.stale}
                          reviewedAt={r.reviewed_at}
                          industryName={industryName(r, lang)}
                        />
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="text-slate-600">{r.reviewed_at ? formatDate(r.reviewed_at, locale) : '—'}</td>
                    <td className="text-slate-600">
                      {r.analyst_id ? (
                        staffName(staff.data, r.analyst_id)
                      ) : (
                        <span className="text-slate-500">{t('risk.sectors.list.noAnalyst')}</span>
                      )}
                    </td>
                    <td className="num">{formatAmount(r.companies, locale)}</td>
                    <td className="num">{formatAmount(r.buyers_with_limits, locale)}</td>
                    <td className="num whitespace-normal">
                      {r.buyers_with_limits > 0 || r.exposure_missing_rates > 0 ? formatAmount(r.exposure_uzs, locale) : '—'}
                      {r.exposure_missing_rates > 0 && (
                        <span className="block text-caption text-warning-700">
                          {t('risk.sectors.missingRates', { count: r.exposure_missing_rates })}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-normal">
                      <SectorStateBadges row={r} />
                    </td>
                    {admin && (
                      <RowActions reveal>
                        <Button size="sm" variant="secondary" onClick={() => setAssigning(r)}>
                          {t('risk.sectors.assign.action')}
                        </Button>
                      </RowActions>
                    )}
                  </LinkRow>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      )}

      {admin && assigning && (
        <AssignAnalystModal sector={assigning} onClose={() => setAssigning(null)} />
      )}
    </div>
  )
}

function AssignAnalystModal({ sector, onClose }: { sector: SectorRow; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const lang = uiLang(i18n.resolvedLanguage)
  const staff = useStaffDirectory()
  const assign = useAssignSectorAnalyst()
  const candidates = analystCandidates(staff.data?.values())
  const [analyst, setAnalyst] = useState<string>(sector.analyst_id ?? '')
  const [error, setError] = useState<string | null>(null)

  const save = () => {
    setError(null)
    assign
      .mutateAsync({ sectorId: sector.sector_id, analystId: analyst || null })
      .then(onClose)
      .catch((e: unknown) => setError(t(refusalKey(e))))
  }

  return (
    <Modal
      open
      title={t('risk.sectors.assign.title', { sector: industryName(sector, lang) })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={assign.isPending} disabled={analyst === (sector.analyst_id ?? '')} onClick={save}>
            {analyst ? t('risk.sectors.assign.submit') : t('risk.sectors.assign.clear')}
          </Button>
        </>
      }
    >
      {error && <Callout tone="neg" title={error} />}
      <p className="text-small text-slate-600">{t('risk.sectors.assign.hint')}</p>
      {candidates.length ? (
        <Field label={t('risk.sectors.fields.analyst')}>
          <Select value={analyst} onChange={(e) => setAnalyst(e.target.value)}>
            <option value="">{t('risk.sectors.assign.nobody')}</option>
            {candidates.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.full_name?.trim() || m.email}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Callout tone="warn" title={t('risk.sectors.assign.noCandidates')}>
          {t('risk.sectors.assign.noCandidatesHint')}
        </Callout>
      )}
    </Modal>
  )
}
