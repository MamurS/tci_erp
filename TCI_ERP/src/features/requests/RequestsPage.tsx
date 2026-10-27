/** Submissions queue: status tabs over tci.insurance_requests, grouped by
 * the department the ball is currently with. A registry (Table v2): the
 * person's row density and columns, the search marked in the rows. */

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  COL,
  EmptyState,
  Highlight,
  labelCol,
  LinkRow,
  PageHeader,
  SkeletonRows,
  Table,
  TableSettings,
  Tabs,
  Truncate,
} from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { usePageSearch } from '../../components/layout/usePageSearch'
import { searchRows } from '../../lib/pageSearch'
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

/* The buyers count is sized for its header, not its digits: «BAYERLAR» is
   one word that cannot wrap. */
const COLUMNS = [COL.code, COL.fill, '7.5rem', labelCol('requestStatus'), '12rem', COL.count]

export function RequestsPage() {
  const { t } = useTranslation()
  const { session, roles } = useAuth()

  const { data: requests, isLoading } = useInsuranceRequests()
  const [tab, setTab] = useState<QueueTab>('open')
  // The one search (top bar, lib/pageSearch.ts).
  const { query: search, setQuery: setSearch } = usePageSearch('requests')
  const [createOpen, setCreateOpen] = useState(false)

  const filtered = useMemo(() => {
    const all = requests ?? []
    const uid = session?.user.id
    const inTab = all.filter((r) => {
      if (!TAB_STATUSES[tab].includes(r.status)) return false
      return tab === 'mine' ? r.created_by === uid : true
    })
    return searchRows(inTab, search, (r) => [
      r.request_number,
      r.legal_entities?.name,
      r.status,
      t(`requests.statuses.${r.status}`),
    ])
  }, [requests, tab, search, session?.user.id, t])

  const openCount = (requests ?? []).filter((r) => TAB_STATUSES.open.includes(r.status)).length
  const nowIso = new Date().toISOString()

  const tabs = [
    { key: 'mine', label: t('requests.tabs.mine') },
    { key: 'open', label: t('requests.tabs.open'), count: openCount || null },
    { key: 'withClient', label: t('requests.tabs.withClient') },
    { key: 'closed', label: t('requests.tabs.closed') },
  ]

  const columnLabels = [
    t('requests.fields.number'),
    t('requests.fields.applicant'),
    t('requests.fields.buyersCount'),
    t('requests.fields.status'),
    t('requests.fields.waitingOn'),
    t('requests.fields.ageDays'),
  ]
  const tableHead = (
    <thead>
      <tr>
        <th>{columnLabels[0]}</th>
        <th>{columnLabels[1]}</th>
        <th className="num">{columnLabels[2]}</th>
        <th>{columnLabels[3]}</th>
        <th>{columnLabels[4]}</th>
        <th className="num">{columnLabels[5]}</th>
      </tr>
    </thead>
  )

  return (
    <div>
      <PageHeader
        band
        title={t('nav.requests')}
        subtitle={t('requests.subtitle')}
        actions={
          canCreateSubmission(roles) && (
            <Button onClick={() => setCreateOpen(true)}>{t('requests.actions.create')}</Button>
          )
        }
      />

      <Tabs tabs={tabs} active={tab} onChange={(key) => setTab(key as QueueTab)} />

      {/* Searching is the top-bar field's; the table's settings stay here. */}
      <div className="mt-4 mb-4 flex items-center justify-end gap-2">
        <TableSettings table="requests" columns={columnLabels} />
      </div>

      {isLoading ? (
        <Table id="requests" columns={COLUMNS}>
          {tableHead}
          <tbody>
            <SkeletonRows columns={COLUMNS.length} />
          </tbody>
        </Table>
      ) : filtered.length === 0 ? (
        // A search that found nothing says so, and offers to clear it.
        search.trim() ? (
          <EmptyState
            pictogram="search"
            title={t('common.noMatches')}
            hint={t('common.noMatchesHint')}
            action={
              <Button variant="secondary" onClick={() => setSearch('')}>
                {t('common.resetFilters')}
              </Button>
            }
          />
        ) : (
          <EmptyState pictogram="inbox" title={t('requests.queueEmpty')} hint={t('requests.queueEmptyHint')} />
        )
      ) : (
        <Table id="requests" columns={COLUMNS} stickyHead freezeFirst>
          {tableHead}
          <tbody>
            {filtered.map((r) => (
              // The row opens the submission; the applicant opens the company.
              <LinkRow key={r.id} to={`/requests/${r.id}`} className="transition-colors hover:bg-slate-50">
                <td className="font-medium whitespace-nowrap text-slate-800 tabular-nums">
                  <Highlight text={r.request_number} query={search} />
                </td>
                <td className="text-slate-700">
                  <Truncate text={r.legal_entities?.name} className="max-w-none">
                    {r.legal_entities?.name ? (
                      <Link to={`/entities/${r.entity_id}`} className="text-accent-600 hover:text-accent-500">
                        <Highlight text={r.legal_entities.name} query={search} />
                      </Link>
                    ) : (
                      EM_DASH
                    )}
                  </Truncate>
                </td>
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
              </LinkRow>
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
  if (!role) return <span className="text-slate-500">{EM_DASH}</span>
  return <Truncate text={t(`roles.${role}`)} className="max-w-none" />
}

function AgeCell({ days }: { days: number | null }) {
  if (days === null) return <span className="num block text-slate-500">{EM_DASH}</span>
  return <span className={`num block ${days > 10 ? 'text-warn-500' : ''}`}>{days}</span>
}
