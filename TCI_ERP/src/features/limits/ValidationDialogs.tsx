/**
 * «Отправить на валидацию» (migration 0071): the author no longer picks a
 * colleague. The proposal goes up the authority levels of the stream —
 * straight to the lowest rank that covers it (the ranks in between told), or
 * rank by rank — and the dialog shows where it will go and to whom
 * (tci.validation_route_preview), by the same rules the database then
 * applies. Beyond the author's authority it is REQUIRED; within it a
 * voluntary second opinion from the next rank up, whose comment is
 * mandatory.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Callout, Field, Modal, Skeleton, Textarea } from '../../components/ui'
import { EM_DASH, formatAmount } from '../../lib/format'
import { refusalOr } from '../../lib/optimistic'
import type { AuthorityScope, GradeBand } from '../../lib/roles'
import { submitNeedsComment } from './validation'
import type { PersonRef, ValidationKind } from './validation'
import { levelName } from './levelName'
import { useRoutePreview } from './validationApi'

function names(people: readonly PersonRef[]): string {
  return people.map((p) => p.name?.trim() || EM_DASH).join(', ')
}

export interface SendForValidationProps {
  requestId: string
  stream: AuthorityScope
  band: GradeBand
  amount: number | null
  currency: string
  /** Required = beyond the author's authority; null = cannot tell here. */
  kind: ValidationKind | null
  /** The figures of a `needs_validation` answer, to say by how much. */
  figures?: { amountUzs: number; authorityUzs: number } | null
  /** The decision being sent, as one line. */
  proposal: ReactNode
  pending: boolean
  /** Answers with the level it went to, for the notice. */
  onSubmit: (comment: string | null, destination: string) => Promise<unknown>
  onClose: () => void
}

export function SendForValidationModal({
  requestId,
  stream,
  band,
  amount,
  currency,
  kind,
  figures,
  proposal,
  pending,
  onSubmit,
  onClose,
}: SendForValidationProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const route = useRoutePreview({ requestId, stream, band, amount, currency })

  const preview = route.data
  // The database's own word on required vs voluntary wins once it answers.
  const effectiveKind: ValidationKind | null = preview?.kind ?? kind
  const commentRequired = submitNeedsComment(effectiveKind)
  const commentMissing = commentRequired && comment.trim() === ''
  const bandLabel = t(`limits.bands.${band}`)
  const available = preview?.available === true
  const destination = preview?.available ? levelName(t, stream, preview.rank, preview.is_committee) : ''

  const submit = async () => {
    setError(null)
    try {
      await onSubmit(comment.trim() || null, destination)
    } catch (failure) {
      setError(t(refusalOr(failure, 'limits.validation.submitFailed')))
    }
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={t('limits.validation.send')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={pending} disabled={!available || commentMissing}>
            {t('limits.validation.send')}
          </Button>
        </>
      }
    >
      {effectiveKind === 'required' ? (
        <Callout tone="warn" title={t('limits.validation.kinds.required')}>
          {figures
            ? t('limits.validation.requiredNote', {
                amount: formatAmount(figures.amountUzs, locale),
                band: bandLabel,
                authority: formatAmount(figures.authorityUzs, locale),
              })
            : t('limits.validation.requiredNoteShort', { band: bandLabel })}
        </Callout>
      ) : effectiveKind === 'voluntary' ? (
        <Callout tone="info" title={t('limits.validation.kinds.voluntary')}>
          {t('limits.validation.voluntaryNote')}
        </Callout>
      ) : (
        <Callout tone="info" title={t('limits.validation.kindUnknownTitle')}>
          {t('limits.validation.kindUnknown')}
        </Callout>
      )}

      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-700">
        <span className="text-slate-500">{t('limits.validation.proposal')}: </span>
        {proposal}
      </div>

      <Field label={t('limits.validation.routeTitle')} hint={t(`limits.validation.routing.${preview?.routing ?? 'direct'}`)}>
        {route.isLoading ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-12 w-full" />
          </div>
        ) : route.isError ? (
          <p className="text-[13px] text-neg-500" role="alert">
            {t('limits.validation.routeFailed')}
          </p>
        ) : preview && !preview.available ? (
          <Callout tone="warn" title={t('limits.validation.noLevelTitle')}>
            {t('limits.validation.noLevel')}
          </Callout>
        ) : preview && preview.available ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-accent-600 bg-accent-50 px-3 py-2 text-sm">
            <span className="font-medium text-slate-800">{destination}</span>
            <span className="text-xs text-slate-600">
              {t(preview.is_committee ? 'limits.validation.routeVoters' : 'limits.validation.routeMembers', {
                names: names(preview.members),
              })}
            </span>
            {preview.fyi.length > 0 && (
              <span className="text-xs text-slate-500">
                {t('limits.validation.routeFyi', { names: names(preview.fyi) })}
              </span>
            )}
          </div>
        ) : null}
      </Field>

      <Field
        label={t('limits.validation.commentLabel')}
        hint={commentRequired ? t('limits.validation.commentRequiredHint') : t('limits.validation.commentOptionalHint')}
      >
        <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>

      {error && (
        <p className="text-[13px] text-neg-500" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
