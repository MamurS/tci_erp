/** «Очередь решений» — the queues over credit limit requests. On the credit
 * desk an open request the caller cannot decide alone is flagged
 * (tci.v_limit_request_queue decides that, not the screen). */

import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { usePageSearch } from '../../components/layout/usePageSearch'
import { searchRows } from '../../lib/pageSearch'
import {
  actionsCol,
  Badge,
  COL,
  DescriptionList,
  EmptyState,
  GradeBadge,
  Highlight,
  labelCol,
  LinkButton,
  LinkRow,
  QuickViewButton,
  RowActions,
  Segmented,
  SidePanel,
  SkeletonRows,
  Table,
  TableSettings,
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
import { EntityLink } from './workbench/parts'
import { queueIndex } from './workbench/model'
import type { LimitRequestWithRefs } from './types'
import { useValidationLevels, useValidationState } from './validationApi'
import { levelName } from './levelName'
import type { QueueRow } from './workbench/types'

type QueueTab = 'drafts' | 'information' | 'review' | 'escalated' | 'decided' | 'proposals'
const QUEUE_TABS: readonly QueueTab[] = ['drafts', 'information', 'review', 'escalated', 'decided', 'proposals']

// Regular rows pad cells by 1rem a side (the dense ones did by 0.75), so the
// narrow columns hold their longest header word in en / ru / uz.
const QUEUE_COLUMNS = [
  COL.fill,
  '10.75rem',
  '9.5rem',
  labelCol('limitStatus'),
  COL.days,
  '6rem',
  actionsCol([], 1),
]

export function LimitsPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { session, roles } = useAuth()
  // Only those who may decide need the escalated queue (credit underwriting;
  // since 0063 admin decides nothing).
  const canDecide = hasRole(roles, 'credit_underwriter')

  const { data: requests, isLoading } = useLimitRequests()
  const grades = useLatestGrades()
  const queue = useLimitQueue(canDecide)
  const annotated = useMemo(() => queueIndex(queue.data ?? []), [queue.data])
  const [mineOnly, setMineOnly] = useState(false)
  // The quick view: a request's summary beside the queue (Table v2).
  const [peekId, setPeekId] = useState<string | null>(null)

  // ?tab= deep-links a queue (the dashboard's escalation signal opens it).
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState<QueueTab>(() => {
    const wanted = searchParams.get('tab') as QueueTab | null
    // the escalated queue exists only for those who may decide
    return wanted && QUEUE_TABS.includes(wanted) && (wanted !== 'escalated' || canDecide) ? wanted : 'review'
  })
  // The one search (top bar, lib/pageSearch.ts): buyer, policy, policyholder,
  // submission, status — terms separated by commas, in order.
  const { query: search } = usePageSearch('limits')

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
    const mine = inTab.filter(
      (r) => !mineOnly || (annotated.get(r.id)?.decide_alone && !annotated.get(r.id)?.own_request),
    )
    return searchRows(mine, search, (r) => [
      r.legal_entities?.name,
      r.policies?.policy_number,
      r.policies?.legal_entities?.name,
      r.insurance_requests?.request_number,
      r.insurance_requests?.legal_entities?.name,
      r.status,
      t(`limits.statuses.${r.status}`),
      r.currency_code,
    ])
  }, [requests, tab, search, mineOnly, annotated, session?.user.id, t])

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

  const columnLabels = [
    t('limits.fields.buyer'),
    t('limits.fields.policyAndPolicyholder'),
    t('portfolio.credit.amount'),
    t('limits.fields.status'),
    t('limits.fields.ageDaysUnit'),
    t('limits.fields.grade'),
    '',
  ]
  const tableHead = (
    <thead>
      <tr>
        <th>{columnLabels[0]}</th>
        <th>{columnLabels[1]}</th>
        <th className="num">{columnLabels[2]}</th>
        <th>{columnLabels[3]}</th>
        <th className="num" title={t('limits.ageHint', { days: REQUEST_AGE_WARN_DAYS })}>
          {columnLabels[4]}
        </th>
        <th>{columnLabels[5]}</th>
        <th>
          <span className="sr-only">{t('common.actions')}</span>
        </th>
      </tr>
    </thead>
  )
  // The request in the quick view: looked up in everything loaded, so it
  // stays open while a filter hides its row.
  const peek = peekId ? (requests ?? []).find((r) => r.id === peekId) : undefined
  const statusCell = (r: LimitRequestWithRefs) =>
    onValidation.has(r.id) ? (
      <span
        title={t('limits.validation.onValidationWith', {
          name: levelOf.get(r.id)
            ? levelName(
                t,
                onValidation.get(r.id)?.stream ?? 'credit',
                levelOf.get(r.id)?.rank ?? null,
                levelOf.get(r.id)?.is_committee ?? false,
              )
            : (onValidation.get(r.id)?.validator_name ?? EM_DASH),
          date: formatMoment(onValidation.get(r.id)?.since ?? r.created_at, locale),
        })}
      >
        <Badge tone="warn">{t('limits.validation.badge')}</Badge>
      </span>
    ) : (
      <Badge tone={statusTone(r.status)}>{t(`limits.statuses.${r.status}`)}</Badge>
    )

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
        {tab !== 'proposals' && (
          <div className="ml-auto">
            <TableSettings table="limits-queue" columns={columnLabels} />
          </div>
        )}
      </div>

      {tab === 'proposals' ? (
        <BuyerProposalsSection />
      ) : isLoading ? (
        <Table id="limits-queue" columns={QUEUE_COLUMNS}>
          {tableHead}
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
        // sidebar docked instead of scrolling sideways. A registry (Table v2):
        // the person's row density, columns, a head that stays in view.
        <Table id="limits-queue" columns={QUEUE_COLUMNS} stickyHead freezeFirst>
          {tableHead}
          <tbody>
            {filtered.map((r) => (
              // The row opens the request; the buyer opens the company, the
              // policy number the policy, the submission number the submission.
              <LinkRow key={r.id} to={`/limits/${r.id}`} className="transition-colors hover:bg-slate-50">
                <td className="font-medium text-slate-800">
                  <Truncate text={r.legal_entities?.name} className="max-w-none">
                    {r.legal_entities?.name ? (
                      <EntityLink id={r.entity_id} name={r.legal_entities.name}>
                        <Highlight text={r.legal_entities.name} query={search} />
                      </EntityLink>
                    ) : (
                      EM_DASH
                    )}
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
                  {statusCell(r)}
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
                <RowActions reveal>
                  <QuickViewButton
                    name={r.legal_entities?.name ?? EM_DASH}
                    onClick={() => setPeekId(r.id)}
                  />
                </RowActions>
              </LinkRow>
            ))}
          </tbody>
        </Table>
      )}

      <SidePanel
        open={peek !== undefined}
        title={peek?.legal_entities?.name ?? EM_DASH}
        meta={peek && statusCell(peek)}
        onClose={() => setPeekId(null)}
        footer={peek && <LinkButton to={`/limits/${peek.id}`}>{t('limits.quickView.openRequest')}</LinkButton>}
      >
        {peek && (
          <>
            <DescriptionList
              items={[
                {
                  label: t('limits.fields.grade'),
                  value: <GradeCell grade={grades.data?.get(peek.entity_id)} />,
                },
                {
                  label: t('limits.fields.requestedAmount'),
                  value: (
                    <span className="num">
                      {formatAmount(Number(peek.requested_amount), locale)} {peek.currency_code}
                    </span>
                  ),
                },
                {
                  label: t('limits.fields.paymentTerms'),
                  value:
                    peek.requested_payment_terms_days === null ? (
                      EM_DASH
                    ) : (
                      <span className="num">
                        {t('policies.terms.days', { count: peek.requested_payment_terms_days })}
                      </span>
                    ),
                },
                {
                  label: t('limits.fields.policyAndPolicyholder'),
                  value: <ScopeLine request={peek} />,
                },
                {
                  label: t('limits.fields.ageDaysUnit'),
                  value: <AgeCell days={requestAgeDays(peek.submitted_at, nowIso)} />,
                },
                // The authority answer is the database's (v_limit_request_queue),
                // known only for open requests on the credit desk.
                ...(canDecide && annotated.get(peek.id)
                  ? [
                      {
                        label: t('limits.workbench.queue.authority'),
                        value: decidesAlone(annotated.get(peek.id)) ? (
                          t('limits.workbench.queue.alone')
                        ) : (
                          <AuthorityCell row={annotated.get(peek.id)} />
                        ),
                      },
                    ]
                  : []),
              ]}
            />
            {peek.justification && (
              <div className="mt-4">
                <p className="text-caption font-semibold text-slate-600">{t('limits.fields.justification')}</p>
                <p className="mt-1 text-small whitespace-pre-line text-slate-700">{peek.justification}</p>
              </div>
            )}
          </>
        )}
      </SidePanel>
    </div>
  )
}

