/** «Очередь решений» — the queues over credit limit requests. On the credit
 * desk an open request the caller cannot decide alone is flagged
 * (tci.v_limit_request_queue decides that, not the screen). */

import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  COL,
  EmptyState,
  GradeBadge,
  Highlight,
  Input,
  labelCol,
  Segmented,
  Select,
  SkeletonRows,
  Table,
  Truncate,
} from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { hasRole } from '../../lib/roles'
import { EM_DASH, formatAmount, formatMoment } from '../../lib/format'
import { useLatestGrades } from '../entities/api'
import { useLimitRequests } from './api'
import { REQUEST_AGE_WARN_DAYS, requestAgeDays, statusTone } from './machine'
import { BuyerProposalsSection } from './BuyerProposalsSection'
import { useLimitQueue } from './workbench/api'
import { queueIndex } from './workbench/model'
import type { LimitRequestWithRefs } from './types'
import { useValidationLevels, useValidationState } from './validationApi'
import { levelName } from './levelName'
import type { QueueRow } from './workbench/types'

type QueueTab = 'drafts' | 'information' | 'review' | 'escalated' | 'decided' | 'proposals'
const QUEUE_TABS: readonly QueueTab[] = ['drafts', 'information', 'review', 'escalated', 'decided', 'proposals']

const QUEUE_COLUMNS = [COL.fill, '9.75rem', '9.5rem', labelCol('limitStatus'), '5rem', '4.5rem']

