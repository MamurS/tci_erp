/**
 * Admin › Риски › «Ответственные аналитики секторов» (migration 0085,
 * tci.assign_sector_analyst): every sector has one credit analyst who
 * writes its quarterly review. Picking a person saves at once; the open
 * quarterly task follows them. Only people holding the credit analyst role
 * are offered (the database refuses anyone else).
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Callout, Card, COL, EmptyState, SectionTitle, Select, Skeleton, Table } from '../../../components/ui'
import { refusalOr } from '../../../lib/optimistic'
import { refName } from '../../entities/api'
import { useAssignSectorAnalyst, useSectorGrades } from '../../risk/api'
import type { SectorRow } from '../../risk/api'
import { SectorBadge } from '../../risk/badges'
import { useAdminUsers } from '../api'
import { personLabel } from './usePersonName'

export function SectorAnalystsCard() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const sectors = useSectorGrades()
  const { data: users } = useAdminUsers()
  const [error, setError] = useState<string | null>(null)

  const analysts = useMemo(
    () =>
      (users ?? [])
        .filter((u) => u.roles.includes('credit_analyst') && !u.disabled)
        .map((u) => ({ id: u.user_id, name: personLabel(u) }))
        .sort((a, b) => a.name.localeCompare(b.name, locale)),
    [users, locale],
  )
  const nameOf = (id: string) => {
    const u = (users ?? []).find((x) => x.user_id === id)
    return u ? personLabel(u) : '—'
  }

  const rows = [...(sectors.data ?? [])].sort((a, b) => refName(a, locale).localeCompare(refName(b, locale), locale))
  const unassigned = rows.filter((r) => !r.analyst_id).length

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle hint={t('admin.risk.analysts.hint')}>{t('admin.risk.analysts.title')}</SectionTitle>

      {users && analysts.length === 0 && (
        <Callout tone="warn" title={t('admin.risk.analysts.noAnalysts')}>
          {t('admin.risk.analysts.noAnalystsHint')}
        </Callout>
      )}
      {rows.length > 0 && unassigned > 0 && (
        <p className="text-small text-slate-600">{t('admin.risk.analysts.unassigned', { count: unassigned })}</p>
      )}
      {error && <Callout tone="neg" title={error} />}

      {sectors.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : sectors.isError ? (
        <Callout tone="neg" title={t('admin.risk.analysts.loadFailed')} />
      ) : rows.length === 0 ? (
        <EmptyState title={t('admin.risk.analysts.empty')} hint={t('admin.risk.analysts.emptyHint')} />
      ) : (
        <Table dense stickyHead columns={[COL.fill, COL.grade, '18rem']}>
          <thead>
            <tr>
              <th>{t('admin.risk.analysts.columns.sector')}</th>
              <th>{t('admin.risk.analysts.columns.grade')}</th>
              <th>{t('admin.risk.analysts.columns.analyst')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <AnalystRow
                key={row.sector_id}
                row={row}
                name={refName(row, locale)}
                analysts={analysts}
                currentName={row.analyst_id ? nameOf(row.analyst_id) : null}
                onError={setError}
              />
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  )
}

function AnalystRow({
  row,
  name,
  analysts,
  currentName,
  onError,
}: {
  row: SectorRow
  name: string
  analysts: readonly { id: string; name: string }[]
  currentName: string | null
  onError: (message: string | null) => void
}) {
  const { t } = useTranslation()
  const assign = useAssignSectorAnalyst()
  // The person currently responsible stays listed even if they no longer
  // qualify (role removed, account disabled), so the select shows the truth.
  const listed = row.analyst_id !== null && !analysts.some((a) => a.id === row.analyst_id)

  return (
    <tr>
      <td>{name}</td>
      <td>
        {row.grade ? (
          <SectorBadge grade={row.grade} outlook={row.outlook} stale={row.stale} reviewedAt={row.reviewed_at} industryName={name} />
        ) : (
          <span className="text-slate-500">—</span>
        )}
      </td>
      <td className="!overflow-visible">
        <Select
          value={row.analyst_id ?? ''}
          disabled={assign.isPending}
          aria-busy={assign.isPending}
          aria-label={t('admin.risk.analysts.assignFor', { sector: name })}
          onChange={(e) => {
            onError(null)
            assign.mutate(
              { sectorId: row.sector_id, analystId: e.target.value || null },
              { onError: (failure) => onError(t(refusalOr(failure, 'admin.risk.analysts.saveFailed'))) },
            )
          }}
        >
          <option value="">{t('admin.risk.analysts.none')}</option>
          {listed && <option value={row.analyst_id!}>{currentName ?? '—'}</option>}
          {analysts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </td>
    </tr>
  )
}