/** The caller may decide it alone: no exception for AuthorityCell to show. */
function decidesAlone(row: QueueRow | undefined): boolean {
  return Boolean(row && row.decide_alone && !row.own_request && !row.rate_missing)
}

/** The policy (or, before bind, the submission) over its holder, for the
 * quick view. */
function ScopeLine({ request }: { request: LimitRequestWithRefs }) {
  const number = request.policies?.policy_number ?? request.insurance_requests?.request_number
  const holder = request.policies
    ? request.policies.legal_entities?.name
    : request.insurance_requests?.legal_entities?.name
  if (!number) return <>{EM_DASH}</>
  return (
    <>
      <span className="block whitespace-nowrap">{number}</span>
      {holder && <span className="block font-normal text-slate-500">{holder}</span>}
    </>
  )
}

/** Where the limit would sit: the policy and its policyholder, or — before a
 * policy exists — the submission and its applicant, each linking to its own
 * page (the applicant's company is not in the row, so it stays text). One
 * column, two lines, instead of two half-empty columns. */
function ScopeCell({ request }: { request: LimitRequestWithRefs }) {
  const { t } = useTranslation()
  const policy = request.policies
  const submission = request.insurance_requests
  if (policy) {
    return (
      <>
        <Link
          to={`/policies/${request.policy_id}`}
          className="block whitespace-nowrap text-accent-600 hover:text-accent-500"
        >
          {policy.policy_number}
        </Link>
        <Truncate text={policy.legal_entities?.name} className="max-w-none text-caption text-slate-500">
          {policy.legal_entities?.name ? (
            <Link to={`/entities/${policy.entity_id}`} className="text-slate-500 hover:text-accent-600 hover:underline">
              {policy.legal_entities.name}
            </Link>
          ) : (
            EM_DASH
          )}
        </Truncate>
      </>
    )
  }
  if (submission && request.insurance_request_id) {
    return (
      <>
        <Link
          to={`/requests/${request.insurance_request_id}`}
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
