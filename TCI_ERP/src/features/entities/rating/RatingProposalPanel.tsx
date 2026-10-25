/**
 * Rating proposals on the rating tab (migration 0073):
 *
 *  * «Задать рейтинг вручную» — a manual grade, statements optional, a reason
 *    required; it comes into force only when a second person confirms it;
 *  * «Отправить на валидацию» — a grade for the buyer's current, unconfirmed
 *    engine rating (the recommended one or another), to a colleague or
 *    escalated up the credit authority levels;
 *  * the pending proposal: with whom it sits, and the answers (approve /
 *    another grade / return / reject / forward up a rank), the committee's
 *    vote, the proposer's withdrawal;
 *  * the history of earlier proposals.
 *
 * The database decides; nothing here is optimistic.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  KeyFigures,
  Modal,
  SectionTitle,
  Segmented,
  Select,
  Textarea,
} from '../../../components/ui'
import { useAuth } from '../../../auth/AuthContext'
import { EM_DASH, formatMoment } from '../../../lib/format'
import { gradeTone } from '../../../lib/grade'
import type { GradeBand } from '../../../lib/gradeScale'
import { refusalOr } from '../../../lib/optimistic'
import { DEEP_LINK_SCROLL_MARGIN } from '../../../lib/useDeepLinkFocus'
import { levelName } from '../../limits/levelName'
import { closeNeedsComment, committeeOutcome, voteNeedsComment } from '../../limits/validation'
import type { CommitteeVote } from '../../limits/validation'
import type { StatementBundle } from '../types'
import { statementPeriodLabel } from '../types'
import type { AssessmentRow } from './assessmentsApi'
import {
  mayForward,
  normaliseGrade,
  outcomeGrade,
  proposalActionNeedsComment,
  proposalTone,
} from './proposals'
import type { PendingProposal, ProposalAction, ProposalState } from './proposals'
import { useProposalActions, useRatingProposals } from './proposalsApi'

/** `?focus=rating-proposal` (the Agenda) lands here. */
export const RATING_PROPOSAL_ANCHOR = 'rating-proposal'

const CREDIT_DESK = ['admin', 'credit_underwriter', 'credit_analyst'] as const

