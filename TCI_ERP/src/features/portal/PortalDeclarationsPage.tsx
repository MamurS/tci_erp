/**
 * «Мои декларации» — the policyholder declares their turnover.
 *
 * The screen's job is to make the coverage split visible WHILE they type, not
 * after acceptance: a buyer without a limit is covered only up to the
 * discretionary limit, and anything above it is not insured. Telling them
 * afterwards would be telling them too late.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Spinner,
  Table,
} from '../../components/ui'
import { EM_DASH, formatAmount } from '../../lib/format'
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
    return p.catch((e: { message?: string }) =>
      setError(e.message ?? t('common.somethingWentWrong')),
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
            <Button onClick={startPeriod}>{t('portal.declarations.actions.declarePeriod')}</Button>
          ) : undefined
        }
      />

      {error && (
        <p role="alert" className="rounded-md bg-neg-50 px-3 py-2 text-[13px] text-neg-500">
          {error}
        </p>
      )}

      {isLoading ? (
        <Spinner label={t('common.loading')} />
      ) : !declarations?.length ? (
        <EmptyState
          title={t('portal.declarations.empty')}
          hint={t('portal.declarations.emptyHint')}
        />
      ) : (
        <Card>
          <Table dense>
            <thead>
              <tr>
                <th>{t('declarations.fields.period')}</th>
                <th className="text-right">{t('declarations.fields.totalTurnover')}</th>
                <th className="text-right">{t('declarations.fields.uncoveredExcess')}</th>
                <th className="text-right">{t('portal.declarations.premium')}</th>
                <th>{t('declarations.fields.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {declarations.map((d) => (
                <tr key={d.id} className={d.superseded ? 'text-slate-400' : undefined}>
                  <td className="font-medium">
                    {d.period_start} {EM_DASH} {d.period_end}
                  </td>
                  <td>
                    <span className="num block">
                      {formatAmount(Number(d.total_insurable_turnover), locale)}
                    </span>
                  </td>
                  <td>
                    <span
                      className={`num block ${Number(d.uncovered_excess ?? 0) > 0 ? 'font-medium text-warn-500' : ''}`}
                    >
                      {d.uncovered_excess === null
                        ? EM_DASH
                        : formatAmount(Number(d.uncovered_excess), locale)}
                    </span>
                  </td>
                  <td>
                    <span className="num block">
                      {d.premium_amount === null
                        ? EM_DASH
                        : formatAmount(Number(d.premium_amount), locale)}
                    </span>
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[d.status]}>
                      {t(`declarations.statuses.${d.status}`)}
                    </Badge>
                  </td>
                  <td className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setOpenId(d.id)}>
                      {t('common.open')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {openId && (
        <DeclarationEditor
          declaration={(declarations ?? []).find((d) => d.id === openId) ?? null}
          declarationId={openId}
          policyId={activePolicy?.id}
          discretionaryLimit={Number(activePolicy?.discretionary_limit ?? 0)}
          onSubmit={() => void run(submit.mutateAsync(openId))}
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
  onError,
}: {
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

  const editable = declaration?.status === 'draft' || declaration?.status === 'disputed'

  // The split the line WILL get, shown before it is saved. Mirrors
  // tci.classify_declaration_line exactly.
  const preview = useMemo(() => {
    const amount = Number(turnover)
    if (!buyerId || !Number.isFinite(amount) || amount <= 0) return null
    const hasLimit = (buyers ?? []).some((b) => b.entity_id === buyerId)
    return classifyLine(hasLimit, amount, discretionaryLimit)
  }, [buyerId, turnover, buyers, discretionaryLimit])

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">{t('portal.declarations.lines')}</h2>

      {declaration?.status === 'disputed' && declaration.dispute_note && (
        <div className="mb-3 rounded-md border border-warn-500/40 bg-warn-50 px-3 py-2">
          <p className="text-[13px] font-medium text-slate-800">
            {t('portal.declarations.disputed')}
          </p>
          <p className="text-[13px] text-slate-700">{declaration.dispute_note}</p>
        </div>
      )}

      {!lines?.length ? (
        <EmptyState title={t('portal.declarations.noLines')} />
      ) : (
        <Table dense>
          <thead>
            <tr>
              <th>{t('limits.fields.buyer')}</th>
              <th className="text-right">{t('declarations.fields.insurableTurnover')}</th>
              <th>{t('declarations.fields.coverageBasis')}</th>
              <th className="text-right">{t('declarations.fields.uncovered')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td className="font-medium">{l.entity_name}</td>
                <td>
                  <span className="num block">
                    {formatAmount(Number(l.insurable_turnover), locale)}
                  </span>
                </td>
                <td>
                  <Badge
                    tone={l.coverage_basis === 'uncovered_excess' ? 'warn' : 'neutral'}
                  >
                    {t(`declarations.coverageBasis.${l.coverage_basis}`)}
                  </Badge>
                </td>
                <td>
                  <span
                    className={`num block ${Number(l.uncovered_excess) > 0 ? 'font-medium text-warn-500' : ''}`}
                  >
                    {formatAmount(Number(l.uncovered_excess), locale)}
                  </span>
                </td>
                <td className="text-right">
                  {editable && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void remove
                          .mutateAsync(l.id)
                          .catch((e: { message?: string }) =>
                            onError(e.message ?? t('common.somethingWentWrong')),
                          )
                      }
                    >
                      {t('common.delete')}
                    </Button>
                  )}
                </td>
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
                    {b.entity_name} · {formatAmount(Number(b.approved_amount), locale)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('declarations.fields.insurableTurnover')}>
              <Input
                inputMode="decimal"
                value={turnover}
                onChange={(e) => setTurnover(e.target.value)}
              />
            </Field>
            <Button
              disabled={!buyerId || !Number(turnover)}
              onClick={() =>
                void save
                  .mutateAsync({
                    declaration_id: declarationId,
                    entity_id: buyerId,
                    turnover: Number(turnover),
                  })
                  .then(() => {
                    setBuyerId('')
                    setTurnover('')
                  })
                  .catch((e: { message?: string }) =>
                    onError(e.message ?? t('common.somethingWentWrong')),
                  )
              }
            >
              {t('common.add')}
            </Button>
          </div>

          {preview && preview.uncovered > 0 && (
            <p className="rounded-md border border-warn-500/40 bg-warn-50 px-3 py-2 text-[13px] text-slate-700">
              {t('portal.declarations.uncoveredWarning', {
                amount: formatAmount(preview.uncovered, locale),
                limit: formatAmount(discretionaryLimit, locale),
              })}
            </p>
          )}

          <Button onClick={onSubmit} disabled={!lines?.length}>
            {t('portal.declarations.actions.submit')}
          </Button>
        </div>
      )}
    </Card>
  )
}
