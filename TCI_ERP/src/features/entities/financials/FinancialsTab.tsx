import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Check, Download, Plus } from 'lucide-react'

import {
  actionsCol,
  AmountInput,
  Badge,
  Button,
  COL,
  ConfirmDialog,
  EmptyState,
  LinkButton,
  Modal,
  RowActions,
  Segmented,
  Spinner,
  Table,
  Tabs,
} from '../../../components/ui'
import { parseAmount } from '../../../components/ui/amount'
import { formatAmount, formatDate } from '../../../lib/format'
import { exportFileName, exportTableToExcel } from '../../../lib/exportTable'
import { useAuth } from '../../../auth/AuthContext'
import { useEntity, useDeleteStatement, useStatements } from '../api'
import { mayEnterStatements } from './access'
import type { StatementBundle } from '../types'
import { statementPeriodLabel } from '../types'
import type { ReportType } from '../types'
import {
  applyDisplayCurrency,
  balanceSheetColumns,
  defaultSelection,
  hasMixedCurrencyOrUnit,
  incomeStatementColumns,
  sortChronological,
} from './analysis'
import { AnalysisTable } from './AnalysisTable'
import { buildCashFlowColumns } from './cashflow'
import { CashFlowTable } from './CashFlowTable'
import { convertStatements, requiredRates } from './fx'
import type { DisplayCurrency, RateNeed } from './fx'
import { useFxRates, useSaveManualRate } from './fxApi'
import { rateKey } from './fx'
import { frameworkShort } from './frameworkText'
import { useFrameworks, useTemplateFrameworkIndex } from './localApi'
import { LocalSourceModal } from './LocalSourceModal'
import { BALANCE_SHEET_SECTIONS, INCOME_STATEMENT_SECTIONS, bsVerticalBase } from './lines'
import { RatiosTable } from './RatiosTable'
import { buildRiskPeriods } from './risk'
import { RiskTable } from './RiskTable'

const SUB_TABS = ['balance', 'pnl', 'ratios', 'cashflow', 'risk'] as const
type SubTab = (typeof SUB_TABS)[number]
type TypeFilter = 'all' | ReportType

