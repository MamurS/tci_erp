/** Submissions queue: status tabs over tci.insurance_requests, grouped by
 * the department the ball is currently with. */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, Button, EmptyState, Input, PageHeader, Spinner, Table, Tabs } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { EM_DASH } from '../../lib/format'
import { useInsuranceRequests } from './api'
import { RequestFormModal } from './RequestFormModal'
import { canCreateSubmission, owningRole, requestAgeDays, statusTone } from './machine'
import type { InsuranceRequestStatus, InsuranceRequestWithRefs } from './types'

type QueueTab = 'mine' | 'open' | 'withClient' | 'closed'

/** Which statuses each tab collects. 'mine' additionally filters by author. */
const TAB_STATUSES: Record<QueueTab, readonly InsuranceRequestStatus[]> = {
  mine: ['draft'],
  open: [
    'submitted',
    'entity_resolution',
    'underwriting',
    'commercial_review',
    'sales_confirmation',
  ],
  withClient: ['client_review', 'accepted'],
  closed: ['bound', 'declined', 'withdrawn'],
}

export function RequestsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { session, roles } = useAuth()

  const { data: requests, isLoading } = useInsuranceRequests()
  const [tab, setTab] = useState<QueueTab>('open')
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const filtered = useMemo(() => {
    const all = requests ?? []
    const uid = session?.user.id
    const inTab = all.filter((r) => {
      if (!TAB_STATUSES[tab].includes(r.status)) return false
      return tab === 'mine' ? r.created_by === uid : true
    })
    const query = search.trim().toLowerCase()
    if (!query) return inTab
    return inTab.filter(
      (r) =>
        r.request_number.toLowerCase().includes(query) ||
        (r.legal_entities?.name ?? '').toLowerCase().includes(query),
    )
  }, [requests, tab, search, session?.user.id])

  const openCount = (requests ?? []).filter((r) => TAB_STATUSES.open.includes(r.status)).length
  const nowIso = new Date().toISOString()

  const tabs = [
    { key: 'mine', label: t('requests.tabs.mine') },
    {
      key: 'open',
      label: openCount ? `${t('requests.tabs.open')} (${openCount})` : t('requests.tabs.open'),
    },
    { key: 'withClient', label: t('requests.tabs.withClient') },
    { key: 'closed', label: t('requests.tabs.closed') },
  ]

  return (
    <div>
      <PageHeader
        title={t('nav.requests')}
        subtitle={t('requests.subtitle')}
        actions={
          canCreateSubmission(roles) && (
            <Button onClick={() => setCreateOpen(true)}>{t('requests.actions.create')}</Button>
          )
        }
      />

      <Tabs tabs={tabs} active={tab} onChange={(key) => setTab(key as QueueTab)} />

      <div className="mt-4 mb-4">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('requests.searchPlaceholder')}
          className="max-w-xs"
        />
      </div>

      {isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : filtered.length === 0 ? (
        <EmptyState title={t('requests.queueEmpty')} hint={t('requests.queueEmptyHint')} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('requests.fields.number')}</th>
              <th>{t('requests.fields.applicant')}</th>
              <th className="text-right">{t('requests.fields.buyersCount')}</th>
              <th>{t('requests.fields.status')}</th>
              <th>{t('requests.fields.waitingOn')}</th>
              <th className="text-right">{t('requests.fields.ageDays')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.id}
                onClick={() => void navigate(`/requests/${r.id}`)}
                className="cursor-pointer transition-colors hover:bg-slate-50"
              >
                <td className="num font-medium text-slate-800">{r.request_number}</td>
                <td className="text-slate-700">{r.legal_entities?.name ?? EM_DASH}</td>
                <td className="num">{r.insurance_request_buyers?.length ?? 0}</td>
                <td>
                  <Badge tone={statusTone(r.status)}>{t(`requests.statuses.${r.status}`)}</Badge>
                </td>
                <td className="text-slate-500">
                  <WaitingOn request={r} />
                </td>
                <td>
                  <AgeCell days={requestAgeDays(r.submitted_at, nowIso)} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <RequestFormModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  )
}

function WaitingOn({ request }: { request: InsuranceRequestWithRefs }) {
  const { t } = useTranslation()
  const role = owningRole(request.status)
  if (!role) return <span className="text-slate-300">{EM_DASH}</span>
  return <span>{t(`roles.${role}`)}</span>
}

function AgeCell({ days }: { days: number | null }) {
  if (days === null) return <span className="num block text-slate-400">{EM_DASH}</span>
  return <span className={`num block ${days > 10 ? 'text-warn-500' : ''}`}>{days}</span>
}
