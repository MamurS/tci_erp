/** The claims queue. Ageing, status and amounts, with the files that need
 * attention first: an assessment already running, then a fresh filing, then
 * everything settled or refused. A registry (Table v2): the person's row
 * density and columns, rows picked for a CSV export, and a claim's summary
 * in a quick view beside the queue. */

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { usePageSearch } from '../../components/layout/usePageSearch'
import { searchRows } from '../../lib/pageSearch'
import {
  actionsCol,
  Badge,
  BulkBar,
  Button,
  COL,
  DescriptionList,
  downloadCsv,
  EmptyState,
  labelCol,
  LinkButton,
  PageHeader,
  QuickViewButton,
  RowActions,
  Segmented,
  SelectCheckbox,
  SidePanel,
  SkeletonRows,
  Table,
  TableSettings,
  toCsv,
  Truncate,
  useRowSelection,
} from '../../components/ui'
import { EM_DASH, formatAmount, formatDate } from '../../lib/format'
import { useClaims } from './api'
import { isOpen } from './machine'
import { CLAIM_STATUS_TONE as STATUS_TONE } from './status'
import type { Claim, ClaimStatus } from './types'

/** Assessment order: a file waiting on us outranks one waiting on them. */
const QUEUE_RANK: Record<ClaimStatus, number> = {
  submitted: 0,
  under_assessment: 1,
  approved: 2,
  partially_approved: 2,
  info_requested: 3,
  draft: 4,
  paid: 5,
  declined: 6,
  withdrawn: 7,
  closed: 8,
}

/** The number column also holds the row's selection box; the indemnity sits
 * under the claimed amount (one column, two lines, as buyer over
 * policyholder), so the queue still fits a laptop with the selection and the
 * quick view added. */
const COLUMNS = ['11rem', COL.fill, COL.money, '7rem', labelCol('claimStatus'), actionsCol([], 1)]

