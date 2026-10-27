/** Policy registry with status/policyholder/structure filters. A registry
 * (Table v2): the person's row density and columns, rows picked for a CSV
 * export, and a policy's key terms in a quick view beside the list. */

import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  actionsCol,
  Badge,
  BulkBar,
  Button,
  COL,
  DescriptionList,
  downloadCsv,
  EmptyState,
  Highlight,
  labelCol,
  LinkButton,
  LinkRow,
  QuickViewButton,
  RowActions,
  SelectCheckbox,
  SidePanel,
  SkeletonRows,
  Table,
  TableSettings,
  toCsv,
  Truncate,
  useRowSelection,
  ViewBar,
} from '../../components/ui'
import { EM_DASH, formatAmount, formatDate, formatPercent, formatRate } from '../../lib/format'
import { usePolicies } from './api'
import { useAuth } from '../../auth/AuthContext'
import { mayWritePolicies, statusTone } from './statusMachine'
import type { PolicyWithRefs } from './types'
import { usePageSearch } from '../../components/layout/usePageSearch'
import { searchRows } from '../../lib/pageSearch'

/** The number column also holds the row's selection box; the period sits on
 * two lines (from, to), so the register still fits a laptop with the
 * selection and the quick view added. */
const COLUMNS = ['11rem', COL.fill, '8.75rem', labelCol('policyStatus'), COL.money, actionsCol([], 1)]

