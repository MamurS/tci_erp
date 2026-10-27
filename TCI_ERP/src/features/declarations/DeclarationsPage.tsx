/**
 * «Декларации оборота» — the staff queue.
 *
 * A declaration is priced evidence, so the two things this list has to make
 * obvious are: which ones are waiting on us, and which ones reported turnover
 * OUTSIDE cover. The second is amber, not red: it is a fact about the policy
 * to discuss, not an error in the data (DESIGN.md).
 *
 * A registry (Table v2): the person's row density and columns, and a
 * declaration's summary in a quick view beside the queue.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { usePageSearch } from '../../components/layout/usePageSearch'
import { searchRows } from '../../lib/pageSearch'
import {
  actionsCol,
  Badge,
  Callout,
  COL,
  DescriptionList,
  EmptyState,
  labelCol,
  LinkButton,
  PageHeader,
  QuickViewButton,
  RowActions,
  SidePanel,
  SkeletonRows,
  Spinner,
  Table,
  TableSettings,
  Truncate,
} from '../../components/ui'
import { EM_DASH, formatAmount, formatDate, formatPeriod } from '../../lib/format'
import { useDeclarations, usePolicyDeclarationFrequency } from './api'
import type { DeclarationRow } from './api'
import { periodEnd } from './period'
import { resolvePeriodLink } from './periodLink'
import { STATUS_TONE } from './status'

const COLUMNS = [COL.period, COL.code, COL.fill, COL.money, labelCol('declarationStatus'), actionsCol([], 1)]

export function DeclarationsPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const policyFilter = params.get('policy') ?? undefined
  const { data, isLoading, isError } = useDeclarations(policyFilter)
  const locale = i18n.language
  // The quick view: a declaration's summary beside the queue.
  const [peekId, setPeekId] = useState<string | null>(null)

  // The one search (top bar, lib/pageSearch.ts): policy, policyholder,
  // status, currency — the status filter is just another term.
  const { query: search } = usePageSearch('declarations')
  const rows = useMemo(
    () =>
      searchRows(data ?? [], search, (d) => [
        d.policies?.policy_number,
        d.policies?.legal_entities?.name,
        d.status,
        t(`declarations.statuses.${d.status}`),
        d.currency_code,
      ]),
    [data, search, t],
  )

  // ?period=<first day> with ?policy= (the Agenda's «declaration due» link):
  // a declared period opens its declaration; one not declared yet is said
  // above the policy's list, which stays as it is.
  // Judged only once the list is in, so nothing flashes while it loads.
  const periodLink = data
    ? resolvePeriodLink(data, policyFilter, params.get('period'))
    : ({ kind: 'none' } as const)
  const { data: frequency, isLoading: frequencyLoading } = usePolicyDeclarationFrequency(
    periodLink.kind === 'missing' ? policyFilter : undefined,
  )
  const openId = periodLink.kind === 'open' ? periodLink.id : null
  useEffect(() => {
    if (openId) void navigate(`/declarations/${openId}`, { replace: true })
  }, [openId, navigate])

  const columnLabels = [
    t('declarations.fields.period'),
    t('policies.fields.policyNumber'),
    t('policies.fields.policyholder'),
    t('declarations.fields.totalTurnover'),
    t('declarations.fields.status'),
    '',
  ]
  const tableHead = (
    <thead>
      <tr>
        <th>{columnLabels[0]}</th>
        <th>{columnLabels[1]}</th>
        <th>{columnLabels[2]}</th>
        <th className="num">{columnLabels[3]}</th>
        <th>{columnLabels[4]}</th>
        <th>
          <span className="sr-only">{t('common.actions')}</span>
        </th>
      </tr>
    </thead>
  )
  const peek = peekId ? (data ?? []).find((d) => d.id === peekId) : undefined

  return (
    <div>
      <PageHeader
        title={t('declarations.title')}
        subtitle={t('declarations.subtitle')}
        actions={
          <div className="flex items-end gap-2">
            <TableSettings table="declarations" columns={columnLabels} />
          </div>
        }
      />

      {/* Held until the policy's frequency is known, so the period is named
          once («July 2026», «Q3 2026») instead of changing under the reader. */}
      {periodLink.kind === 'missing' && !frequencyLoading && (
        <Callout
          tone="warn"
          className="mb-5"
          title={t('declarations.periodNotDeclared', {
            period: frequency
              ? formatPeriod(periodLink.period, periodEnd(periodLink.period, frequency), locale)
              : formatDate(periodLink.period, locale),
          })}
        />
      )}

      {isError ? (
        <EmptyState pictogram="error" title={t('common.loadFailed')} hint={t('common.tryAgain')} />
      ) : openId ? (
        // On its way to the declared period's own page.
        <Spinner label={t('common.loading')} />
      ) : isLoading ? (
        <Table id="declarations" columns={COLUMNS}>
          {tableHead}
          <tbody>
            <SkeletonRows columns={COLUMNS.length} />
          </tbody>
        </Table>
      ) : rows.length === 0 ? (
        <EmptyState pictogram="documents" title={t('declarations.empty')} hint={t('declarations.emptyHint')} />
      ) : (
        <Table id="declarations" columns={COLUMNS} stickyHead freezeFirst>
          {tableHead}
          <tbody>
            {rows.map((d) => (
              <tr
                key={d.id}
                onClick={() => void navigate(`/declarations/${d.id}`)}
                className="cursor-pointer transition-colors hover:bg-slate-50"
              >
                <td className="font-medium whitespace-nowrap">
                  {/* The row opens on click; the link is what a keyboard reaches. */}
                  <Link
                    to={`/declarations/${d.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-accent-700 hover:underline"
                  >
                    {formatPeriod(d.period_start, d.period_end, i18n.language)}
                  </Link>
                </td>
                <td className="whitespace-nowrap text-slate-600">{d.policies?.policy_number ?? EM_DASH}</td>
                <td className="text-slate-500">
                  <Truncate text={d.policies?.legal_entities?.name ?? EM_DASH} className="max-w-none" />
                </td>
                <td>
                  <span className="num block">
                    {formatAmount(Number(d.total_insurable_turnover), locale)} {d.currency_code}
                  </span>
                </td>
                <td>
                  <Badge tone={STATUS_TONE[d.status]}>
                    {t(`declarations.statuses.${d.status}`)}
                  </Badge>
                </td>
                <RowActions reveal>
                  <QuickViewButton
                    name={`${formatPeriod(d.period_start, d.period_end, i18n.language)} · ${d.policies?.policy_number ?? EM_DASH}`}
                    onClick={() => setPeekId(d.id)}
                  />
                </RowActions>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <SidePanel
        open={peek !== undefined}
        title={peek && formatPeriod(peek.period_start, peek.period_end, i18n.language)}
        meta={
          peek && (
            <>
              <span className="tabular-nums">{peek.policies?.policy_number ?? EM_DASH}</span>
              <Badge tone={STATUS_TONE[peek.status]}>{t(`declarations.statuses.${peek.status}`)}</Badge>
            </>
          )
        }
        onClose={() => setPeekId(null)}
        footer={
          peek && (
            <LinkButton to={`/declarations/${peek.id}`}>{t('declarations.quickView.openDeclaration')}</LinkButton>
          )
        }
      >
        {peek && <DeclarationSummary declaration={peek} />}
      </SidePanel>
    </div>
  )
}

/** What the queue's reader scans before opening a declaration. */
function DeclarationSummary({ declaration: d }: { declaration: DeclarationRow }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  return (
    <>
      <DescriptionList
        items={[
          { label: t('policies.fields.policyholder'), value: d.policies?.legal_entities?.name ?? EM_DASH },
          {
            label: t('declarations.fields.totalTurnover'),
            value: (
              <span className="num">
                {formatAmount(Number(d.total_insurable_turnover), locale)} {d.currency_code}
              </span>
            ),
          },
          { label: t('declarations.fields.submittedAt'), value: d.submitted_at ? formatDate(d.submitted_at, locale) : EM_DASH },
          { label: t('declarations.fields.acceptedAt'), value: d.accepted_at ? formatDate(d.accepted_at, locale) : EM_DASH },
        ]}
      />
      {d.status === 'disputed' && d.dispute_note && (
        <Callout tone="warn" className="mt-4" title={t('declarations.fields.disputeNote')}>
          <p className="whitespace-pre-line">{d.dispute_note}</p>
        </Callout>
      )}
    </>
  )
}
