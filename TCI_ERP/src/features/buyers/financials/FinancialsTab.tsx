import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Badge, Button, EmptyState, Modal, Spinner, Table, Tabs } from '../../../components/ui'
import { useBuyer, useDeleteStatement, useStatements } from '../api'
import type { StatementBundle } from '../types'
import { statementPeriodLabel } from '../types'
import { LocalSourceModal } from './LocalSourceModal'
import {
  balanceSheetColumns,
  defaultSelection,
  hasMixedCurrencyOrUnit,
  incomeStatementColumns,
  sortChronological,
} from './analysis'
import { AnalysisTable } from './AnalysisTable'
import { RatiosTable } from './RatiosTable'
import { BALANCE_SHEET_SECTIONS, INCOME_STATEMENT_SECTIONS, bsVerticalBase } from './lines'

type SubTab = 'balance' | 'pnl' | 'ratios'

export function FinancialsTab({ buyerId }: { buyerId: string }) {
  const { t } = useTranslation()
  const { data: statements, isLoading } = useStatements(buyerId)
  const { data: buyer } = useBuyer(buyerId)

  const [subTab, setSubTab] = useState<SubTab>('balance')
  const [manageOpen, setManageOpen] = useState(false)
  const [sourceStatement, setSourceStatement] = useState<StatementBundle | null>(null)
  /** null = default (last 3). */
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null)

  const all = useMemo(() => statements ?? [], [statements])
  const displayedIds = selectedIds ?? defaultSelection(all)
  const displayed = useMemo(
    () => sortChronological(all.filter((s) => displayedIds.includes(s.id))),
    [all, displayedIds],
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

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <PeriodSelector
          all={all}
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

      {hasMixedCurrencyOrUnit(displayed) && (
        <div className="mb-4 rounded-md border border-warn-500/30 bg-warn-50 px-4 py-2.5 text-[13px] text-warn-500">
          {t('fin.mixedCurrencyWarning')}
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
                onClick={() => setSourceStatement(s)}
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
        ]}
        active={subTab}
        onChange={(key) => setSubTab(key as SubTab)}
      />

      <div className="mt-4">
        {subTab === 'balance' && (
          <AnalysisTable
            columns={balanceSheetColumns(displayed)}
            sections={BALANCE_SHEET_SECTIONS}
            getValues={(s) => s.balance_sheets}
            verticalBaseFor={bsVerticalBase}
            deltaMode="stock"
          />
        )}
        {subTab === 'pnl' && (
          <AnalysisTable
            columns={incomeStatementColumns(displayed, all)}
            sections={INCOME_STATEMENT_SECTIONS}
            getValues={(s) => s.income_statements}
            verticalBaseFor={() => 'revenue'}
            deltaMode="like_for_like"
          />
        )}
        {subTab === 'ratios' && <RatiosTable displayed={displayed} />}
      </div>

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
    </div>
  )
}

// ---------------------------------------------------------------------------
// Period selector (up to 3 statements)
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
    } else if (displayedIds.length < 3) {
      onChange([...displayedIds, id])
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[13px] text-slate-500">{t('fin.periods')}:</span>
      {ordered.map((s) => {
        const active = displayedIds.includes(s.id)
        const disabled = !active && displayedIds.length >= 3
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => toggle(s.id)}
            disabled={disabled}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              active
                ? 'border-accent-600 bg-accent-50 text-accent-700'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
            } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            {statementPeriodLabel(s)}
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
