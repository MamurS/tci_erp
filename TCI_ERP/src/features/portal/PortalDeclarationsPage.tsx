/**
 * «Мои декларации» — the policyholder declares their turnover.
 *
 * The screen's job is to make the coverage split visible WHILE they type, not
 * after acceptance: a buyer without a limit is covered only up to the
 * discretionary limit, and anything above it is not insured. Telling them
 * afterwards would be telling them too late.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  actionsCol,
  AmountInput,
  Badge,
  Button,
  Callout,
  Card,
  COL,
  EmptyState,
  Field,
  labelCol,
  PageHeader,
  parseAmount,
  RowActions,
  SectionTitle,
  Select,
  Spinner,
  Table,
  Truncate,
} from '../../components/ui'
import { EM_DASH, formatAmount, formatPeriod } from '../../lib/format'
import { classifyLine } from '../declarations/coverage'
import { lastClosedPeriodStart } from '../declarations/period'
import type { DeclarationFrequency } from '../declarations/types'
import {
  useClientDeclarableBuyers,
  useClientDeclarationLines,
  useClientDeclarations,
  useMyPolicies,
  useDeleteClientLine,
  useOpenDeclaration,
  useSaveClientLine,
  useSubmitClientDeclaration,
} from './api'
import type { ClientDeclaration, ClientPolicy } from './types'
import { refusalKey } from '../../lib/refusals'

const STATUS_TONE: Record<ClientDeclaration['status'], 'neutral' | 'accent' | 'pos' | 'warn'> =
  {
    draft: 'neutral',
    submitted: 'accent',
    accepted: 'pos',
    disputed: 'warn',
    corrected: 'neutral',
  }

export function PortalDeclarationsPage() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: policies } = useMyPolicies()
  const { data: declarations, isLoading } = useClientDeclarations()
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = useOpenDeclaration()
  const submit = useSubmitClientDeclaration()

  const activePolicy = useMemo(
    () => (policies ?? []).find((p: ClientPolicy) => p.status === 'active') ?? null,
    [policies],
  )

  const run = (p: Promise<unknown>) => {
    setError(null)
    return p.catch((e: unknown) =>
      setError(t(refusalKey(e))),
    )
  }

  const startPeriod = () => {
    if (!activePolicy) return
    const frequency = (activePolicy.declaration_frequency ?? 'monthly') as DeclarationFrequency
    const period = lastClosedPeriodStart(new Date().toISOString().slice(0, 10), frequency)
    void run(
      open.mutateAsync({ policy_id: activePolicy.id, period_start: period }).then((id) => {
        setOpenId(id)
      }),
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('portal.declarations.title')}
        subtitle={t('portal.declarations.subtitle')}
        actions={
          activePolicy ? (
            <Button onClick={startPeriod} loading={open.isPending}>
              {t('portal.declarations.actions.declarePeriod')}
            </Button>
          ) : undefined
        }
      />

      {error && <Callout tone="neg" title={error} />}

      {isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : !declarations?.length ? (
        <EmptyState
          title={t('portal.declarations.empty')}
          hint={t('portal.declarations.emptyHint')}
        />
      ) : (
        <Table columns={[COL.fill, COL.money, COL.money, COL.money, labelCol('declarationStatus')]}>
          <thead>
            <tr>
              <th>{t('declarations.fields.period')}</th>
              <th className="num">{t('declarations.fields.totalTurnover')}</th>
              <th className="num">{t('declarations.fields.uncoveredExcess')}</th>
              <th className="num">{t('portal.declarations.premium')}</th>
              <th>{t('declarations.fields.status')}</th>
            </tr>
          </thead>
          <tbody>
            {declarations.map((d) => {
              const excess = d.uncovered_excess === null ? null : Number(d.uncovered_excess)
              return (
                // The row opens the declaration below, as every register does.
                <tr
                  key={d.id}
                  onClick={() => setOpenId(d.id)}
                  aria-selected={openId === d.id}
                  className={`cursor-pointer transition-colors hover:bg-slate-50 ${
                    openId === d.id ? 'bg-accent-50' : ''
                  } ${d.superseded ? 'text-slate-400' : ''}`}
                >
                  <td className="font-medium">{formatPeriod(d.period_start, d.period_end, locale)}</td>
                  <td className="num">
                    {formatAmount(Number(d.total_insurable_turnover), locale)} {d.currency_code}
                  </td>
                  {/* No excess is «—», not a zero that reads like an amount. */}
                  <td className={`num text-right ${excess ? 'font-medium text-warn-500' : ''}`}>
                    {excess ? `${formatAmount(excess, locale)} ${d.currency_code}` : EM_DASH}
                  </td>
                  <td className="num">
                    {d.premium_amount === null
                      ? EM_DASH
                      : `${formatAmount(Number(d.premium_amount), locale)} ${d.currency_code}`}
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[d.status]}>{t(`declarations.statuses.${d.status}`)}</Badge>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}

      {openId && (
        <DeclarationEditor
          declaration={(declarations ?? []).find((d) => d.id === openId) ?? null}
          declarationId={openId}
          policyId={activePolicy?.id}
          discretionaryLimit={Number(activePolicy?.discretionary_limit ?? 0)}
          onSubmit={() => void run(submit.mutateAsync(openId))}
          submitting={submit.isPending}
          onError={setError}
        />
      )}
    </div>
  )
}

