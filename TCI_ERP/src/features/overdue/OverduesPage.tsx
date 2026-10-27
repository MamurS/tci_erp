/**
 * «Уведомления о просрочке» — the open NOA queue, aged.
 *
 * Two facts have to hit the reader before anything else: how long the account
 * has been overdue, and whether the notification itself was LATE. A late NOA
 * can prejudice cover, so it is flagged in red — this one really is an error
 * condition, not a warning.
 *
 * A registry (Table v2): the person's row density and columns, a head that
 * stays in view, the buyer column frozen.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { usePageSearch } from '../../components/layout/usePageSearch'
import { searchRows } from '../../lib/pageSearch'
import {
  Badge,
  COL,
  EmptyState,
  labelCol,
  LinkRow,
  PageHeader,
  Segmented,
  SkeletonRows,
  Table,
  TableSettings,
  Truncate,
} from '../../components/ui'
import { formatAmount } from '../../lib/format'
import { useOverdueNotifications } from './api'
import type { NoaStatus } from './types'

const STATUS_TONE: Record<NoaStatus, 'warn' | 'pos' | 'negStrong' | 'neutral'> = {
  open: 'warn',
  resolved_paid: 'pos',
  escalated_to_claim: 'negStrong',
  withdrawn: 'neutral',
}

const COLUMNS = [COL.fill, COL.fill, '10.5rem', '7rem', labelCol('overdueReported'), labelCol('overdueStatus')]

export function OverduesPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const [status, setStatus] = useState<'' | NoaStatus>('open')
  const { data, isLoading, isError } = useOverdueNotifications()

  // The one search (top bar, lib/pageSearch.ts); «open» or «all» is a view.
  const { query: search } = usePageSearch('overdues')
  const rows = useMemo(
    () =>
      searchRows(
        (data ?? []).filter((n) => !status || n.status === status),
        search,
        (n) => [n.buyer_name, n.policyholder_name, n.policy_number, n.status, t(`overdues.statuses.${n.status}`)],
      ),
    [data, status, search, t],
  )

  const columnLabels = [
    t('limits.fields.buyer'),
    t('policies.fields.policyholder'),
    t('overdues.fields.overdueAmount'),
    t('overdues.fields.pastDueColumn'),
    t('overdues.fields.reported'),
    t('overdues.fields.status'),
  ]
  const tableHead = (
    <thead>
      <tr>
        <th>{columnLabels[0]}</th>
        <th>{columnLabels[1]}</th>
        <th className="num">{columnLabels[2]}</th>
        {/* The unit is in each cell; what the count runs from on hover. */}
        <th className="num" title={t('overdues.pastDueHint')}>
          {columnLabels[3]}
        </th>
        <th>{columnLabels[4]}</th>
        <th>{columnLabels[5]}</th>
      </tr>
    </thead>
  )

  return (
    <div>
      <PageHeader
        title={t('overdues.title')}
        subtitle={t('overdues.subtitle')}
        actions={
          <div className="flex items-end gap-2">
            <Segmented
              ariaLabel={t('overdues.fields.status')}
              value={status === 'open' ? 'open' : 'all'}
              options={[
                { key: 'open', label: t('overdues.statuses.open') },
                { key: 'all', label: t('common.all') },
              ]}
              onChange={(key) => setStatus(key === 'open' ? 'open' : '')}
            />
            <TableSettings table="overdues" columns={columnLabels} />
          </div>
        }
      />

      {isError ? (
        <EmptyState pictogram="error" title={t('common.loadFailed')} hint={t('common.tryAgain')} />
      ) : isLoading ? (
        <Table id="overdues" columns={COLUMNS}>
          {tableHead}
          <tbody>
            <SkeletonRows columns={COLUMNS.length} />
          </tbody>
        </Table>
      ) : rows.length === 0 ? (
        <EmptyState pictogram="inbox" title={t('overdues.empty')} hint={t('overdues.emptyHint')} />
      ) : (
        // Two names share what is left; each may narrow to 5.5rem before the
        // table scrolls (the sticky head's scrollbar gutter takes the rest).
        <Table id="overdues" columns={COLUMNS} fillMin="5.5rem" stickyHead freezeFirst>
          {tableHead}
          <tbody>
            {rows.map((n) => (
              // The row opens the notification; the buyer opens the company,
              // the policyholder theirs.
              <LinkRow key={n.id} to={`/overdues/${n.id}`} className="transition-colors hover:bg-slate-50">
                <td className="font-medium">
                  <Truncate text={n.buyer_name} className="max-w-none">
                    <Link to={`/entities/${n.buyer_entity_id}`} className="text-accent-700 hover:underline">
                      {n.buyer_name}
                    </Link>
                  </Truncate>
                </td>
                <td>
                  <Truncate text={n.policyholder_name} className="max-w-none">
                    <Link
                      to={`/entities/${n.policyholder_entity_id}`}
                      className="text-slate-500 hover:text-accent-600 hover:underline"
                    >
                      {n.policyholder_name}
                    </Link>
                  </Truncate>
                </td>
                <td>
                  <span className="num block">
                    {formatAmount(Number(n.overdue_amount), locale)} {n.currency_code}
                  </span>
                </td>
                <td className="num font-medium" title={t('overdues.pastDueHint')}>
                  {t('policies.terms.days', { count: Number(n.days_past_due) })}
                </td>
                <td>
                  {n.reported_late ? (
                    <Badge tone="negStrong">
                      {t('overdues.lateBy', { days: n.days_late })}
                    </Badge>
                  ) : (
                    <span className="text-small text-slate-500">
                      {t('overdues.onTime')}
                    </span>
                  )}
                </td>
                <td>
                  <Badge tone={STATUS_TONE[n.status]}>{t(`overdues.statuses.${n.status}`)}</Badge>
                </td>
              </LinkRow>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}