export function RatingProposalPanel({
  entityId,
  current,
  statements,
  bands,
  locale,
}: {
  entityId: string
  /** The buyer's current (latest) assessment, if any. */
  current: AssessmentRow | null
  statements: StatementBundle[]
  bands: GradeBand[] | undefined
  locale: string
}) {
  const { t } = useTranslation()
  const { roles } = useAuth()
  const onDesk = roles.some((r) => (CREDIT_DESK as readonly string[]).includes(r))
  const state = useRatingProposals(entityId, onDesk)
  const [proposing, setProposing] = useState<'manual' | 'engine' | null>(null)

  if (!onDesk || !state.data) return null
  const { pending, history, can_propose } = state.data
  // A grade for the engine rating is offered while it waits for a confirmation.
  const engineOpen = current !== null && current.source === 'engine' && current.confirmed_at === null
  if (!pending && history.length === 0 && !can_propose) return null

  return (
    <div id={RATING_PROPOSAL_ANCHOR} className={`rounded-lg ${DEEP_LINK_SCROLL_MARGIN}`}>
      <Card className="flex flex-col gap-4 p-5" data-testid="rating-proposals">
        <SectionTitle
          hint={t('rating.proposals.hint')}
          actions={
            can_propose ? (
              <span className="inline-flex flex-wrap gap-2">
                {engineOpen && (
                  <Button variant="secondary" onClick={() => setProposing('engine')}>
                    {t('rating.proposals.sendEngine')}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setProposing('manual')}>
                  {t('rating.proposals.manualAction')}
                </Button>
              </span>
            ) : undefined
          }
        >
          {t('rating.proposals.title')}
        </SectionTitle>

        {pending ? (
          <PendingView entityId={entityId} pending={pending} bands={bands} locale={locale} />
        ) : (
          history.length === 0 && <p className="text-[0.8125rem] text-slate-500">{t('rating.proposals.none')}</p>
        )}

        {history.length > 0 && <HistoryList state={state.data} locale={locale} />}
      </Card>

      {proposing && (
        <ProposeModal
          entityId={entityId}
          kind={proposing}
          current={current}
          statements={statements}
          bands={bands}
          onClose={() => setProposing(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The grade picker: the scale when the service serves it, else a typed grade
// ---------------------------------------------------------------------------

function GradeField({
  value,
  onChange,
  bands,
  label,
  recommended,
}: {
  value: string
  onChange: (grade: string) => void
  bands: GradeBand[] | undefined
  label: string
  recommended?: string | null
}) {
  const { t } = useTranslation()
  if (bands?.length) {
    return (
      <Field label={label}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('common.notSelected')}</option>
          {bands.map((b) => (
            <option key={b.code} value={b.code}>
              {b.code === recommended ? t('rating.confirmation.engineOption', { grade: b.code }) : b.code}
            </option>
          ))}
        </Select>
      </Field>
    )
  }
  return (
    <Field label={label} hint={t('rating.proposals.gradeTyped')}>
      <Input value={value} maxLength={3} onChange={(e) => onChange(e.target.value.toUpperCase())} />
    </Field>
  )
}

// ---------------------------------------------------------------------------
// Proposing
// ---------------------------------------------------------------------------

function ProposeModal({
  entityId,
  kind,
  current,
  statements,
  bands,
  onClose,
}: {
  entityId: string
  kind: 'manual' | 'engine'
  current: AssessmentRow | null
  statements: StatementBundle[]
  bands: GradeBand[] | undefined
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { propose } = useProposalActions(entityId)
  const recommended = kind === 'engine' ? (current?.engine_grade ?? current?.rating_grade ?? null) : null
  const [grade, setGrade] = useState(recommended ?? '')
  const [reason, setReason] = useState('')
  const [statementId, setStatementId] = useState('')
  const [route, setRoute] = useState<'colleague' | 'escalate'>('colleague')
  const [error, setError] = useState<string | null>(null)

  const normalised = normaliseGrade(grade)
  const canSubmit = normalised !== null && reason.trim().length > 0

  const submit = async () => {
    if (!normalised) return
    setError(null)
    try {
      await propose.mutateAsync({
        grade: normalised,
        reason: reason.trim(),
        assessmentId: kind === 'engine' ? (current?.id ?? null) : null,
        statementId: kind === 'manual' && statementId ? statementId : null,
        escalate: route === 'escalate',
      })
      onClose()
    } catch (failure) {
      setError(t(refusalOr(failure, 'rating.proposals.failed')))
    }
  }

  return (
    <Modal
      open
      title={kind === 'manual' ? t('rating.proposals.manualTitle') : t('rating.proposals.engineTitle')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={propose.isPending} disabled={!canSubmit} onClick={() => void submit()}>
            {route === 'escalate' ? t('rating.proposals.submitEscalate') : t('rating.proposals.submitColleague')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-600">
          {kind === 'manual' ? t('rating.proposals.manualHint') : t('rating.proposals.engineHint', { grade: recommended ?? EM_DASH })}
        </p>
        <GradeField
          value={grade}
          onChange={setGrade}
          bands={bands}
          label={t('rating.proposals.grade')}
          recommended={recommended}
        />
        {kind === 'manual' && statements.length > 0 && (
          <Field label={t('rating.proposals.statement')} hint={t('rating.proposals.statementOptional')}>
            <Select value={statementId} onChange={(e) => setStatementId(e.target.value)}>
              <option value="">{t('rating.proposals.noStatement')}</option>
              {statements.map((s) => (
                <option key={s.id} value={s.id}>
                  {statementPeriodLabel(s)} · {s.currency_code}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('rating.proposals.reason')} hint={t('rating.proposals.reasonRequired')}>
          <Textarea value={reason} rows={3} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label={t('rating.proposals.route')}>
          <Segmented
            value={route}
            options={[
              { key: 'colleague', label: t('rating.proposals.routes.colleague') },
              { key: 'escalate', label: t('rating.proposals.routes.escalate') },
            ]}
            onChange={(key) => setRoute(key as 'colleague' | 'escalate')}
          />
        </Field>
        <p className="text-[0.8125rem] text-slate-500">
          {route === 'escalate' ? t('rating.proposals.routeHintEscalate') : t('rating.proposals.routeHintColleague')}
        </p>
        {error && (
          <div className="text-sm text-neg-500" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// The pending proposal
// ---------------------------------------------------------------------------

type Dialog =
  | { kind: 'answer'; action: ProposalAction }
  | { kind: 'vote'; vote: CommitteeVote }
  | { kind: 'conflict' }
  | { kind: 'close' }
  | { kind: 'withdraw' }

function PendingView({
  entityId,
  pending,
  bands,
  locale,
}: {
  entityId: string
  pending: PendingProposal
  bands: GradeBand[] | undefined
  locale: string
}) {
  const { t } = useTranslation()
  const actions = useProposalActions(entityId)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [grade, setGrade] = useState('')
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const committee = pending.committee
  const where =
    pending.route === 'colleague'
      ? t('rating.proposals.withColleague')
      : levelName(t, 'credit', pending.rank, pending.is_committee)
  const chairVote = committee?.votes.find((v) => v.voter === committee.chair_id)?.vote ?? null
  const outcome = committee ? committeeOutcome({ approve: committee.approve, reject: committee.reject, chairVote }) : 'return'

  const needsComment =
    dialog === null
      ? false
      : dialog.kind === 'answer'
        ? proposalActionNeedsComment(dialog.action)
        : dialog.kind === 'vote'
          ? voteNeedsComment(dialog.vote)
          : dialog.kind === 'conflict'
            ? true
            : dialog.kind === 'close'
              ? closeNeedsComment(outcome)
              : false
  const needsGrade = dialog?.kind === 'answer' && dialog.action === 'approve_modified'
  const ready =
    (!needsComment || comment.trim().length > 0) &&
    (!needsGrade || (normaliseGrade(grade) !== null && normaliseGrade(grade) !== pending.grade))
  const busy = Object.values(actions).some((m) => m.isPending)

  const open = (next: Dialog) => {
    setDialog(next)
    setGrade('')
    setComment('')
    setError(null)
  }

  const run = async () => {
    if (!dialog) return
    setError(null)
    const text = comment.trim() || null
    try {
      if (dialog.kind === 'answer') {
        await actions.resolve.mutateAsync({
          stepId: pending.step_id,
          action: dialog.action,
          grade: needsGrade ? normaliseGrade(grade) : null,
          comment: text,
        })
      } else if (dialog.kind === 'vote') {
        await actions.vote.mutateAsync({ stepId: pending.step_id, vote: dialog.vote, comment: text })
      } else if (dialog.kind === 'conflict') {
        await actions.conflict.mutateAsync({ stepId: pending.step_id, reason: comment.trim() })
      } else if (dialog.kind === 'close') {
        await actions.close.mutateAsync({ stepId: pending.step_id, comment: text })
      } else {
        await actions.withdraw.mutateAsync({ stepId: pending.step_id, comment: text })
      }
      setDialog(null)
    } catch (failure) {
      setError(t(refusalOr(failure, 'rating.proposals.failed')))
    }
  }

  const dialogTitle =
    dialog === null
      ? ''
      : dialog.kind === 'answer'
        ? t(`rating.proposals.actions.${dialog.action}`)
        : dialog.kind === 'vote'
          ? t(`limits.validation.voteActions.${dialog.vote}`)
          : dialog.kind === 'conflict'
            ? t('limits.validation.voteActions.conflict')
            : dialog.kind === 'close'
              ? t('limits.validation.voteActions.close')
              : t('rating.proposals.withdraw')

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <Badge tone="warn">{t('rating.proposals.statuses.pending')}</Badge>
        <span className="flex items-center gap-2">
          <span className="text-slate-500">{t('rating.proposals.grade')}</span>
          <Badge tone={gradeTone(pending.grade)}>{pending.grade}</Badge>
        </span>
        {pending.manual && <Badge tone="neutral">{t('rating.proposals.manual')}</Badge>}
        <span className="text-slate-600">
          {t('rating.proposals.sitsWith', { where, date: formatMoment(pending.opened_at, locale) })}
        </span>
      </div>
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[0.8125rem] text-slate-700">
        <span className="block text-xs font-medium text-slate-500">
          {t('rating.proposals.reasonBy', {
            name: pending.proposed_by_name ?? EM_DASH,
            date: formatMoment(pending.proposed_at, locale),
          })}
        </span>
        <span className="whitespace-pre-line">{pending.reason}</span>
      </div>
      {!pending.is_committee && (
        <p className="text-[0.8125rem] text-slate-600">
          {pending.answerers.length > 0
            ? t('rating.proposals.answerers', { names: pending.answerers.map((a) => a.name ?? EM_DASH).join(', ') })
            : t('rating.proposals.noAnswerers')}
        </p>
      )}

      {committee && (
        <>
          <KeyFigures
            className=""
            items={[
              { label: t('limits.validation.committeePanel.approve'), value: String(committee.approve), tone: 'pos' },
              { label: t('limits.validation.committeePanel.reject'), value: String(committee.reject), tone: 'neg' },
              { label: t('limits.validation.committeePanel.abstain'), value: String(committee.abstain) },
              {
                label: t('limits.validation.committeePanel.turnout'),
                value: `${committee.cast} / ${committee.electorate}`,
                meta: committee.quorum_met
                  ? t('limits.validation.committeePanel.quorumMet')
                  : t('limits.validation.committeePanel.quorumNot'),
              },
            ]}
          />
          <p className="text-[0.8125rem] text-slate-600">
            {t('limits.validation.committeePanel.chair', { name: committee.chair_name ?? EM_DASH })}
            {' · '}
            {t('limits.validation.committeePanel.rule')}
          </p>
          {committee.votes.length > 0 && (
            <ul className="flex flex-col gap-1 text-[0.8125rem] text-slate-700">
              {committee.votes.map((v) => (
                <li key={v.voter}>
                  <span className="text-slate-500">{formatMoment(v.voted_at, locale)}</span> · {v.name ?? EM_DASH} ·{' '}
                  {t(`limits.validation.votes.${v.vote}`)}
                  {v.comment && <> — «{v.comment}»</>}
                </li>
              ))}
            </ul>
          )}
          {committee.conflicts.length > 0 && (
            <ul className="flex flex-col gap-1 text-[0.8125rem] text-slate-500">
              {committee.conflicts.map((c) => (
                <li key={c.member}>
                  {t('limits.validation.committeePanel.conflictOf', { name: c.name ?? EM_DASH })} — «{c.reason}»
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="flex flex-wrap gap-2">
        {pending.can_answer && (
          <>
            <Button onClick={() => open({ kind: 'answer', action: 'approve' })}>{t('rating.proposals.actions.approve')}</Button>
            <Button variant="secondary" onClick={() => open({ kind: 'answer', action: 'approve_modified' })}>
              {t('rating.proposals.actions.approve_modified')}
            </Button>
            <Button variant="secondary" onClick={() => open({ kind: 'answer', action: 'return' })}>
              {t('rating.proposals.actions.return')}
            </Button>
            <Button variant="secondary" onClick={() => open({ kind: 'answer', action: 'reject' })}>
              {t('rating.proposals.actions.reject')}
            </Button>
            {mayForward(pending) && (
              <Button variant="ghost" onClick={() => open({ kind: 'answer', action: 'forward' })}>
                {t('rating.proposals.actions.forward')}
              </Button>
            )}
          </>
        )}
        {committee?.i_may_vote && (
          <>
            {(['approve', 'reject', 'abstain'] as const).map((v) => (
              <Button key={v} variant={v === 'approve' ? 'primary' : 'secondary'} onClick={() => open({ kind: 'vote', vote: v })}>
                {t(`limits.validation.voteActions.${v}`)}
              </Button>
            ))}
            <Button variant="ghost" onClick={() => open({ kind: 'conflict' })}>
              {t('limits.validation.voteActions.conflict')}
            </Button>
          </>
        )}
        {committee?.i_may_close && (
          <Button variant="secondary" disabled={!committee.quorum_met} onClick={() => open({ kind: 'close' })}>
            {t('limits.validation.voteActions.close')}
          </Button>
        )}
        {pending.mine && (
          <Button variant="ghost" onClick={() => open({ kind: 'withdraw' })}>
            {t('rating.proposals.withdraw')}
          </Button>
        )}
      </div>

      <Modal
        open={dialog !== null}
        title={dialogTitle}
        onClose={() => setDialog(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={busy} disabled={!ready} onClick={() => void run()}>
              {dialogTitle}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {dialog?.kind === 'close' && (
            <p className="text-sm text-slate-600">{`${t('limits.validation.committeePanel.closeWillRecord')} ${t(`rating.proposals.committeeOutcome.${outcome}`)}`}</p>
          )}
          {needsGrade && (
            <GradeField value={grade} onChange={setGrade} bands={bands} label={t('rating.proposals.otherGrade')} />
          )}
          <Field
            label={dialog?.kind === 'conflict' ? t('limits.validation.committeePanel.conflictReason') : t('rating.confirmation.comment')}
            hint={needsComment ? t('rating.proposals.commentRequired') : t('rating.confirmation.commentOptional')}
          >
            <Textarea value={comment} rows={3} onChange={(e) => setComment(e.target.value)} />
          </Field>
          {error && (
            <div className="text-sm text-neg-500" role="alert">
              {error}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function HistoryList({ state, locale }: { state: ProposalState; locale: string }) {
  const { t } = useTranslation()
  return (
    <details className="text-[0.8125rem] text-slate-700">
      <summary className="cursor-pointer font-medium text-accent-700">
        {t('rating.proposals.history', { count: state.history.length })}
      </summary>
      <ul className="mt-2 flex flex-col gap-2">
        {state.history.map((h) => {
          const result = outcomeGrade(h)
          return (
            <li key={h.step_id} className="flex flex-col gap-0.5 border-l-2 border-slate-200 pl-3">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500">{formatMoment(h.resolved_at, locale)}</span>
                <Badge tone={proposalTone(h.status)}>{t(`rating.proposals.statuses.${h.status}`)}</Badge>
                <Badge tone={gradeTone(h.grade)}>{h.grade}</Badge>
                {result && result !== h.grade && (
                  <>
                    → <Badge tone={gradeTone(result)}>{result}</Badge>
                  </>
                )}
                {h.manual && <Badge tone="neutral">{t('rating.proposals.manual')}</Badge>}
                <span className="text-slate-500">
                  {h.route === 'colleague' ? t('rating.proposals.withColleague') : levelName(t, 'credit', h.rank, h.is_committee)}
                </span>
              </span>
              <span className="text-slate-600">
                {t('rating.proposals.historyLine', {
                  proposer: h.proposed_by_name ?? EM_DASH,
                  resolver: h.resolved_by_name ?? EM_DASH,
                })}
                {h.comment && <> — «{h.comment}»</>}
              </span>
            </li>
          )
        })}
      </ul>
    </details>
  )
}
