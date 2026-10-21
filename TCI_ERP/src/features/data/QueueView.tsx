/**
 * «Очередь» — requests for data: mine first, then everyone's open ones, then
 * the closed ones. Below them, the buyers named in insurance submissions that
 * still have no company: the same work arriving from a different door.
 */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../../auth/AuthContext'
import { Badge, Card, EmptyState, Panel, Segmented, Spinner, Table, ViewBar } from '../../components/ui'
import { formatMoment } from '../../lib/format'
import { useAgendaTasks } from '../agenda/api'
import { taskLink } from '../agenda/catalogue'
import { useCountryName } from '../portfolio/useCountryName'
import { useEntityRequests, useStaffDirectory } from './api'
import { STATUS_TONE, isOpen } from './requests'
import { staffName } from './staff'

type Scope = 'mine' | 'open' | 'closed'

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
  const rows = scope === 'mine' ? mine : scope === 'open' ? open : closed
  const unresolvedBuyers = (tasks.data ?? []).filter((task) => task.task_type === 'buyer_needs_entity')

  return (
    <div>
      <ViewBar
        hint={t('data.queue.hint')}
        actions={
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
        }
      />

      {isLoading ? (
        <Spinner />
      ) : !rows.length ? (
        <Card className="p-6">
          <EmptyState
            title={t(`data.queue.empty.${scope}`)}
            hint={t('data.queue.emptyHint')}
          />
        </Card>
      ) : (
        <Table dense>
          <thead>
            <tr>
              <th>№</th>
              <th>{t('data.fields.kind')}</th>
              <th>{t('data.fields.company')}</th>
              <th>{t('data.fields.requestedBy')}</th>
              <th>{t('data.fields.assignedTo')}</th>
              <th>{t('data.fields.createdAt')}</th>
              <th>{t('data.fields.status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">
                  <Link to={`/data/requests/${r.id}`} className="font-medium text-accent-600 hover:underline">
                    {r.request_number}
                  </Link>
                </td>
                <td className="whitespace-nowrap text-slate-600">{t(`data.kinds.${r.kind}`)}</td>
                <td>
                  <span className="font-medium text-slate-800">{r.requested_name}</span>
                  {r.country_code && (
                    <span className="block text-[11.5px] text-slate-500">{countryName(r.country_code)}</span>
                  )}
                </td>
                <td className="text-slate-600">{staffName(staff.data, r.requested_by)}</td>
                <td className="text-slate-600">
                  {r.assigned_to ? staffName(staff.data, r.assigned_to) : (
                    <span className="text-warn-500">{t('data.unassigned')}</span>
                  )}
                </td>
                <td className="whitespace-nowrap text-slate-500">{formatMoment(r.created_at, locale)}</td>
                <td>
                  <Badge tone={STATUS_TONE[r.status]}>{t(`data.statuses.${r.status}`)}</Badge>
                </td>
              </tr>
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
                  className="flex items-baseline justify-between gap-4 border-b border-slate-100 py-2.5 text-[13px] first:pt-0 last:border-b-0"
                >
                  <span className="font-medium text-slate-800">{name}</span>
                  {href ? (
                    <Link to={href} className="text-accent-600 hover:underline">
                      {number ?? t('data.queue.openSubmission')}
                    </Link>
                  ) : (
                    <span className="text-slate-400">{number}</span>
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