export function LimitsPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()
  const { session, roles } = useAuth()
  // Only those who may decide need the escalated queue (credit underwriting;
  // since 0063 admin decides nothing).
  const canDecide = hasRole(roles, 'credit_underwriter')

  const { data: requests, isLoading } = useLimitRequests()
  const grades = useLatestGrades()
  const queue = useLimitQueue(canDecide)
  const annotated = useMemo(() => queueIndex(queue.data ?? []), [queue.data])
  const [mineOnly, setMineOnly] = useState(false)

  // ?tab= deep-links a queue (the dashboard's escalation signal opens it).
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<QueueTab>(() => {
    const wanted = searchParams.get('tab') as QueueTab | null
    // the escalated queue exists only for those who may decide
    return wanted && QUEUE_TABS.includes(wanted) && (wanted !== 'escalated' || canDecide) ? wanted : 'review'
  })
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const filtered = useMemo(() => {
    const all = requests ?? []
    const uid = session?.user.id
    const inTab = all.filter((r) => {
      switch (tab) {
        case 'drafts':
          return r.status === 'draft' && r.requested_by === uid
        // 0067: waiting for the buyer's data, before anyone may decide
        case 'information':
          return r.status === 'information_gathering'
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
      if (mineOnly && !(annotated.get(r.id)?.decide_alone && !annotated.get(r.id)?.own_request)) return false
      if (!query) return true
      return (
        (r.legal_entities?.name ?? '').toLowerCase().includes(query) ||
        (r.policies?.policy_number ?? '').toLowerCase().includes(query) ||
        (r.policies?.legal_entities?.name ?? '').toLowerCase().includes(query) ||
        (r.insurance_requests?.request_number ?? '').toLowerCase().includes(query) ||
        (r.insurance_requests?.legal_entities?.name ?? '').toLowerCase().includes(query)
      )
    })
  }, [requests, tab, search, statusFilter, mineOnly, annotated, session?.user.id])

  const escalatedCount = (requests ?? []).filter((r) => r.status === 'escalated').length
  const informationCount = (requests ?? []).filter((r) => r.status === 'information_gathering').length
  // 0060/0071: an escalated request may be on validation — with an authority
  // level, or (before 0071) a named colleague.
  const escalatedIds = useMemo(() => filtered.filter((r) => r.status === 'escalated').map((r) => r.id), [filtered])
  const { data: validations } = useValidationState(escalatedIds)
  const { data: validationLevels } = useValidationLevels(escalatedIds)
  const onValidation = useMemo(() => new Map((validations ?? []).map((v) => [v.request_id, v])), [validations])
  const levelOf = useMemo(() => new Map((validationLevels ?? []).map((l) => [l.request_id, l])), [validationLevels])
  const nowIso = new Date().toISOString()

  const tabs = [
    { key: 'drafts', label: t('limits.tabs.drafts') },
    {
      key: 'information',
      label: informationCount ? `${t('limits.tabs.information')} (${informationCount})` : t('limits.tabs.information'),
    },
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

  const showDecision = canDecide && (tab === 'review' || tab === 'escalated')

  return (
    <div>
      {/* No view hint: the section subtitle above already says what this is,
          and repeating it word for word read as a mistake. */}
      <div className="overflow-x-auto">
        <Segmented
          value={tab}
          onChange={(key) => setTab(key as QueueTab)}
          ariaLabel={t('limits.views.queue')}
          options={tabs}
        />
      </div>

      <div className="mt-4 mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('limits.searchPlaceholder')}
          aria-label={t('limits.searchPlaceholder')}
          className="max-w-xs"
        />
        {tab === 'decided' && (
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="max-w-44"
            aria-label={t('limits.fields.status')}
          >
            <option value="">{t('policies.allStatuses')}</option>
            <option value="decided">{t('limits.statuses.decided')}</option>
            <option value="withdrawn">{t('limits.statuses.withdrawn')}</option>
          </Select>
        )}
        {showDecision && (
          <label className="ml-1 inline-flex items-center gap-2 text-small text-slate-600">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(e) => setMineOnly(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-accent-600"
            />
            {t('limits.workbench.queue.mineOnly')}
          </label>
        )}
      </div>

      {tab === 'proposals' ? (
        <BuyerProposalsSection />
      ) : isLoading ? (
        <Table dense columns={QUEUE_COLUMNS}>
          <tbody>
            <SkeletonRows columns={QUEUE_COLUMNS.length} />
          </tbody>
        </Table>
      ) : filtered.length === 0 ? (
        <EmptyState
          pictogram={search.trim() ? 'search' : 'limits'}
          title={t('limits.queueEmpty')}
          hint={t('limits.queueEmptyHint')}
        />
      ) : (
        // Two text columns share what the figures leave (cell-fill) and cut
        // with an ellipsis, so the queue fits a 1280px screen with the
        // sidebar docked instead of scrolling sideways. Dense, like every
        // other table of the credit hub.
        <Table dense id="limits-queue" columns={QUEUE_COLUMNS}>
          <thead>
            <tr>
              <th>{t('limits.fields.buyer')}</th>
              <th>{t('limits.fields.policyAndPolicyholder')}</th>
              {/* w-px: the figure columns keep their content width and leave
                  the rest to the two name columns. */}
              <th className="num">{t('portfolio.credit.amount')}</th>
              <th>{t('limits.fields.status')}</th>
              <th className="num" title={t('limits.ageHint', { days: REQUEST_AGE_WARN_DAYS })}>
                {t('limits.fields.ageDaysUnit')}
              </th>
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
                <td className="font-medium text-slate-800">
                  <Truncate text={r.legal_entities?.name} className="max-w-none">
                    {r.legal_entities?.name ? <Highlight text={r.legal_entities.name} query={search} /> : EM_DASH}
                  </Truncate>
                </td>
                <td>
                  <ScopeCell request={r} />
                </td>
                <td className="num">
                  {formatAmount(Number(r.requested_amount), locale)} {r.currency_code}
                </td>
                {/* The authority exception sits under the status: a column of
                    its own left the buyer's name a few letters on a laptop. */}
                <td>
                  {onValidation.has(r.id) ? (
                    <span title={t('limits.validation.onValidationWith', {
                      name: levelOf.get(r.id)
                        ? levelName(
                            t,
                            onValidation.get(r.id)?.stream ?? 'credit',
                            levelOf.get(r.id)?.rank ?? null,
                            levelOf.get(r.id)?.is_committee ?? false,
                          )
                        : (onValidation.get(r.id)?.validator_name ?? EM_DASH),
                      date: formatMoment(onValidation.get(r.id)?.since ?? r.created_at, locale),
                    })}>
                      <Badge tone="warn">{t('limits.validation.badge')}</Badge>
                    </span>
                  ) : (
                    <Badge tone={statusTone(r.status)}>{t(`limits.statuses.${r.status}`)}</Badge>
                  )}
                  {showDecision && (
                    <span className="mt-1 block">
                      <AuthorityCell row={annotated.get(r.id)} />
                    </span>
                  )}
                </td>
                <td className="num">
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

/** Where the limit would sit: the policy and its policyholder, or — before a
 * policy exists — the submission and its applicant, linking to the
 * submission. One column, two lines, instead of two half-empty columns. */
function ScopeCell({ request }: { request: LimitRequestWithRefs }) {
  const { t } = useTranslation()
  const policy = request.policies
  const submission = request.insurance_requests
  if (policy) {
    return (
      <>
        <span className="block whitespace-nowrap text-slate-700">{policy.policy_number}</span>
        <Truncate text={policy.legal_entities?.name} className="max-w-none text-caption text-slate-500">
          {policy.legal_entities?.name ?? EM_DASH}
        </Truncate>
      </>
    )
  }
  if (submission && request.insurance_request_id) {
    return (
      <>
        <Link
          to={`/requests/${request.insurance_request_id}`}
          onClick={(e) => e.stopPropagation()}
          title={t('limits.preBindScope')}
          className="block whitespace-nowrap text-accent-600 hover:text-accent-500"
        >
          {submission.request_number}
        </Link>
        <Truncate text={submission.legal_entities?.name} className="max-w-none text-caption text-slate-500">
          {submission.legal_entities?.name ?? EM_DASH}
        </Truncate>
      </>
    )
  }
  return <span className="text-slate-500">{EM_DASH}</span>
}

function AgeCell({ days }: { days: number | null }) {
  const { t } = useTranslation()
  if (days === null) return <span className="text-slate-500">{EM_DASH}</span>
  const late = days > REQUEST_AGE_WARN_DAYS
  return (
    <span
      className={late ? 'font-medium text-warn-500' : ''}
      title={late ? t('limits.ageHint', { days: REQUEST_AGE_WARN_DAYS }) : undefined}
    >
      {days}
    </span>
  )
}

/** Only the exception is shown: a request the caller cannot decide alone
 * (it would escalate, or wait for a colleague with more authority in its
 * band), or one whose currency has no rate to compare. Nothing at all when
 * the caller may decide it — printing «Решаю сам» on every row said nothing. */
function AuthorityCell({ row }: { row: QueueRow | undefined }) {
  const { t } = useTranslation()
  if (!row) return null
  // Four eyes first (0063): one's own request is a colleague's to decide,
  // whatever the authority would allow.
  if (row.own_request) {
    return (
      <span title={t('limits.fourEyes.ownRequest')}>
        <Badge tone="neutral">{t('limits.workbench.queue.ownRequest')}</Badge>
      </span>
    )
  }
  if (row.rate_missing) {
    return (
      <span title={t('limits.workbench.queue.noRateHint', { currency: row.currency_code })}>
        <Badge tone="warn">{t('limits.workbench.queue.noRate')}</Badge>
      </span>
    )
  }
  if (row.decide_alone) return null
  return (
    <span title={t('limits.workbench.queue.beyondHint', { band: t(`limits.bands.${row.band}`) })}>
      <Badge tone="warn">{t('limits.workbench.queue.beyond')}</Badge>
    </span>
  )
}

function GradeCell({ grade }: { grade: string | undefined }) {
  if (!grade) return <span className="text-slate-500">{EM_DASH}</span>
  return <GradeBadge grade={grade} />
}