export function ClaimsPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const navigate = useNavigate()
  const { data, isLoading } = useClaims()
  const [scope, setScope] = useState<'open' | 'all'>('open')
  // The quick view: a claim's summary beside the queue.
  const [peekId, setPeekId] = useState<string | null>(null)
  // Rows picked for the bulk bar's export, by id.
  const { selected, toggle, toggleAll, allOf, clear } = useRowSelection()

  // The one search (top bar, lib/pageSearch.ts).
  const { query: search } = usePageSearch('claims')
  const rows = useMemo(() => {
    const all = data ?? []
    const inScope = scope === 'open' ? all.filter((c) => isOpen(c.status)) : all
    const filtered = searchRows(inScope, search, (c) => [
      c.claim_number,
      c.buyer_name,
      c.policyholder_name,
      c.policy_number,
      c.status,
      t(`claims.statuses.${c.status}`),
    ])
    return [...filtered].sort(
      (a, b) =>
        QUEUE_RANK[a.status] - QUEUE_RANK[b.status] ||
        (b.assessment_age_days ?? -1) - (a.assessment_age_days ?? -1),
    )
  }, [data, scope, search, t])

  const columnLabels = [
    t('claims.fields.number'),
    // Buyer over policyholder in one column: seven columns side by side cut
    // both names to a few letters on a laptop.
    `${t('claims.fields.buyer')} / ${t('claims.fields.policyholder')}`,
    `${t('claims.fields.claimed')} / ${t('claims.fields.indemnity')}`,
    t('claims.fields.ageColumn'),
    t('claims.fields.status'),
    '',
  ]
  const rowIds = rows.map((c) => c.id)
  const tableHead = (
    <thead>
      <tr>
        <th>
          <span className="flex items-center gap-3">
            <SelectCheckbox
              label={t('ui.bulk.selectAll')}
              checked={allOf(rowIds)}
              onChange={() => toggleAll(rowIds)}
            />
            {columnLabels[0]}
          </span>
        </th>
        <th>{columnLabels[1]}</th>
        <th className="num">{columnLabels[2]}</th>
        {/* The unit is in each cell; the rule behind the count on hover. */}
        <th className="num" title={t('claims.ageHint')}>
          {columnLabels[3]}
        </th>
        <th>{columnLabels[4]}</th>
        <th>
          <span className="sr-only">{t('common.actions')}</span>
        </th>
      </tr>
    </thead>
  )
  const peek = peekId ? (data ?? []).find((c) => c.id === peekId) : undefined
  const exportSelected = () => {
    const picked = (data ?? [])
      .filter((c) => selected.has(c.id))
      .map((c) => [
        c.claim_number,
        c.buyer_name,
        c.policyholder_name,
        c.policy_number,
        Number(c.claimed_amount),
        c.approved_indemnity === null ? '' : Number(c.approved_indemnity),
        c.currency_code,
        c.assessment_age_days === null ? '' : Math.round(Number(c.assessment_age_days)),
        t(`claims.statuses.${c.status}`),
      ])
    downloadCsv(
      'claims.csv',
      toCsv(
        [
          t('claims.fields.number'),
          t('claims.fields.buyer'),
          t('claims.fields.policyholder'),
          t('claims.fields.policy'),
          t('claims.fields.claimed'),
          t('claims.fields.indemnity'),
          t('policies.fields.currency'),
          t('claims.fields.age'),
          t('claims.fields.status'),
        ],
        picked,
      ),
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        band
        title={t('claims.title')}
        subtitle={t('claims.subtitle')}
        actions={
          <Segmented
            ariaLabel={t('claims.scope.label')}
            value={scope}
            onChange={(v) => setScope(v as 'open' | 'all')}
            options={[
              { key: 'open', label: t('claims.scope.open') },
              { key: 'all', label: t('claims.scope.all') },
            ]}
          />
        }
      />

      {/* The table view on its own, right-aligned: the band above cannot hold
          its popover (it clips what overflows it). */}
      <div className="flex justify-end">
        <TableSettings table="claims" columns={columnLabels} />
      </div>

      {isLoading ? (
        <Table id="claims" columns={COLUMNS}>
          {tableHead}
          <tbody>
            <SkeletonRows columns={COLUMNS.length} />
          </tbody>
        </Table>
      ) : rows.length === 0 ? (
        <EmptyState
          pictogram="claims"
          title={scope === 'open' ? t('claims.empty.openTitle') : t('claims.empty.allTitle')}
          hint={t('claims.empty.hint')}
        />
      ) : (
        <Table id="claims" columns={COLUMNS} stickyHead freezeFirst>
          {tableHead}
          <tbody>
            {rows.map((c) => (
              <ClaimRow
                key={c.id}
                claim={c}
                locale={locale}
                selected={selected.has(c.id)}
                onToggle={() => toggle(c.id)}
                onOpen={() => void navigate(`/claims/${c.id}`)}
                onPeek={() => setPeekId(c.id)}
              />
            ))}
          </tbody>
        </Table>
      )}

      <BulkBar count={selected.size} onClear={clear}>
        <Button variant="secondary" size="sm" onClick={exportSelected}>
          {t('ui.bulk.exportCsv')}
        </Button>
      </BulkBar>

      <SidePanel
        open={peek !== undefined}
        title={peek?.buyer_name}
        meta={
          peek && (
            <>
              <span className="tabular-nums">{peek.claim_number}</span>
              <Badge tone={STATUS_TONE[peek.status]}>{t(`claims.statuses.${peek.status}`)}</Badge>
              {/* A late notification can prejudice cover: said in red, as on the file. */}
              {peek.noa_reported_late && (
                <span title={t('claims.noaLateTitle', { days: peek.noa_days_late ?? 0 })}>
                  <Badge tone="negStrong">{t('claims.noaLateShort')}</Badge>
                </span>
              )}
            </>
          )
        }
        onClose={() => setPeekId(null)}
        footer={peek && <LinkButton to={`/claims/${peek.id}`}>{t('claims.quickView.openClaim')}</LinkButton>}
      >
        {peek && <ClaimSummary claim={peek} />}
      </SidePanel>
    </div>
  )
}