function DeclarationEditor({
  declaration,
  declarationId,
  policyId,
  discretionaryLimit,
  onSubmit,
  submitting,
  onError,
}: {
  submitting: boolean
  declaration: ClientDeclaration | null
  declarationId: string
  policyId: string | undefined
  discretionaryLimit: number
  onSubmit: () => void
  onError: (message: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data: lines } = useClientDeclarationLines(declarationId)
  const { data: buyers } = useClientDeclarableBuyers(policyId)
  const save = useSaveClientLine()
  const remove = useDeleteClientLine()

  const [buyerId, setBuyerId] = useState('')
  const [turnover, setTurnover] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const ccy = declaration?.currency_code ?? ''
  const money = (v: number) => `${formatAmount(v, locale)} ${ccy}`.trim()

  // Opened from a row above: bring it into view, or the click seems to do nothing.
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [declarationId])

  const editable = declaration?.status === 'draft' || declaration?.status === 'disputed'

  // The split the line WILL get, shown before it is saved. Mirrors
  // tci.classify_declaration_line exactly.
  const preview = useMemo(() => {
    const amount = parseAmount(turnover) ?? Number.NaN
    if (!buyerId || !Number.isFinite(amount) || amount <= 0) return null
    const hasLimit = (buyers ?? []).some((b) => b.entity_id === buyerId)
    return classifyLine(hasLimit, amount, discretionaryLimit)
  }, [buyerId, turnover, buyers, discretionaryLimit])

  return (
    <div ref={ref} className="scroll-mt-6">
      <Card className="p-5">
        <SectionTitle
          className="mb-3"
          hint={declaration ? formatPeriod(declaration.period_start, declaration.period_end, locale) : undefined}
          actions={
            declaration && (
              <Badge tone={STATUS_TONE[declaration.status]}>
                {t(`declarations.statuses.${declaration.status}`)}
              </Badge>
            )
          }
        >
          {t('portal.declarations.lines')}
        </SectionTitle>

        {declaration?.status === 'disputed' && declaration.dispute_note && (
          <Callout tone="warn" title={t('portal.declarations.disputed')} className="mb-3">
            {declaration.dispute_note}
          </Callout>
        )}

        {!lines?.length ? (
          <EmptyState title={t('portal.declarations.noLines')} />
        ) : (
          <Table dense columns={[COL.fill, COL.money, labelCol('coverageBasis'), COL.money, actionsCol(['delete'])]}>
            <thead>
              <tr>
                <th>{t('limits.fields.buyer')}</th>
                <th className="num">{t('declarations.fields.insurableTurnover')}</th>
                <th>{t('declarations.fields.coverageBasis')}</th>
                <th className="num">{t('declarations.fields.uncovered')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="font-medium">
                    <Truncate text={l.entity_name} className="max-w-none" />
                  </td>
                  <td className="num">{money(Number(l.insurable_turnover))}</td>
                  <td>
                    <Badge
                      tone={l.coverage_basis === 'uncovered_excess' ? 'warn' : 'neutral'}
                    >
                      {t(`declarations.coverageBasis.${l.coverage_basis}`)}
                    </Badge>
                  </td>
                  <td
                    className={`num text-right ${Number(l.uncovered_excess) > 0 ? 'font-medium text-warn-500' : ''}`}
                  >
                    {Number(l.uncovered_excess) > 0 ? money(Number(l.uncovered_excess)) : EM_DASH}
                  </td>
                  <RowActions>
                    {editable && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void remove
                            .mutateAsync({ lineId: l.id, declarationId })
                            .catch((e: unknown) =>
                              onError(t(refusalKey(e))),
                            )
                        }
                      >
                        {t('common.delete')}
                      </Button>
                    )}
                  </RowActions>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {editable && (
          <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t('limits.fields.buyer')}>
                <Select value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                  <option value="">{t('portal.declarations.pickBuyer')}</option>
                  {(buyers ?? []).map((b) => (
                    <option key={b.entity_id} value={b.entity_id}>
                      {b.entity_name} · {formatAmount(Number(b.approved_amount), locale)} {b.currency_code}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('declarations.fields.insurableTurnover')}>
                <AmountInput value={turnover} onChange={setTurnover} suffix={declaration?.currency_code} />
              </Field>
              <Button
                variant="secondary"
                disabled={!buyerId || !((parseAmount(turnover) ?? 0) > 0)}
                loading={save.isPending}
                onClick={() =>
                  void save
                    .mutateAsync({
                      declaration_id: declarationId,
                      entity_id: buyerId,
                      turnover: parseAmount(turnover) ?? 0,
                      // The line shows at once with the split it will get.
                      preview: preview
                        ? {
                            entity_name: (buyers ?? []).find((b) => b.entity_id === buyerId)?.entity_name ?? '',
                            split: preview,
                          }
                        : undefined,
                    })
                    .then(() => {
                      setBuyerId('')
                      setTurnover('')
                    })
                    .catch((e: unknown) =>
                      onError(t(refusalKey(e))),
                    )
                }
              >
                {t('common.add')}
              </Button>
            </div>

            {preview && preview.uncovered > 0 && (
              <Callout
                tone="warn"
                title={t('portal.declarations.uncoveredWarning', {
                  amount: money(preview.uncovered),
                  limit: money(discretionaryLimit),
                })}
              />
            )}

            <div className="flex justify-end">
              <Button
              onClick={onSubmit}
              loading={submitting}
              disabled={!lines?.length}
              title={lines?.length ? undefined : t('portal.declarations.noLines')}
            >
                {t('portal.declarations.actions.submit')}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
