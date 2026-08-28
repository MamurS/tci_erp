/**
 * One declaration: its lines, the coverage split, and the actions the status
 * machine allows.
 *
 * The split is NOT computed here. It comes from tci.v_declaration_lines,
 * which freezes it on acceptance and computes it live before that — so the
 * screen and the premium it earns can never disagree.
 */

import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Spinner,
  Table,
} from '../../components/ui'
import { EM_DASH, formatAmount, formatMoment } from '../../lib/format'
import {
  useAcceptDeclaration,
  useCorrectDeclaration,
  useDeclaration,
  useDeclarationLines,
  useDeclarationTotals,
  useDisputeDeclaration,
  useSubmitDeclaration,
} from './api'
import { canCorrect, canTransition } from './machine'
import type { CoverageBasis } from './types'

const BASIS_TONE: Record<CoverageBasis, 'pos' | 'neutral' | 'warn'> = {
  limit: 'pos',
  discretionary: 'neutral',
  uncovered_excess: 'warn',
}

export function DeclarationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t, i18n } = useTranslation()
  const locale = i18n.language

  const { data: declaration, isLoading } = useDeclaration(id)
  const { data: lines } = useDeclarationLines(id)
  const { data: totals } = useDeclarationTotals(id)

  const submit = useSubmitDeclaration()
  const accept = useAcceptDeclaration()
  const dispute = useDisputeDeclaration()
  const correct = useCorrectDeclaration()

  const [disputeNote, setDisputeNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (isLoading) return <Spinner label={t('common.loading')} />
  if (!declaration) return <EmptyState title={t('declarations.notFound')} />

  const run = (p: Promise<unknown>) => {
    setError(null)
    p.catch((e: { message?: string }) => setError(e.message ?? t('common.somethingWentWrong')))
  }

  const uncovered = Number(totals?.uncovered_excess ?? 0)

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title={`${declaration.period_start} ${EM_DASH} ${declaration.period_end}`}
        subtitle={declaration.policies?.policy_number ?? undefined}
        actions={
          <div className="flex gap-2">
            {canTransition(declaration.status, 'submitted') && (
              <Button onClick={() => run(submit.mutateAsync(declaration.id))}>
                {t('declarations.actions.submit')}
              </Button>
            )}
            {canTransition(declaration.status, 'accepted') && (
              <Button onClick={() => run(accept.mutateAsync(declaration.id))}>
                {t('declarations.actions.accept')}
              </Button>
            )}
            {canCorrect(declaration.status) && (
              <Button
                variant="secondary"
                onClick={() => run(correct.mutateAsync({ id: declaration.id }))}
              >
                {t('declarations.actions.correct')}
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <p role="alert" className="rounded-md bg-neg-50 px-3 py-2 text-[13px] text-neg-500">
          {error}
        </p>
      )}

      {declaration.supersedes_id && (
        <p className="text-[13px] text-slate-500">{t('declarations.correctionOf')}</p>
      )}

      {declaration.status === 'disputed' && declaration.dispute_note && (
        <Card className="border-warn-500/40 bg-warn-50">
          <p className="text-sm font-semibold text-slate-800">{t('declarations.disputed')}</p>
          <p className="mt-1 text-[13px] text-slate-700">{declaration.dispute_note}</p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs text-slate-500">{t('declarations.fields.totalTurnover')}</p>
          <p className="num mt-1 text-xl font-semibold">
            {formatAmount(Number(declaration.total_insurable_turnover), locale)}{' '}
            {declaration.currency_code}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-slate-500">{t('declarations.fields.coveredTurnover')}</p>
          <p className="num mt-1 text-xl font-semibold">
            {totals ? formatAmount(Number(totals.covered_turnover), locale) : EM_DASH}{' '}
            {declaration.currency_code}
          </p>
          <p className="mt-1 text-xs text-slate-500">{t('declarations.premiumBaseHint')}</p>
        </Card>
        <Card className={uncovered > 0 ? 'border-warn-500/40 bg-warn-50' : ''}>
          <p className="text-xs text-slate-500">{t('declarations.fields.uncoveredExcess')}</p>
          <p className="num mt-1 text-xl font-semibold">
            {totals ? formatAmount(uncovered, locale) : EM_DASH} {declaration.currency_code}
          </p>
          {uncovered > 0 && (
            <p className="mt-1 text-xs text-slate-700">{t('declarations.uncoveredHint')}</p>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold">{t('declarations.lines')}</h2>
        {!lines?.length ? (
          <EmptyState title={t('declarations.noLines')} hint={t('declarations.noLinesHint')} />
        ) : (
          <Table dense>
            <thead>
              <tr>
                <th>{t('limits.fields.buyer')}</th>
                <th className="text-right">{t('declarations.fields.insurableTurnover')}</th>
                <th>{t('declarations.fields.coverageBasis')}</th>
                <th className="text-right">{t('declarations.fields.covered')}</th>
                <th className="text-right">{t('declarations.fields.uncovered')}</th>
                <th className="text-right">{t('declarations.fields.reportedOverdue')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="font-medium text-slate-800">{l.entity_name}</td>
                  <td>
                    <span className="num block">
                      {formatAmount(Number(l.insurable_turnover), locale)}
                    </span>
                  </td>
                  <td>
                    <Badge tone={BASIS_TONE[l.coverage_basis]}>
                      {t(`declarations.coverageBasis.${l.coverage_basis}`)}
                    </Badge>
                  </td>
                  <td>
                    <span className="num block">{formatAmount(Number(l.covered_amount), locale)}</span>
                  </td>
                  <td>
                    <span
                      className={`num block ${Number(l.uncovered_excess) > 0 ? 'text-warn-500 font-medium' : ''}`}
                    >
                      {formatAmount(Number(l.uncovered_excess), locale)}
                    </span>
                  </td>
                  <td>
                    <span className="num block">
                      {l.overdue_amount === null
                        ? EM_DASH
                        : formatAmount(Number(l.overdue_amount), locale)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {totals?.split_frozen && (
          <p className="mt-2 text-xs text-slate-500">{t('declarations.splitFrozen')}</p>
        )}
      </Card>

      {canTransition(declaration.status, 'disputed') && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold">{t('declarations.actions.dispute')}</h2>
          <Field label={t('declarations.fields.disputeNote')}>
            <Input
              value={disputeNote}
              onChange={(e) => setDisputeNote(e.target.value)}
              placeholder={t('declarations.disputeNotePlaceholder')}
            />
          </Field>
          <Button
            className="mt-3"
            variant="secondary"
            disabled={!disputeNote.trim()}
            onClick={() => run(dispute.mutateAsync({ id: declaration.id, note: disputeNote }))}
          >
            {t('declarations.actions.dispute')}
          </Button>
        </Card>
      )}

      <p className="text-xs text-slate-500">
        {declaration.submitted_at &&
          `${t('declarations.fields.submittedAt')}: ${formatMoment(declaration.submitted_at, locale)}`}
        {declaration.accepted_at &&
          ` · ${t('declarations.fields.acceptedAt')}: ${formatMoment(declaration.accepted_at, locale)}`}
      </p>
    </div>
  )
}
