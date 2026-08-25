import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, Button, EmptyState, Input, Modal, Segmented, Spinner, Table, Tabs } from '../../../components/ui'
import { formatAmount } from '../../../lib/format'
import { exportFileName, exportTableToExcel } from '../../../lib/exportTable'
import { useBuyer, useDeleteStatement, useStatements } from '../api'
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
import { LocalSourceModal } from './LocalSourceModal'
import { BALANCE_SHEET_SECTIONS, INCOME_STATEMENT_SECTIONS, bsVerticalBase } from './lines'
import { RatiosTable } from './RatiosTable'
import { buildRiskPeriods } from './risk'
import { RiskTable } from './RiskTable'

const SUB_TABS = ['balance', 'pnl', 'ratios', 'cashflow', 'risk'] as const
type SubTab = (typeof SUB_TABS)[number]
type TypeFilter = 'all' | ReportType

export function FinancialsTab({ buyerId }: { buyerId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { data: statements, isLoading } = useStatements(buyerId)
  const { data: buyer } = useBuyer(buyerId)

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
          <Link to={`/buyers/${buyerId}/statements/new`}>
            <Button>{t('fin.addStatement')}</Button>
          </Link>
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
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <PeriodSelector
          all={filteredAll}
          displayedIds={displayedIds}
          onChange={(ids) => setSelectedIds(ids)}
        />
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setManageOpen(true)}>
            {t('fin.manageStatements')} ({all.length})
          </Button>
          <Link to={`/buyers/${buyerId}/statements/new`}>
            <Button size="sm">{t('fin.addStatement')}</Button>
          </Link>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        {/* Report type filter (legacy: налоговые / управленческие / всё) */}
        <Segmented
          value={typeFilter}
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
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] text-slate-500">{t('fin.fx.displayCurrency')}:</span>
          <Segmented
            value={displayCurrency}
            options={[
              { key: 'original', label: t('fin.fx.original') },
              { key: 'UZS', label: 'UZS' },
              { key: 'USD', label: 'USD' },
              { key: 'EUR', label: 'EUR' },
            ]}
            onChange={(key) => setDisplayCurrency(key as DisplayCurrency)}
          />
        </div>
        <div className="ml-auto">
          <Button variant="secondary" size="sm" onClick={handleExport}>
            {t('fin.exportExcel')}
          </Button>
        </div>
      </div>

      {displayCurrency === 'original' && hasMixedCurrencyOrUnit(displayedRaw) && (
        <div className="mb-4 rounded-md border border-warn-500/30 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500">
          {t('fin.mixedCurrencyWarning')}
        </div>
      )}

      {displayCurrency !== 'original' && ratesLoading && (
        <div className="mb-4 text-[13px] text-slate-500">{t('fin.fx.loadingRates')}</div>
      )}

      {displayCurrency !== 'original' && converted.missing.length > 0 && !ratesLoading && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-warn-500/30 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500">
          <span>{t('fin.fx.missingRates')}:</span>
          {converted.missing.map((need) => (
            <button
              key={rateKey(need.currency_code, need.rate_date)}
              type="button"
              onClick={() => setManualNeed(need)}
              className="font-medium underline underline-offset-2"
            >
              {need.currency_code} · {need.rate_date}
            </button>
          ))}
        </div>
      )}

      {displayed.some((s) => s.accounting_basis === 'local') && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-accent-100 bg-accent-50 px-4 py-2 text-[13px] text-accent-700">
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

      <div className="mt-4" ref={tableRef}>
        {subTab === 'balance' && (
          <AnalysisTable
            columns={applyDisplayCurrency(balanceSheetColumns(displayedRaw), displayed)}
            sections={BALANCE_SHEET_SECTIONS}
            getValues={(s) => s.balance_sheets}
            verticalBaseFor={bsVerticalBase}
            deltaMode="stock"
          />
        )}
        {subTab === 'pnl' && (
          <AnalysisTable
            columns={applyDisplayCurrency(incomeStatementColumns(displayedRaw, all), displayed)}
            sections={INCOME_STATEMENT_SECTIONS}
            getValues={(s) => s.income_statements}
            verticalBaseFor={() => 'revenue'}
            deltaMode="like_for_like"
          />
        )}
        {subTab === 'ratios' && <RatiosTable displayed={displayed} />}
        {subTab === 'cashflow' && <CashFlowTable columns={cashFlowColumns} />}
        {subTab === 'risk' && <RiskTable periods={riskPeriods} />}
      </div>

      {displayCurrency !== 'original' && (
        <p className="mt-2 text-xs text-slate-400">{t('fin.fx.growthFootnote')}</p>
      )}
      {displayCurrency !== 'original' && converted.footnotes.length > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          {t('fin.fx.footnote')}:{' '}
          {converted.footnotes
            .map(
              (f) =>
                `${statementPeriodLabel(f.statement)}: ${f.rates
                  .map(
                    (r) =>
                      `${r.currency_code} = ${formatAmount(r.rate_to_uzs, locale, 2)} UZS (${r.rate_date})`,
                  )
                  .join(', ')}`,
            )
            .join('; ')}
        </p>
      )}

      <ManageStatementsModal
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        buyerId={buyerId}
        statements={all}
      />

      {sourceStatement && (
        <LocalSourceModal
          open
          onClose={() => setSourceStatement(null)}
          statement={sourceStatement}
          countryCode={buyer?.country_code ?? ''}
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
  const { t } = useTranslation()
  const [raw, setRaw] = useState('')
  const save = useSaveManualRate()
  const rate = Number(raw.replace(/\s/g, '').replace(',', '.'))
  const valid = Number.isFinite(rate) && rate > 0

  return (
    <Modal
      open
      onClose={onClose}
      title={t('fin.fx.manualTitle', { ccy: need.currency_code, date: need.rate_date })}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!valid || save.isPending}
            onClick={() => {
              void save.mutateAsync({ need, rate }).then(onClose)
            }}
          >
            {save.isPending ? t('common.saving') : t('common.save')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] text-slate-500">{t('fin.fx.manualHint')}</p>
      <Input
        inputMode="decimal"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
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
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[13px] text-slate-500">{t('fin.periods')}:</span>
      {ordered.map((s) => {
        const active = displayedIds.includes(s.id)
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => toggle(s.id)}
            title={t(`fin.periodTooltip.${s.statement_kind}`, {
              year: s.fiscal_year,
              quarter: s.fiscal_quarter,
            })}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? 'border-accent-600 bg-accent-50 text-accent-700'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
            }`}
          >
            {statementPeriodLabel(s)}
            {s.report_type === 'management' && <span className="ml-1 text-warn-500">•</span>}
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
  buyerId,
  statements,
}: {
  open: boolean
  onClose: () => void
  buyerId: string
  statements: StatementBundle[]
}) {
  const { t } = useTranslation()
  const deleteStatement = useDeleteStatement(buyerId)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const ordered = sortChronological(statements).reverse()

  return (
    <Modal open={open} onClose={onClose} title={t('fin.manageStatements')} wide>
      <Table dense>
        <thead>
          <tr>
            <th>{t('fin.fields.period')}</th>
            <th>{t('fin.fields.periodEnd')}</th>
            <th>{t('fin.fields.kind')}</th>
            <th>{t('fin.fields.currency')}</th>
            <th>{t('fin.fields.unit')}</th>
            <th>{t('fin.fields.audited')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {ordered.map((s) => (
            <tr key={s.id}>
              <td className="font-medium">
                {statementPeriodLabel(s)}
                <span className="ml-2 inline-flex gap-1">
                  <Badge tone={s.accounting_basis === 'local' ? 'accent' : 'neutral'}>
                    {s.accounting_basis === 'local'
                      ? t('fin.local.badgeLocal')
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
              <td>{s.period_end_date}</td>
              <td>{t(`fin.kinds.${s.statement_kind}`)}</td>
              <td>{s.currency_code}</td>
              <td>{t(`fin.units.${s.unit}`)}</td>
              <td>
                {s.audited ? <Badge tone="pos">{t('common.yes')}</Badge> : <Badge>{t('common.no')}</Badge>}
              </td>
              <td>
                <div className="flex justify-end gap-1.5">
                  <Link to={`/buyers/${buyerId}/statements/${s.id}/edit`}>
                    <Button variant="ghost" size="sm">
                      {t('common.edit')}
                    </Button>
                  </Link>
                  {confirmingId === s.id ? (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        void deleteStatement.mutateAsync(s.id).then(() => setConfirmingId(null))
                      }}
                    >
                      {t('common.confirmDelete')}
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmingId(s.id)}>
                      {t('common.delete')}
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Modal>
  )
}
