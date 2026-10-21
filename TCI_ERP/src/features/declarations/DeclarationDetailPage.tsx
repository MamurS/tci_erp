/**
 * One declaration: its lines, the coverage split, and the actions the status
 * machine allows.
 *
 * The split is NOT computed here. It comes from tci.v_declaration_lines,
 * which freezes it on acceptance and computes it live before that — so the
 * screen and the premium it earns can never disagree.
 */

import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Callout,
  DetailHeader,
  EmptyState,
  Field,
  Input,
  KeyFigures,
  Panel,
  Spinner,
  Table,
  Truncate,
} from '../../components/ui'
import { EM_DASH, formatAmount, formatMoment, formatPeriod } from '../../lib/format'
import { STATUS_TONE } from './status'
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
import { refusalKey } from '../../lib/refusals'

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
    p.catch((e: unknown) => setError(t(refusalKey(e))))
  }

  const uncovered = Number(totals?.uncovered_excess ?? 0)

  const cur = declaration.currency_code
  const policyholder = declaration.policies?.legal_entities?.name

  return (
    <div>
      <DetailHeader
        eyebrow={t('declarations.eyebrow')}
        title={formatPeriod(declaration.period_start, declaration.period_end, locale)}
        status={<Badge tone={STATUS_TONE[declaration.status]}>{t(`declarations.statuses.${declaration.status}`)}</Badge>}
        meta={[
          declaration.policies?.policy_number && (
            <Link to={`/policies/${declaration.policy_id}`} className="text-accent-600 hover:underline">
              {declaration.policies.policy_number}
            </Link>
          ),
          policyholder,
          declaration.submitted_at &&
            `${t('declarations.fields.submittedAt')} ${formatMoment(declaration.submitted_at, locale)}`,
          declaration.accepted_at &&
            `${t('declarations.fields.acceptedAt')} ${formatMoment(declaration.accepted_at, locale)}`,
        ]}
        actions={
          <>
            {canTransition(declaration.status, 'submitted') && (
              <Button onClick={() => run(submit.mutateAsync(declaration.id))}>{t('declarations.actions.submit')}</Button>
            )}
            {canTransition(declaration.status, 'accepted') && (
              <Button onClick={() => run(accept.mutateAsync(declaration.id))}>{t('declarations.actions.accept')}</Button>
            )}
            {canCorrect(declaration.status) && (
              <Button variant="secondary" onClick={() => run(correct.mutateAsync({ id: declaration.id }))}>
                {t('declarations.actions.correct')}
              </Button>
            )}
          </>
        }
      />

      <div className="space-y-3 empty:hidden [&:not(:empty)]:mb-6">
        {error && <Callout tone="neg" title={error} />}
        {declaration.supersedes_id && <Callout tone="info" title={t('declarations.correctionOf')} />}
        {declaration.status === 'disputed' && declaration.dispute_note && (
          <Callout tone="warn" title={t('declarations.disputed')}>
            {declaration.dispute_note}
          </Callout>
        )}
        {uncovered > 0 && <Callout tone="warn" title={t('declarations.uncoveredHint')} />}
      </div>

      <KeyFigures
        items={[
          {
            label: t('declarations.fields.totalTurnover'),
            value: `${formatAmount(Number(declaration.total_insurable_turnover), locale)} ${cur}`,
          },
          {
            label: t('declarations.fields.coveredTurnover'),
            value: totals ? `${formatAmount(Number(totals.covered_turnover), locale)} ${cur}` : EM_DASH,
            meta: t('declarations.premiumBaseHint'),
            tone: 'pos',
          },
          {
            label: t('declarations.fields.uncoveredExcess'),
            value: totals ? `${formatAmount(uncovered, locale)} ${cur}` : EM_DASH,
            tone: uncovered > 0 ? 'warn' : 'muted',
          },
        ]}
      />

      <Panel
        title={t('declarations.lines')}
        hint={totals?.split_frozen ? t('declarations.splitFrozen') : undefined}
      >
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
              {lines.map((l) => {
                const excess = Number(l.uncovered_excess)
                return (
                  <tr key={l.id}>
                    <td className="font-medium text-slate-800">
                      <Truncate text={l.entity_name}>{l.entity_name}</Truncate>
                    </td>
                    <td className="num">{formatAmount(Number(l.insurable_turnover), locale)}</td>
                    <td>
                      <Badge tone={BASIS_TONE[l.coverage_basis]}>
                        {t(`declarations.coverageBasis.${l.coverage_basis}`)}
                      </Badge>
                    </td>
                    <td className="num">{formatAmount(Number(l.covered_amount), locale)}</td>
                    <td className={`num ${excess > 0 ? 'font-medium text-warn-500' : 'text-slate-400'}`}>
                      {excess > 0 ? formatAmount(excess, locale) : EM_DASH}
                    </td>
                    <td className="num">
                      {l.overdue_amount === null ? EM_DASH : formatAmount(Number(l.overdue_amount), locale)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Panel>

      {canTransition(declaration.status, 'disputed') && (
        <Panel title={t('declarations.actions.dispute')} className="mt-5">
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t('declarations.fields.disputeNote')} className="min-w-72 flex-1">
              <Input
                value={disputeNote}
                onChange={(e) => setDisputeNote(e.target.value)}
                placeholder={t('declarations.disputeNotePlaceholder')}
              />
            </Field>
            <Button
              variant="dangerOutline"
              disabled={!disputeNote.trim()}
              onClick={() => run(dispute.mutateAsync({ id: declaration.id, note: disputeNote }))}
            >
              {t('declarations.actions.dispute')}
            </Button>
          </div>
        </Panel>
      )}
    </div>
  )
}
