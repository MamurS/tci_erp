/**
 * «Очередь» — requests for data: mine first, then everyone's open ones, then
 * the closed ones. Below them, the buyers named in insurance submissions that
 * still have no company: the same work arriving from a different door.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { usePageSearch } from '../../components/layout/usePageSearch'
import { searchRows } from '../../lib/pageSearch'
import { useAuth } from '../../auth/AuthContext'
import {
  Badge,
  Card,
  COL,
  labelCol,
  LinkRow,
  Panel,
  Segmented,
  SkeletonRows,
  Table,
  TableSettings,
  Truncate,
  ViewBar,
} from '../../components/ui'
import { formatMoment } from '../../lib/format'
import { useAgendaTasks } from '../agenda/api'
import { taskLink } from '../agenda/catalogue'
import { useCountryName } from '../portfolio/useCountryName'
import { useEntityRequests, useStaffDirectory } from './api'
import { STATUS_TONE, isOpen } from './requests'
import { staffName } from './staff'

type Scope = 'mine' | 'open' | 'closed'

const COLUMNS = [COL.code, labelCol('dataKind'), COL.fill, COL.person, COL.person, COL.moment, labelCol('dataStatus')]

export function QueueView() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { session } = useAuth()
  const me = session?.user.id
  const countryName = useCountryName()
  const { data, isLoading } = useEntityRequests()
  const staff = useStaffDirectory()
  const tasks = useAgendaTasks()
  const [scope, setScope] = useState<Scope>('mine')

  const all = useMemo(() => data ?? [], [data])
  const mine = all.filter((r) => isOpen(r.status) && r.assigned_to === me)
  const open = all.filter((r) => isOpen(r.status))
  const closed = all.filter((r) => !isOpen(r.status))
  // The one search (top bar, lib/pageSearch.ts).
  const { query: search } = usePageSearch('data')
  const rows = searchRows(scope === 'mine' ? mine : scope === 'open' ? open : closed, search, (r) => [
    r.request_number,
    r.requested_name,
    r.registration_number,
    r.country_code,
    r.status,
  ])
  // Only the buyers named in SUBMISSIONS: a client's proposed buyer opens the
  // same task type but hangs off the proposal, and has a view of its own
  // («Предложенные байеры»).
  const unresolvedBuyers = (tasks.data ?? []).filter(
    (task) => task.task_type === 'buyer_needs_entity' && task.object_type === 'insurance_request',
  )

  const columnLabels = [
    t('data.fields.number'),
    t('data.fields.kind'),
    t('data.fields.company'),
    t('data.fields.requestedBy'),
    t('data.fields.assignedTo'),
    t('data.fields.createdAt'),
    t('data.fields.status'),
  ]
  const tableHead = (
    <thead>
      <tr>
        {columnLabels.map((label, i) => (
          <th key={i}>{label}</th>
        ))}
      </tr>
    </thead>
  )

  return (
    <div>
      <ViewBar
        hint={t('data.queue.hint')}
        actions={
          <>
            <Segmented
              value={scope}
              onChange={(key) => setScope(key as Scope)}
              ariaLabel={t('data.queue.scope')}
              options={[
                { key: 'mine', label: `${t('data.queue.mine')} · ${mine.length}` },
                { key: 'open', label: `${t('data.queue.open')} · ${open.length}` },
                { key: 'closed', label: `${t('data.queue.closed')} · ${closed.length}` },
              ]}
            />
            <TableSettings table="data-queue" columns={columnLabels} />
          </>
        }
      />

      {isLoading ? (
        <Table id="data-queue" columns={COLUMNS}>
          {tableHead}
          <tbody>
            <SkeletonRows columns={COLUMNS.length} />
          </tbody>
        </Table>
      ) : !rows.length ? (
        // Compact: an empty scope is a fact, not a page — it must not push the
        // list of unresolved buyers below the fold. Each scope says its own.
        <Card className="px-5 py-4">
          <p className="text-body font-semibold text-slate-800">{t(`data.queue.empty.${scope}`)}</p>
          <p className="mt-0.5 text-small text-slate-500">{t(`data.queue.emptyHints.${scope}`)}</p>
        </Card>
      ) : (
        // A registry (Table v2): the person's row density and columns, a head
        // that stays in view, the number column frozen.
        <Table id="data-queue" columns={COLUMNS} stickyHead freezeFirst>
          {tableHead}
          <tbody>
            {rows.map((r) => (
              // The row opens the request (and is what a keyboard reaches);
              // the company, once there is one, opens the company.
              <LinkRow key={r.id} to={`/data/requests/${r.id}`} className="transition-colors hover:bg-slate-50">
                <td className="whitespace-nowrap font-medium text-slate-800">{r.request_number}</td>
                <td className="whitespace-nowrap text-slate-600">{t(`data.kinds.${r.kind}`)}</td>
                <td>
                  {r.entity_id && r.requested_name ? (
                    <Truncate text={r.requested_name} className="max-w-none">
                      <Link to={`/entities/${r.entity_id}`} className="font-medium text-accent-600 hover:underline">
                        {r.requested_name}
                      </Link>
                    </Truncate>
                  ) : (
                    <Truncate text={r.requested_name} className="max-w-none font-medium text-slate-800" />
                  )}
                  {r.country_code && (
                    <span className="block text-caption text-slate-500">{countryName(r.country_code)}</span>
                  )}
                </td>
                <td className="text-slate-600">
                  <Truncate text={staffName(staff.data, r.requested_by)} className="max-w-none" />
                </td>
                <td className="text-slate-600">
                  {r.assigned_to ? (
                    <Truncate text={staffName(staff.data, r.assigned_to)} className="max-w-none" />
                  ) : (
                    <span className="text-warn-500">{t('data.unassigned')}</span>
                  )}
                </td>
                <td className="whitespace-nowrap text-slate-500">{formatMoment(r.created_at, locale)}</td>
                <td>
                  <Badge tone={STATUS_TONE[r.status]}>{t(`data.statuses.${r.status}`)}</Badge>
                </td>
              </LinkRow>
            ))}
          </tbody>
        </Table>
      )}

      {unresolvedBuyers.length > 0 && (
        <Panel className="mt-5" title={t('data.queue.buyersTitle')} hint={t('data.queue.buyersHint')}>
          <ul>
            {unresolvedBuyers.map((task) => {
              const href = taskLink(task)
              const name = typeof task.params?.name === 'string' ? task.params.name : '—'
              const number = typeof task.params?.request_number === 'string' ? task.params.request_number : null
              return (
                <li
                  key={task.id}
                  data-layout-row
                  className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-3 text-small first:pt-0 last:border-b-0"
                >
                  <span className="min-w-0 truncate font-medium text-slate-800" title={name}>
                    {name}
                  </span>
                  {/* One label everywhere: the submission it came from. */}
                  {href ? (
                    <Link to={href} className="shrink-0 whitespace-nowrap text-accent-600 hover:underline">
                      {number ? t('data.queue.submissionLink', { number }) : t('data.queue.openSubmission')}
                    </Link>
                  ) : (
                    number && (
                      <span className="shrink-0 whitespace-nowrap text-slate-500">
                        {t('data.queue.submissionLink', { number })}
                      </span>
                    )
                  )}
                </li>
              )
            })}
          </ul>
        </Panel>
      )}
    </div>
  )
}