function ClaimRow({
  claim,
  locale,
  selected,
  onToggle,
  onOpen,
  onPeek,
}: {
  claim: Claim
  locale: string
  selected: boolean
  onToggle: () => void
  onOpen: () => void
  onPeek: () => void
}) {
  const { t } = useTranslation()
  return (
    <tr onClick={onOpen} className="cursor-pointer transition-colors hover:bg-slate-50">
      <td className="whitespace-nowrap">
        <span className="flex items-start gap-3">
          <SelectCheckbox
            row
            label={t('ui.bulk.select', { name: claim.claim_number })}
            checked={selected}
            onChange={onToggle}
          />
          <span className="min-w-0 truncate">
            {/* The row opens on click; the link is what a keyboard reaches. */}
            <Link
              to={`/claims/${claim.id}`}
              onClick={(e) => e.stopPropagation()}
              className="font-medium text-accent-600 hover:underline"
            >
              {claim.claim_number}
            </Link>
            {claim.noa_reported_late && (
              <span className="ml-2">
                <Badge tone="negStrong">{t('claims.noaLateShort')}</Badge>
              </span>
            )}
          </span>
        </span>
      </td>
      <td className="cell-fill">
        <Truncate text={claim.buyer_name} className="max-w-none">
          <Link
            to={`/entities/${claim.buyer_entity_id}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:underline"
          >
            {claim.buyer_name}
          </Link>
        </Truncate>
        <Truncate text={claim.policyholder_name} className="max-w-none text-caption text-slate-500" />
      </td>
      <td className="num">
        {formatAmount(Number(claim.claimed_amount), locale)} {claim.currency_code}
        <span className="block text-caption text-slate-500" title={t('claims.fields.indemnity')}>
          {claim.approved_indemnity === null
            ? EM_DASH
            : `${formatAmount(Number(claim.approved_indemnity), locale)} ${claim.currency_code}`}
        </span>
      </td>
      <td className="num" title={t('claims.ageHint')}>
        {claim.assessment_age_days === null
          ? EM_DASH
          : t('policies.terms.days', { count: Math.round(Number(claim.assessment_age_days)) })}
      </td>
      <td className="whitespace-nowrap">
        <Badge tone={STATUS_TONE[claim.status]}>{t(`claims.statuses.${claim.status}`)}</Badge>
      </td>
      <RowActions reveal>
        <QuickViewButton name={claim.claim_number} onClick={onPeek} />
      </RowActions>
    </tr>
  )
}

/** What a claims handler scans before opening the file. */
function ClaimSummary({ claim }: { claim: Claim }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const money = (v: number | null) =>
    v === null ? EM_DASH : <span className="num">{formatAmount(Number(v), locale)} {claim.currency_code}</span>
  return (
    <DescriptionList
      items={[
        { label: t('claims.fields.policyholder'), value: claim.policyholder_name },
        { label: t('claims.fields.policy'), value: <span className="whitespace-nowrap">{claim.policy_number}</span> },
        { label: t('claims.fields.cause'), value: t(`claims.causes.${claim.cause_of_loss}`) },
        { label: t('claims.fields.claimed'), value: money(claim.claimed_amount) },
        { label: t('claims.fields.indemnity'), value: money(claim.approved_indemnity) },
        { label: t('claims.fields.invoices'), value: <span className="num">{claim.invoice_count}</span> },
        { label: t('claims.fields.filedAt'), value: claim.filed_at ? formatDate(claim.filed_at, locale) : EM_DASH },
        {
          label: t('claims.fields.age'),
          value:
            claim.assessment_age_days === null ? (
              EM_DASH
            ) : (
              <span className="num">
                {t('policies.terms.days', { count: Math.round(Number(claim.assessment_age_days)) })}
              </span>
            ),
        },
      ]}
    />
  )
}