export function FinancialsTab({ entityId }: { entityId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: statements, isLoading } = useStatements(entityId)
  const { data: buyer } = useEntity(entityId)
  const { roles: myRoles } = useAuth()
  const mayEnter = mayEnterStatements(myRoles)

  // Sub-tab lives in the URL (?sub=) so dashboard bullets can deep-link.
  const [searchParams, setSearchParams] = useSearchParams()
  const subParam = searchParams.get('sub')
  const subTab: SubTab = SUB_TABS.includes(subParam as SubTab) ? (subParam as SubTab) : 'balance'
  const setSubTab = (key: SubTab) => {
    const next = new URLSearchParams(searchParams)
    next.set('sub', key)
    setSearchParams(next, { replace: true })
  }
  const [manageOpen, setManageOpen] = useState(false)
  const [sourceStatement, setSourceStatement] = useState<StatementBundle | null>(null)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('original')
  const [manualNeed, setManualNeed] = useState<RateNeed | null>(null)
  /** null = default (last 6 of the filtered list). */
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const [showEmpty, setShowEmpty] = useState(false)
  // The sheet-tab row's height, for the column headings sticking under it.
  const [tabsRow, setTabsRow] = useState<HTMLDivElement | null>(null)
  const [tabsRowHeight, setTabsRowHeight] = useState(0)
  useLayoutEffect(() => {
    const row = tabsRow
    if (!row) return
    const measure = () => setTabsRowHeight(row.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => observer.disconnect()
  }, [tabsRow])

  const all = useMemo(() => statements ?? [], [statements])
  const filteredAll = useMemo(
    () => (typeFilter === 'all' ? all : all.filter((s) => s.report_type === typeFilter)),
    [all, typeFilter],
  )
  const displayedIds = selectedIds ?? defaultSelection(filteredAll)
  const displayedRaw = useMemo(
    () => sortChronological(filteredAll.filter((s) => displayedIds.includes(s.id))),
    [filteredAll, displayedIds],
  )

  // --- Currency conversion (rates for full list: cash flow pairs may be off-screen) ---
  const rateNeeds = useMemo(
    () => (displayCurrency === 'original' ? [] : requiredRates(all, displayCurrency)),
    [all, displayCurrency],
  )
  const { data: rates, isLoading: ratesLoading } = useFxRates(rateNeeds)
  const rateFor = useMemo(
    () => (ccy: string, date: string) => rates?.[rateKey(ccy, date)] ?? null,
    [rates],
  )

  const convertedAll = useMemo(
    () => convertStatements(all, displayCurrency, rateFor),
    [all, displayCurrency, rateFor],
  )
  const converted = useMemo(
    () => convertStatements(displayedRaw, displayCurrency, rateFor),
    [displayedRaw, displayCurrency, rateFor],
  )
  const displayed = converted.statements

  const cashFlowColumns = useMemo(
    () => buildCashFlowColumns(displayed, convertedAll.statements),
    [displayed, convertedAll.statements],
  )
  const riskPeriods = useMemo(
    () => buildRiskPeriods(displayed, convertedAll.statements),
    [displayed, convertedAll.statements],
  )

  if (isLoading) return <Spinner label={t('common.loading')} />

  if (all.length === 0) {
    return (
      <EmptyState
        title={t('fin.noStatements')}
        hint={t('fin.noStatementsHint')}
        action={
          mayEnter ? (
            <LinkButton to={`/buyers/${entityId}/statements/new`}>
              <Plus />
              {t('fin.addStatement')}
            </LinkButton>
          ) : undefined
        }
      />
    )
  }

  const handleExport = () => {
    exportTableToExcel(
      tableRef.current,
      exportFileName(buyer?.name ?? 'buyer', t(`fin.tabs.${subTab}`)),
    )
  }

  return (
    <div style={{ '--fin-tabs-h': `${tabsRowHeight}px` } as CSSProperties}>
      {/* Two aligned rows: what is shown (periods, report type, currency) with
          its export; then the views of it, with the statements themselves on
          the same line. Each wraps as a whole on a narrow screen. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <PeriodSelector
          all={filteredAll}
          displayedIds={displayedIds}
          onChange={(ids) => setSelectedIds(ids)}
        />
        {/* Report type filter (legacy: налоговые / управленческие / всё) */}
        <Segmented
          value={typeFilter}
          ariaLabel={t('fin.fields.reportType')}
          options={[
            { key: 'statutory', label: t('fin.reportTypes.statutory') },
            { key: 'management', label: t('fin.reportTypes.management') },
            { key: 'all', label: t('fin.reportTypes.all') },
          ]}
          onChange={(key) => {
            setTypeFilter(key as TypeFilter)
            setSelectedIds(null)
          }}
        />
        {/* Display currency */}
        <div className="flex items-center gap-2">
          <span className="text-small text-slate-500">{t('fin.fx.displayCurrency')}:</span>
          <Segmented
            value={displayCurrency}
            ariaLabel={t('fin.fx.displayCurrency')}
            options={[
              { key: 'original', label: t('fin.fx.original') },
              { key: 'UZS', label: 'UZS' },
              { key: 'USD', label: 'USD' },
              { key: 'EUR', label: 'EUR' },
            ]}
            onChange={(key) => setDisplayCurrency(key as DisplayCurrency)}
          />
        </div>
        <Button variant="secondary" size="sm" className="ml-auto" onClick={handleExport}>
          <Download />
          {t('fin.exportExcel')}
        </Button>
      </div>

      {displayCurrency === 'original' && hasMixedCurrencyOrUnit(displayedRaw) && (
        <div className="mb-4 rounded-md border border-warn-500/30 bg-warn-50 px-4 py-3 text-small text-warn-500">
          {t('fin.mixedCurrencyWarning')}
        </div>
      )}

      {displayCurrency !== 'original' && ratesLoading && (
        <div className="mb-4 text-small text-slate-500">{t('fin.fx.loadingRates')}</div>
      )}

      {displayCurrency !== 'original' && converted.missing.length > 0 && !ratesLoading && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-warn-500/30 bg-warn-50 px-4 py-3 text-small text-warn-500">
          <span>{t('fin.fx.missingRates')}:</span>
          {converted.missing.map((need) => (
            <button
              key={rateKey(need.currency_code, need.rate_date)}
              type="button"
              onClick={() => setManualNeed(need)}
              className="font-medium underline underline-offset-2"
            >
              {need.currency_code} · {formatDate(need.rate_date, locale)}
            </button>
          ))}
        </div>
      )}

      {displayed.some((s) => s.accounting_basis === 'local') && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-accent-100 bg-accent-50 px-4 py-2 text-small text-accent-700">
          <span>{t('fin.local.mappedIndicator')}</span>
          {displayed
            .filter((s) => s.accounting_basis === 'local')
            .map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() =>
                  setSourceStatement(displayedRaw.find((x) => x.id === s.id) ?? null)
                }
                className="font-medium underline decoration-accent-500/50 underline-offset-2 hover:decoration-accent-700"
              >
                {statementPeriodLabel(s)} — {t('fin.local.viewSource')}
              </button>
            ))}
        </div>
      )}

      {/* The sheet tabs stick under the top bar while the sheet scrolls, and
          the sheet's column headings stick under them (StickyTableFrame) —
          whose offset is this row's height, published as --fin-tabs-h. */}
      <div
        ref={setTabsRow}
        className="sticky top-16 z-20 flex flex-wrap items-end gap-x-4 gap-y-2 bg-canvas shadow-[inset_0_-1px_0_var(--color-slate-200)]"
      >
        <div className="min-w-0 flex-1">
          <Tabs
            size="sm"
            tabs={[
              { key: 'balance', label: t('fin.tabs.balance') },
              { key: 'pnl', label: t('fin.tabs.pnl') },
              { key: 'ratios', label: t('fin.tabs.ratios') },
              { key: 'cashflow', label: t('fin.tabs.cashflow') },
              { key: 'risk', label: t('fin.tabs.risk') },
            ]}
            active={subTab}
            onChange={(key) => setSubTab(key as SubTab)}
          />
        </div>
        <div className="flex items-center gap-4 pb-1">
          {/* Only the balance sheet and the P&L have lines to hide; on the
              other sheets the switch keeps its place, unseen, so the buttons
              beside it never move. */}
          <label
            className={`flex cursor-pointer items-center gap-2 text-small text-slate-600 ${
              subTab === 'balance' || subTab === 'pnl' ? '' : 'invisible'
            }`}
          >
            <input
              type="checkbox"
              checked={showEmpty}
              onChange={(e) => setShowEmpty(e.target.checked)}
              className="size-4 accent-accent-600"
            />
            {t('fin.showEmptyLines')}
          </label>
          <Button variant="secondary" size="sm" onClick={() => setManageOpen(true)}>
            {t('fin.manageStatements')} ({all.length})
          </Button>
          {mayEnter && (
            <LinkButton size="sm" to={`/buyers/${entityId}/statements/new`}>
              <Plus />
              {t('fin.addStatement')}
            </LinkButton>
          )}
        </div>
      </div>

      <div className="mt-4" ref={tableRef}>
        {subTab === 'balance' && (
          <AnalysisTable
            columns={applyDisplayCurrency(balanceSheetColumns(displayedRaw), displayed)}
            sections={BALANCE_SHEET_SECTIONS}
            getValues={(s) => s.balance_sheets}
            verticalBaseFor={bsVerticalBase}
            deltaMode="stock"
            showEmpty={showEmpty}
          />
        )}
        {subTab === 'pnl' && (
          <AnalysisTable
            columns={applyDisplayCurrency(incomeStatementColumns(displayedRaw, all), displayed)}
            sections={INCOME_STATEMENT_SECTIONS}
            getValues={(s) => s.income_statements}
            verticalBaseFor={() => 'revenue'}
            deltaMode="like_for_like"
            showEmpty={showEmpty}
          />
        )}
        {subTab === 'ratios' && <RatiosTable displayed={displayed} />}
        {subTab === 'cashflow' && <CashFlowTable columns={cashFlowColumns} />}
        {subTab === 'risk' && <RiskTable periods={riskPeriods} />}
      </div>

      {displayCurrency !== 'original' && (
        <p className="mt-2 text-caption text-slate-500">{t('fin.fx.growthFootnote')}</p>
      )}
      {displayCurrency !== 'original' && converted.footnotes.length > 0 && (
        <p className="mt-2 text-caption text-slate-500">
          {t('fin.fx.footnote')}:{' '}
          {converted.footnotes
            .map(
              (f) =>
                `${statementPeriodLabel(f.statement)}: ${f.rates
                  .map(
                    (r) =>
                      `${r.currency_code} = ${formatAmount(r.rate_to_uzs, locale, 2)} UZS (${formatDate(r.rate_date, locale)})`,
                  )
                  .join(', ')}`,
            )
            .join('; ')}
        </p>
      )}

      <ManageStatementsModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        entityId={entityId}
        statements={all}
        mayEdit={mayEnter}
      />

      {sourceStatement && (
        <LocalSourceModal
          open
          onClose={() => setSourceStatement(null)}
          statement={sourceStatement}
        />
      )}

      {manualNeed && (
        <ManualRateModal need={manualNeed} onClose={() => setManualNeed(null)} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Manual FX rate entry
// ---------------------------------------------------------------------------

function ManualRateModal({ need, onClose }: { need: RateNeed; onClose: () => void }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const [raw, setRaw] = useState('')
  const save = useSaveManualRate()
  const rate = parseAmount(raw) ?? Number.NaN
  const valid = Number.isFinite(rate) && rate > 0

  return (
    <Modal
      open
      onClose={onClose}
      title={t('fin.fx.manualTitle', { ccy: need.currency_code, date: formatDate(need.rate_date, locale) })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!valid}
            loading={save.isPending}
            onClick={() => {
              void save.mutateAsync({ need, rate }).then(onClose)
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-small text-slate-500">{t('fin.fx.manualHint')}</p>
      <AmountInput
        decimals={6}
        value={raw}
        onChange={setRaw}
        suffix="UZS"
        placeholder={t('fin.fx.manualPlaceholder', { ccy: need.currency_code })}
        autoFocus
      />
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Period selector (up to 6 by default, any subset allowed)
// ---------------------------------------------------------------------------

function PeriodSelector({
  all,
  displayedIds,
  onChange,
}: {
  all: StatementBundle[]
  displayedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const { t } = useTranslation()
  const ordered = sortChronological(all).reverse() // newest first in the picker

  const toggle = (id: string) => {
    if (displayedIds.includes(id)) {
      onChange(displayedIds.filter((x) => x !== id))
    } else {
      onChange([...displayedIds, id])
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('fin.periods')}>
      <span className="mr-1 text-small text-slate-500">{t('fin.periods')}:</span>
      {ordered.map((s) => {
        const active = displayedIds.includes(s.id)
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(s.id)}
            title={t(`fin.periodTooltip.${s.statement_kind}`, {
              year: s.fiscal_year,
              quarter: s.fiscal_quarter,
            })}
            // Shown periods are filled, hidden ones are outlined: the state is
            // readable at a glance, not only on hover.
            className={`inline-flex h-7 items-center gap-1 rounded-md border px-3 text-caption font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 ${
              active
                ? 'border-accent-600 bg-accent-600 text-white hover:bg-accent-700'
                : 'border-slate-300 bg-white text-slate-500 hover:border-slate-400 hover:text-slate-700'
            }`}
          >
            {active && <Check className="size-3.5" aria-hidden />}
            {statementPeriodLabel(s)}
            {s.report_type === 'management' && (
              <span
                className={active ? 'text-warning-200' : 'text-warn-500'}
                title={t('fin.reportTypes.management')}
              >
                •
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Statement management modal
// ---------------------------------------------------------------------------

function ManageStatementsModal({
  open,
  onClose,
  entityId,
  statements,
  mayEdit,
}: {
  open: boolean
  onClose: () => void
  entityId: string
  statements: StatementBundle[]
  /** Read-only for those who may not enter statements (the policy refuses). */
  mayEdit: boolean
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: frameworks } = useFrameworks()
  const { data: templateIndex } = useTemplateFrameworkIndex()
  /** The badge names the national form a statement was entered on. */
  const localBadge = (templateId: string | null): string => {
    const code = templateId ? templateIndex?.[templateId] : undefined
    const framework = frameworks?.find((f) => f.code === code)
    return framework ? frameworkShort(framework, locale) : t('fin.local.badgeLocal')
  }
  const deleteStatement = useDeleteStatement(entityId)
  const [confirming, setConfirming] = useState<StatementBundle | null>(null)
  const [deleteFailed, setDeleteFailed] = useState(false)

  const ordered = sortChronological(statements).reverse()

  return (
    <>
      <Modal open={open} onClose={onClose} title={t('fin.manageStatements')} wide>
        {deleteFailed && (
          <p className="mb-3 text-small text-neg-500" role="alert">
            {t('fin.deleteStatement.failed')}
          </p>
        )}
        <Table dense columns={[COL.fill, COL.date, '9rem', '6rem', actionsCol(['edit', 'delete'])]}>
          <thead>
            <tr>
              <th>{t('fin.fields.period')}</th>
              <th>{t('fin.fields.periodEnd')}</th>
              <th>{t('fin.fields.currency')}</th>
              <th>{t('fin.fields.audited')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ordered.map((s) => (
              <tr key={s.id}>
                <td>
                  <span className="font-medium whitespace-nowrap text-slate-800">{statementPeriodLabel(s)}</span>
                  {/* What the statement is, under its period: kind, form, status. */}
                  <span className="mt-1 flex flex-wrap items-center gap-1">
                    <span className="mr-0.5 text-caption text-slate-500">{t(`fin.kinds.${s.statement_kind}`)}</span>
                    <Badge tone={s.accounting_basis === 'local' ? 'accent' : 'neutral'}>
                      {s.accounting_basis === 'local'
                        ? localBadge(s.template_id)
                        : t('fin.local.badgeIfrs')}
                    </Badge>
                    {s.report_type === 'management' && (
                      <Badge tone="warn">{t('fin.reportTypes.management')}</Badge>
                    )}
                    {s.accounting_basis === 'local' && s.mapping_status !== 'n/a' && (
                      <Badge tone={s.mapping_status === 'mapped' ? 'pos' : 'warn'}>
                        {t(`fin.local.mappingStatus.${s.mapping_status}`)}
                      </Badge>
                    )}
                  </span>
                </td>
                <td className="whitespace-nowrap">{formatDate(s.period_end_date, locale)}</td>
                <td className="whitespace-nowrap">
                  {s.currency_code} · {t(`fin.units.${s.unit}`)}
                </td>
                <td>
                  {s.audited ? <Badge tone="pos">{t('common.yes')}</Badge> : <Badge>{t('common.no')}</Badge>}
                </td>
                <RowActions>
                  {mayEdit && (
                    <>
                      <LinkButton variant="secondary" size="sm" to={`/buyers/${entityId}/statements/${s.id}/edit`}>
                        {t('common.edit')}
                      </LinkButton>
                      <Button variant="dangerOutline" size="sm" onClick={() => setConfirming(s)}>
                        {t('common.delete')}
                      </Button>
                    </>
                  )}
                </RowActions>
              </tr>
            ))}
          </tbody>
        </Table>
      </Modal>
      {/* A sibling, not a child: the confirmation stacks on top of the list. */}
      <ConfirmDialog
          open={confirming !== null}
          title={t('fin.deleteStatement.title')}
          message={
            confirming
              ? t('fin.deleteStatement.message', {
                  period: statementPeriodLabel(confirming),
                  end: formatDate(confirming.period_end_date, locale),
                })
              : ''
          }
          confirmLabel={t('fin.deleteStatement.confirm')}
          pending={deleteStatement.isPending}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            if (!confirming) return
            setDeleteFailed(false)
            // The statement leaves the list at once (optimistic): close now.
            setConfirming(null)
            void deleteStatement.mutateAsync(confirming.id).catch(() => setDeleteFailed(true))
          }}
        />
    </>
  )
}
