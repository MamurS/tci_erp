/**
 * The confirmation of the current rating (migration 0069). The engine
 * calculates a grade; a person confirms it — or, with a reason, sets another
 * grade of the scale — and from then on that grade is the one in force for
 * every decision on the buyer. Never by the one who calculated it.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, Field, Modal, Select, Textarea } from '../../../components/ui'
import { useAuth } from '../../../auth/AuthContext'
import { formatMoment } from '../../../lib/format'
import { gradeTone } from '../../../lib/grade'
import type { GradeBand } from '../../../lib/gradeScale'
import { refusalOr } from '../../../lib/optimistic'
import { useStaffDirectory } from '../../data/api'
import { mayConfirmRating } from '../access'
import type { CreditAnalysisMode } from '../../../lib/creditAnalysis'
import { useConfirmRating } from './assessmentsApi'
import type { AssessmentRow } from './assessmentsApi'

export function RatingConfirmation({
  entityId,
  current,
  bands,
  mode,
  locale,
  proposalPending = false,
}: {
  entityId: string
  /** The buyer's current (latest) assessment. */
  current: AssessmentRow
  bands: GradeBand[] | undefined
  mode: CreditAnalysisMode
  locale: string
  /** A rating proposal is waiting (0073): it is answered there, not here. */
  proposalPending?: boolean
}) {
  const { t } = useTranslation()
  const { roles, session } = useAuth()
  const people = useStaffDirectory()
  const confirm = useConfirmRating()
  const [open, setOpen] = useState(false)
  const engineGrade = current.engine_grade ?? current.rating_grade
  const [grade, setGrade] = useState(engineGrade)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const uid = session?.user.id
  const manual = current.source === 'manual'
  const mayConfirm = !proposalPending && mayConfirmRating(roles, mode, current, uid)
  const ownRating = !current.confirmed_at && current.created_by === uid && current.created_by !== null
  const overridden = !manual && current.confirmed_at !== null && current.rating_grade !== engineGrade
  const nameOf = (id: string | null) =>
    (id && (people.data?.get(id)?.full_name || people.data?.get(id)?.email)) || t('rating.confirmation.someone')

  // Grades come from the analytics service; while it is unreachable only the
  // engine's own grade can be confirmed.
  const grades = bands?.length ? bands.map((b) => b.code) : [engineGrade]
  const needsComment = grade !== engineGrade
  const canSubmit = !needsComment || comment.trim().length > 0

  const submit = async () => {
    setError(null)
    try {
      await confirm.mutateAsync({
        entityId,
        assessmentId: current.id,
        grade: grade === engineGrade ? null : grade,
        comment,
      })
      setOpen(false)
      setComment('')
    } catch (failure) {
      setError(t(refusalOr(failure, 'common.somethingWentWrong')))
    }
  }

  return (
    <Card className="flex flex-wrap items-center gap-x-5 gap-y-2 p-5 text-sm" data-testid="rating-confirmation">
      {manual ? (
        // A manual grade (0073): set by a person, confirmed by a second one.
        <span className="flex items-center gap-2">
          <Badge tone="neutral">{t('rating.proposals.manual')}</Badge>
          {current.manual_reason && <span className="text-slate-600">«{current.manual_reason}»</span>}
        </span>
      ) : (
        <span className="flex items-center gap-2">
          <span className="text-slate-500">{t('rating.confirmation.engineGrade')}</span>
          <Badge tone={gradeTone(engineGrade)}>{engineGrade}</Badge>
        </span>
      )}
      <span className="flex items-center gap-2">
        <span className="text-slate-500">{t('rating.confirmation.gradeInForce')}</span>
        <Badge tone={gradeTone(current.rating_grade)}>{current.rating_grade}</Badge>
      </span>
      {/* The group's grade caps this buyer's (0074). */}
      {current.group_rating_id && <Badge tone="warn">{t('groups.rating.cappedBadge')}</Badge>}
      {current.confirmed_at ? (
        <span className="text-slate-600">
          {manual
            ? t('rating.proposals.manualBy', {
                author: nameOf(current.created_by),
                name: nameOf(current.confirmed_by),
                at: formatMoment(current.confirmed_at, locale),
              })
            : overridden
            ? t('rating.confirmation.overriddenBy', {
                name: nameOf(current.confirmed_by),
                at: formatMoment(current.confirmed_at, locale),
              })
            : t('rating.confirmation.confirmedBy', {
                name: nameOf(current.confirmed_by),
                at: formatMoment(current.confirmed_at, locale),
              })}
          {current.confirmation_comment && <> — «{current.confirmation_comment}»</>}
        </span>
      ) : (
        <Badge tone="warn">{t('rating.confirmation.unconfirmed')}</Badge>
      )}
      {mayConfirm && (
        <Button
          className="ml-auto"
          variant="secondary"
          onClick={() => {
            setGrade(engineGrade)
            setComment('')
            setError(null)
            setOpen(true)
          }}
        >
          {t('rating.confirmation.confirm')}
        </Button>
      )}
      {ownRating && !proposalPending && (
        <span className="ml-auto text-[0.8125rem] text-slate-500">{t('rating.confirmation.ownRating')}</span>
      )}

      <Modal
        open={open}
        title={t('rating.confirmation.title')}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={confirm.isPending} disabled={!canSubmit} onClick={() => void submit()}>
              {t('rating.confirmation.submit')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-slate-600">{t('rating.confirmation.hint', { grade: engineGrade })}</p>
          <Field label={t('rating.confirmation.grade')}>
            <Select value={grade} onChange={(e) => setGrade(e.target.value)}>
              {grades.map((code) => (
                <option key={code} value={code}>
                  {code === engineGrade ? t('rating.confirmation.engineOption', { grade: code }) : code}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('rating.confirmation.comment')}
            hint={needsComment ? t('rating.confirmation.commentRequired') : t('rating.confirmation.commentOptional')}
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
    </Card>
  )
}