export function PoliciesPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const navigate = useNavigate()
  const { roles } = useAuth()

  const { data: policies, isLoading } = usePolicies()

  // The one search (top bar, lib/pageSearch.ts): number, policyholder,
  // status, structure, currency — terms separated by commas, in order.
  const { query: search, setQuery: setSearch } = usePageSearch('policies')
  // The quick view: a policy's key terms beside the list.
  const [peekId, setPeekId] = useState<string | null>(null)
  // Rows picked for the bulk bar's export, by id.
  const { selected, toggle, toggleAll, allOf, clear } = useRowSelection()

  const filtering = Boolean(search.trim())
  const resetFilters = () => setSearch('')

  const filtered = useMemo(
    () =>
      searchRows(policies ?? [], search, (p) => [
        p.policy_number,
        p.legal_entities?.name,
        p.status,
        t(`policies.statuses.${p.status}`),
        p.product_structure,
        t(`policies.structures.${p.product_structure}`),
        p.currency_code,
      ]),
    [policies, search, t],
  )

  const columnLabels = [
    t('policies.fields.policyNumber'),
    t('policies.fields.policyholder'),
    t('policies.fields.period'),
    t('policies.fields.status'),
    t('policies.terms.discretionaryLimit'),
    '',
  ]
  const filteredIds = filtered.map((p) => p.id)
  const tableHead = (
    <thead>
      <tr>
        <th>
          <span className="flex items-center gap-3">
            <SelectCheckbox
              label={t('ui.bulk.selectAll')}
              checked={allOf(filteredIds)}
              onChange={() => toggleAll(filteredIds)}
            />
            {columnLabels[0]}
          </span>
        </th>
        <th>{columnLabels[1]}</th>
        <th>{columnLabels[2]}</th>
        <th>{columnLabels[3]}</th>
        <th className="num">{columnLabels[4]}</th>
        <th>
          <span className="sr-only">{t('common.actions')}</span>
        </th>
      </tr>
    </thead>
  )
  const peek = peekId ? (policies ?? []).find((p) => p.id === peekId) : undefined
  const exportSelected = () => {
    const rows = (policies ?? [])
      .filter((p) => selected.has(p.id))
      .map((p) => [
        p.policy_number,
        p.legal_entities?.name ?? '',
        t(`policies.structures.${p.product_structure}`),
        p.inception_date,
        p.expiry_date,
        t(`policies.statuses.${p.status}`),
        Number(p.discretionary_limit),
        p.currency_code,
      ])
    downloadCsv(
      'policies.csv',
      toCsv(
        [
          t('policies.fields.policyNumber'),
          t('policies.fields.policyholder'),
          t('policies.fields.productStructure'),
          t('policies.fields.inceptionDate'),
          t('policies.fields.expiryDate'),
          t('policies.fields.status'),
          t('policies.terms.discretionaryLimit'),
          t('policies.fields.currency'),
        ],
        rows,
      ),
    )
  }

  return (
    <div>
      <ViewBar
        hint={t('policies.subtitle')}
        actions={
          mayWritePolicies(roles) ? (
            <Button onClick={() => void navigate('/policies/new')}>{t('policies.newPolicy')}</Button>
          ) : undefined
        }
      />

      {/* Searching and filtering is the top-bar field's; the table's own
          settings stay beside the table. */}
      <div className="mb-4 flex justify-end">
        <TableSettings table="policies" columns={columnLabels} />
      </div>

      {isLoading ? (
        <Table id="policies" columns={COLUMNS}>
          {tableHead}
          <tbody>
            <SkeletonRows columns={COLUMNS.length} />
          </tbody>
        </Table>
      ) : filtered.length === 0 ? (
        // «New policy» lives in the bar above; the empty state never repeats it.
        filtering ? (
          <EmptyState
            pictogram="search"
            title={t('common.noMatches')}
            hint={t('common.noMatchesHint')}
            action={
              <Button variant="secondary" onClick={resetFilters}>
                {t('common.resetFilters')}
              </Button>
            }
          />
        ) : (
          <EmptyState pictogram="documents" title={t('policies.empty')} hint={t('policies.emptyHint')} />
        )
      ) : (
        <Table id="policies" columns={COLUMNS} stickyHead freezeFirst>
          {tableHead}
          <tbody>
            {filtered.map((p) => (
              // The row opens the policy; the policyholder's name opens the
              // company, the quick view stays on its own button.
              <LinkRow key={p.id} to={`/policies/${p.id}`} className="transition-colors hover:bg-slate-50">
                <td className="font-medium whitespace-nowrap text-slate-800">
                  <span className="flex items-start gap-3">
                    <SelectCheckbox
                      row
                      label={t('ui.bulk.select', { name: p.policy_number })}
                      checked={selected.has(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    <span className="min-w-0 truncate">
                      <Highlight text={p.policy_number} query={search} />
                    </span>
                  </span>
                </td>
                <td className="text-slate-600">
                  <Truncate text={p.legal_entities?.name} className="max-w-none">
                    {p.legal_entities?.name ? (
                      <Link to={`/entities/${p.entity_id}`} className="hover:text-accent-600 hover:underline">
                        <Highlight text={p.legal_entities.name} query={search} />
                      </Link>
                    ) : (
                      EM_DASH
                    )}
                  </Truncate>
                  {/* The structure under the name: a column of its own pushed
                      the register past a laptop's width. */}
                  <span className="block text-caption text-slate-500">{t(`policies.structures.${p.product_structure}`)}</span>
                </td>
                <td className="whitespace-nowrap text-slate-500">
                  <span className="block">{formatDate(p.inception_date, locale)} —</span>
                  <span className="block">{formatDate(p.expiry_date, locale)}</span>
                </td>
                <td>
                  <Badge tone={statusTone(p.status)}>{t(`policies.statuses.${p.status}`)}</Badge>
                </td>
                {/* The amount with its currency, as everywhere else. */}
                <td className="num">
                  {formatAmount(Number(p.discretionary_limit), locale)}{' '}
                  <span className="text-slate-500">{p.currency_code}</span>
                </td>
                <RowActions reveal>
                  <QuickViewButton name={p.policy_number} onClick={() => setPeekId(p.id)} />
                </RowActions>
              </LinkRow>
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
        title={peek?.policy_number}
        meta={peek && <Badge tone={statusTone(peek.status)}>{t(`policies.statuses.${peek.status}`)}</Badge>}
        onClose={() => setPeekId(null)}
        footer={peek && <LinkButton to={`/policies/${peek.id}`}>{t('policies.quickView.openPolicy')}</LinkButton>}
      >
        {peek && <PolicyTerms policy={peek} />}
      </SidePanel>
    </div>
  )
}

/** A policy's key terms, as its card states them (PolicyDetailPage). */
function PolicyTerms({ policy }: { policy: PolicyWithRefs }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const ccy = policy.currency_code
  const amount = (v: number | null) =>
    v === null ? EM_DASH : <span className="num">{formatAmount(Number(v), locale)} {ccy}</span>
  const days = (count: number) => <span className="num">{t('policies.terms.days', { count })}</span>
  // One basis is stated; a policy that still carries both shows both.
  const maxLiability =
    [
      policy.max_liability_amount !== null ? `${formatAmount(Number(policy.max_liability_amount), locale)} ${ccy}` : null,
      policy.max_liability_premium_multiple !== null
        ? t('policies.terms.premiumMultiple', {
            value: formatAmount(Number(policy.max_liability_premium_multiple), locale, 1),
          })
        : null,
    ]
      .filter(Boolean)
      .join(' / ') || EM_DASH
  return (
    <DescriptionList
      items={[
        { label: t('policies.fields.policyholder'), value: policy.legal_entities?.name ?? EM_DASH },
        { label: t('policies.fields.productStructure'), value: t(`policies.structures.${policy.product_structure}`) },
        {
          label: t('policies.fields.period'),
          value: (
            <span className="whitespace-nowrap">
              {formatDate(policy.inception_date, locale)} — {formatDate(policy.expiry_date, locale)}
            </span>
          ),
        },
        {
          label: t('policies.terms.insuredPercentage'),
          value: <span className="num">{formatPercent(Number(policy.insured_percentage) / 100, locale)}</span>,
        },
        { label: t('policies.terms.maxLiability'), value: maxLiability },
        { label: t('policies.terms.nql'), value: amount(policy.nql_amount) },
        {
          label: t('policies.terms.premiumRate'),
          value: <span className="num">{formatRate(policy.premium_rate_pct, locale)}</span>,
        },
        { label: t('policies.terms.minimumPremium'), value: amount(policy.minimum_premium) },
        { label: t('policies.terms.discretionaryLimit'), value: amount(policy.discretionary_limit) },
        { label: t('policies.terms.maxPaymentTerms'), value: days(policy.max_payment_terms_days) },
        { label: t('policies.terms.waitingPeriod'), value: days(policy.waiting_period_days) },
      ]}
    />
  )
}
