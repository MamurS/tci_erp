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
  COL,
  DetailHeader,
  EmptyState,
  Field,
  KeyFigures,
  labelCol,
  Modal,
  Panel,
  Spinner,
  Table,
  Textarea,
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
import { useAuth } from '../../auth/AuthContext'
import { canCorrect, canTransition, mayMoveAs } from './machine'
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

  const { roles } = useAuth()
  const { data: declaration, isLoading } = useDeclaration(id)
  const { data: lines } = useDeclarationLines(id)
  const { data: totals } = useDeclarationTotals(id)

  const submit = useSubmitDeclaration()
  const accept = useAcceptDeclaration()
  const dispute = useDisputeDeclaration()
  const correct = useCorrectDeclaration()

  const [disputeNote, setDisputeNote] = useState('')
  const [disputing, setDisputing] = useState(false)
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
            {canTransition(declaration.status, 'submitted') && mayMoveAs('submitted', roles) && (
              <Button loading={submit.isPending} onClick={() => run(submit.mutateAsync(declaration.id))}>
                {t('declarations.actions.submit')}
              </Button>
            )}
            {canTransition(declaration.status, 'accepted') && mayMoveAs('accepted', roles) && (
              <Button loading={accept.isPending} onClick={() => run(accept.mutateAsync(declaration.id))}>
                {t('declarations.actions.accept')}
              </Button>
            )}
            {/* Sending it back is the alternative to accepting, not a peer of
                it: a secondary button, and the note is asked for in a dialog. */}
            {canTransition(declaration.status, 'disputed') && mayMoveAs('disputed', roles) && (
              <Button variant="secondary" onClick={() => setDisputing(true)}>
                {t('declarations.actions.dispute')}
              </Button>
            )}
            {canCorrect(declaration.status) && mayMoveAs('corrected', roles) && (
              <Button
                variant="secondary"
                loading={correct.isPending}
                onClick={() => run(correct.mutateAsync({ id: declaration.id }))}
              >
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
          <Table dense columns={[COL.fill, '8.5rem', labelCol('coverageBasis'), '8.5rem', '8.5rem', '8.5rem']}>
            <thead>
              <tr>
                <th>{t('limits.fields.buyer')}</th>
                <th className="num">{t('declarations.fields.insurableTurnover')}</th>
                <th>{t('declarations.fields.coverageBasis')}</th>
                <th className="num">{t('declarations.fields.covered')}</th>
                <th className="num">{t('declarations.fields.uncovered')}</th>
                <th className="num">{t('declarations.fields.reportedOverdue')}</th>
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
                      {/* Nothing reported reads «—», not a 0 that looks like a figure. */}
                      {l.overdue_amount === null || Number(l.overdue_amount) === 0
                        ? EM_DASH
                        : formatAmount(Number(l.overdue_amount), locale)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </Panel>

      <Modal
        open={disputing}
        title={t('declarations.actions.dispute')}
        onClose={() => setDisputing(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDisputing(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!disputeNote.trim()}
              loading={dispute.isPending}
              title={disputeNote.trim() ? undefined : t('declarations.disputeNoteRequired')}
              onClick={() => {
                setError(null)
                // The status paints at once (optimistic), so the dialog
                // closes at once; the note is kept until the server agrees.
                setDisputing(false)
                dispute
                  .mutateAsync({ id: declaration.id, note: disputeNote.trim() })
                  .then(() => setDisputeNote(''))
                  .catch((e: unknown) => setError(t(refusalKey(e))))
              }}
            >
              {t('declarations.actions.dispute')}
            </Button>
          </>
        }
      >
        <p className="text-[13px] leading-relaxed text-slate-600">{t('declarations.disputeHint')}</p>
        <Field label={t('declarations.fields.disputeNote')}>
          <Textarea
            rows={4}
            autoFocus
            value={disputeNote}
            onChange={(e) => setDisputeNote(e.target.value)}
            placeholder={t('declarations.disputeNotePlaceholder')}
          />
        </Field>
      </Modal>
    </div>
  )
}
