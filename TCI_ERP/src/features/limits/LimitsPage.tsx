/** Limits workspace: queue tabs over credit limit requests. */

import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
  Tabs,
} from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { hasRole } from '../../lib/roles'
import { EM_DASH, formatAmount } from '../../lib/format'
import { gradeTone } from '../../lib/grade'
import { useLatestGrades } from '../entities/api'
import { useLimitRequests } from './api'
import { requestAgeDays, statusTone } from './machine'
import { BuyerProposalsSection } from './BuyerProposalsSection'

type QueueTab = 'drafts' | 'review' | 'escalated' | 'decided' | 'proposals'

export function LimitsPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()
  const { session, roles } = useAuth()
  // Only those who may decide need the escalated queue.
  const canDecide = hasRole(roles, 'admin', 'credit_underwriter')

  const { data: requests, isLoading } = useLimitRequests()
  const grades = useLatestGrades()

  const [tab, setTab] = useState<QueueTab>('review')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const filtered = useMemo(() => {
    const all = requests ?? []
    const uid = session?.user.id
    const inTab = all.filter((r) => {
      switch (tab) {
        case 'drafts':
          return r.status === 'draft' && r.requested_by === uid
        case 'review':
          return r.status === 'submitted' || r.status === 'under_review'
        case 'escalated':
          return r.status === 'escalated'
        case 'decided':
          return r.status === 'decided' || r.status === 'withdrawn'
      }
    })
    const query = search.trim().toLowerCase()
    return inTab.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false
      if (!query) return true
      return (
        (r.legal_entities?.name ?? '').toLowerCase().includes(query) ||
        (r.policies?.policy_number ?? '').toLowerCase().includes(query) ||
        (r.policies?.legal_entities?.name ?? '').toLowerCase().includes(query)
      )
    })
  }, [requests, tab, search, statusFilter, session?.user.id])

  const escalatedCount = (requests ?? []).filter((r) => r.status === 'escalated').length
  const nowIso = new Date().toISOString()

  const tabs = [
    { key: 'drafts', label: t('limits.tabs.drafts') },
    { key: 'review', label: t('limits.tabs.review') },
    ...(canDecide
      ? [{
          key: 'escalated',
          label: escalatedCount
            ? `${t('limits.tabs.escalated')} (${escalatedCount})`
            : t('limits.tabs.escalated'),
        }]
      : []),
    { key: 'decided', label: t('limits.tabs.decided') },
    // Buyers a client named that we could not identify. Everyone who can
    // resolve one can see the queue; the button itself is role-gated.
    { key: 'proposals', label: t('limits.tabs.proposals') },
  ]

  return (
    <div>
      <PageHeader title={t('nav.limits')} subtitle={t('limits.subtitle')} />

      <Tabs tabs={tabs} active={tab} onChange={(key) => setTab(key as QueueTab)} />

      <div className="mt-4 mb-4 flex flex-wrap gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('limits.searchPlaceholder')}
          className="max-w-xs"
        />
        {tab === 'decided' && (
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="max-w-44"
          >
            <option value="">{t('policies.allStatuses')}</option>
            <option value="decided">{t('limits.statuses.decided')}</option>
            <option value="withdrawn">{t('limits.statuses.withdrawn')}</option>
          </Select>
        )}
      </div>

      {tab === 'proposals' ? (
        <BuyerProposalsSection />
      ) : isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : filtered.length === 0 ? (
        <EmptyState title={t('limits.queueEmpty')} hint={t('limits.queueEmptyHint')} />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>{t('limits.fields.buyer')}</th>
              <th>{t('policies.fields.policyNumber')}</th>
              <th>{t('policies.fields.policyholder')}</th>
              <th className="text-right">{t('limits.fields.requestedAmount')}</th>
              <th>{t('limits.fields.status')}</th>
              <th className="text-right">{t('limits.fields.ageDays')}</th>
              <th>{t('limits.fields.grade')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.id}
                onClick={() => void navigate(`/limits/${r.id}`)}
                className="cursor-pointer transition-colors hover:bg-slate-50"
              >
                <td className="font-medium text-slate-800">{r.legal_entities?.name ?? EM_DASH}</td>
                <td className="text-slate-600">{r.policies?.policy_number ?? EM_DASH}</td>
                <td className="text-slate-500">{r.policies?.legal_entities?.name ?? EM_DASH}</td>
                <td>
                  <span className="num block">
                    {formatAmount(Number(r.requested_amount), locale)} {r.currency_code}
                  </span>
                </td>
                <td>
                  <Badge tone={statusTone(r.status)}>{t(`limits.statuses.${r.status}`)}</Badge>
                </td>
                <td>
                  <AgeCell days={requestAgeDays(r.submitted_at, nowIso)} />
                </td>
                <td>
                  <GradeCell grade={grades.data?.get(r.entity_id)} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}

function AgeCell({ days }: { days: number | null }) {
  if (days === null) return <span className="num block text-slate-400">{EM_DASH}</span>
  return <span className={`num block ${days > 5 ? 'text-warn-500' : ''}`}>{days}</span>
}

function GradeCell({ grade }: { grade: string | undefined }) {
  if (!grade) return <span className="text-slate-400">{EM_DASH}</span>
  return <Badge tone={gradeTone(grade)}>{grade}</Badge>
}
