/**
 * «Рейтинг группы» on the group tab (migration 0074): the grade of the whole
 * group, which caps every member's grade in force. A senior credit analyst
 * sets, lowers, raises or ends it, with a reason; setting or lowering it
 * caps the members at once, while raising or ending it raises nobody — a
 * member goes up by being rated again. The credit desk and admin read it.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Card, Field, Input, Modal, SectionTitle, Select, Textarea } from '../../components/ui'
import { useAuth } from '../../auth/AuthContext'
import { EM_DASH, formatMoment } from '../../lib/format'
import { gradeTone } from '../../lib/grade'
import { useGradeScale } from '../../lib/gradeScale'
import { refusalOr } from '../../lib/optimistic'
import { hasRole } from '../../lib/roles'
import { normaliseGrade } from '../entities/rating/proposals'
import { useGroupRating, useGroupRatingActions } from './groupRatingApi'

export function GroupRatingCard({ entityId }: { entityId: string }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const { roles } = useAuth()
  const onDesk = hasRole(roles, 'admin', 'credit_underwriter', 'credit_analyst')
  const state = useGroupRating(entityId, onDesk)
  const [dialog, setDialog] = useState<'set' | 'end' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  if (!onDesk || !state.data) return null
  const { active, history, may_set, seniors, capped } = state.data

  return (
    <Card className="flex flex-col gap-3 p-5" data-testid="group-rating">
      <SectionTitle
        hint={t('groups.rating.hint')}
        actions={
          may_set ? (
            <span className="inline-flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDialog('set')}>
                {active ? t('groups.rating.change') : t('groups.rating.set')}
              </Button>
              {active && (
                <Button size="sm" variant="ghost" onClick={() => setDialog('end')}>
                  {t('groups.rating.end')}
                </Button>
              )}
            </span>
          ) : undefined
        }
      >
        {t('groups.rating.title')}
      </SectionTitle>

      {active ? (
        <div className="flex flex-col gap-2 text-sm">
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={gradeTone(active.grade)}>{active.grade}</Badge>
            <span className="text-slate-600">
              {t('groups.rating.setBy', { name: active.set_by_name ?? EM_DASH, at: formatMoment(active.set_at, locale) })}
            </span>
          </span>
          <span className="whitespace-pre-line text-[0.8125rem] text-slate-700">«{active.reason}»</span>
          <span className="text-[0.8125rem] text-slate-600">
            {capped.length > 0
              ? t('groups.rating.cappedMembers', { names: capped.map((c) => c.name).join(', ') })
              : t('groups.rating.noneCapped')}
          </span>
        </div>
      ) : (
        <p className="text-[0.8125rem] text-slate-500">
          {t('groups.rating.none')}
          {!may_set && (seniors.length > 0
            ? ` ${t('groups.rating.whoSets', { names: seniors.join(', ') })}`
            : ` ${t('groups.rating.noSenior')}`)}
        </p>
      )}

      {notice && <p className="text-[0.8125rem] text-slate-600" role="status">{notice}</p>}

      {history.length > 0 && (
        <details className="text-[0.8125rem] text-slate-700">
          <summary className="cursor-pointer font-medium text-accent-700">
            {t('groups.rating.history', { count: history.length })}
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={gradeTone(h.grade)}>{h.grade}</Badge>
                <span className="text-slate-500">
                  {formatMoment(h.set_at, locale)} — {h.ended_at ? formatMoment(h.ended_at, locale) : EM_DASH}
                </span>
                <span>{t(`groups.rating.statuses.${h.status}`)}</span>
                <span className="text-slate-500">«{h.end_reason ?? h.reason}»</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {dialog && (
        <GroupRatingDialog
          entityId={entityId}
          kind={dialog}
          current={active?.grade ?? null}
          onClose={() => setDialog(null)}
          onDone={(message) => {
            setDialog(null)
            setNotice(message)
          }}
        />
      )}
    </Card>
  )
}

function GroupRatingDialog({
  entityId,
  kind,
  current,
  onClose,
  onDone,
}: {
  entityId: string
  kind: 'set' | 'end'
  current: string | null
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { t } = useTranslation()
  const { data: bands } = useGradeScale()
  const { set, end } = useGroupRatingActions(entityId)
  const [grade, setGrade] = useState(current ?? '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const normalised = normaliseGrade(grade)
  const ready = reason.trim().length > 0 && (kind === 'end' || normalised !== null)

  const run = async () => {
    setError(null)
    try {
      if (kind === 'set' && normalised) {
        const state = await set.mutateAsync({ grade: normalised, reason: reason.trim() })
        onDone(t('groups.rating.cappedNow', { count: state.capped_now ?? 0 }))
      } else {
        await end.mutateAsync(reason.trim())
        onDone(t('groups.rating.ended'))
      }
    } catch (failure) {
      setError(t(refusalOr(failure, 'groups.rating.failed')))
    }
  }

  return (
    <Modal
      open
      title={kind === 'set' ? t('groups.rating.setTitle') : t('groups.rating.endTitle')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={set.isPending || end.isPending} disabled={!ready} onClick={() => void run()}>
            {kind === 'set' ? t('groups.rating.save') : t('groups.rating.end')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-600">{kind === 'set' ? t('groups.rating.setHint') : t('groups.rating.endHint')}</p>
        {kind === 'set' &&
          (bands?.length ? (
            <Field label={t('groups.rating.grade')}>
              <Select value={grade} onChange={(e) => setGrade(e.target.value)}>
                <option value="">{t('common.notSelected')}</option>
                {bands.map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.code}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <Field label={t('groups.rating.grade')} hint={t('rating.proposals.gradeTyped')}>
              <Input value={grade} maxLength={3} onChange={(e) => setGrade(e.target.value.toUpperCase())} />
            </Field>
          ))}
        <Field label={t('rating.proposals.reason')} hint={t('rating.proposals.reasonRequired')}>
          <Textarea value={reason} rows={3} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {error && (
          <div className="text-sm text-neg-500" role="alert">
            {error}
          </div>
        )}
      </div>
    </Modal>
  )
}
