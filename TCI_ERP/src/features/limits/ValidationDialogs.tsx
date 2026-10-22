/**
 * «Отправить на валидацию»: the author picks a colleague of the SAME
 * department whose authority covers the decision in the buyer's rating band
 * (tci.validation_candidates — the manager first and preselected), and says
 * why. Beyond the author's authority it is REQUIRED; within it, a voluntary
 * second opinion whose comment is mandatory. The database decides which it
 * is and refuses anything else by name; this dialog only says it up front.
 *
 * ValidatorPicker is shared with the validator's «Переслать» (forward), where
 * the people already in the chain are left out by the same function.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge, Button, Callout, Field, Modal, Skeleton, Textarea } from '../../components/ui'
import { EM_DASH, formatAmount } from '../../lib/format'
import { refusalOr } from '../../lib/optimistic'
import type { AuthorityScope, GradeBand } from '../../lib/roles'
import { candidateAuthority, defaultCandidate, submitNeedsComment } from './validation'
import type { ValidationCandidate, ValidationKind } from './validation'
import { useValidationCandidates } from './validationApi'

interface PickerProps {
  stream: AuthorityScope
  band: GradeBand
  amount: number | null
  currency: string
  chainId?: string | null
  value: string | null
  onChange: (userId: string | null, candidate: ValidationCandidate | null) => void
}

/** Who may validate: name, authority in the band, the manager marked. */
export function ValidatorPicker({ stream, band, amount, currency, chainId, value, onChange }: PickerProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language
  const { data, isLoading, isError } = useValidationCandidates({ stream, band, amount, currency, chainId })
  const candidates = data ?? []

  // The manager is preselected once the list arrives (and only then: a
  // choice the author made is never overwritten).
  useEffect(() => {
    if (value === null && data && data.length > 0) {
      const id = defaultCandidate(data)
      if (id) onChange(id, data.find((c) => c.user_id === id) ?? null)
    }
  }, [data, value, onChange])

  const bandLabel = t(`limits.bands.${band}`)

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }
  if (isError) {
    return <p className="text-[13px] text-neg-500" role="alert">{t('limits.validation.candidatesFailed')}</p>
  }
  if (candidates.length === 0) {
    return (
      <Callout tone="warn" title={t('limits.validation.noCandidatesTitle')}>
        {amount === null
          ? t(`limits.validation.noCandidatesDecline.${stream}`)
          : t(`limits.validation.noCandidates.${stream}`, {
              amount: `${formatAmount(amount, locale)} ${currency}`,
              band: bandLabel,
            })}
      </Callout>
    )
  }

  return (
    <div role="radiogroup" aria-label={t('limits.validation.validator')} className="flex flex-col gap-1.5">
      {candidates.map((c) => {
        const authority = candidateAuthority(c.authority_uzs)
        const checked = c.user_id === value
        return (
          <label
            key={c.user_id}
            className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors ${
              checked ? 'border-accent-600 bg-accent-50' : 'border-slate-200 hover:bg-slate-50'
            }`}
          >
            <input
              type="radio"
              name="validator"
              className="mt-1"
              checked={checked}
              onChange={() => onChange(c.user_id, c)}
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
                <span className="min-w-0 truncate">{c.full_name?.trim() || c.email}</span>
                {c.is_manager && <Badge tone="accent">{t('limits.validation.manager')}</Badge>}
              </span>
              <span className="block text-xs text-slate-500 tabular-nums">
                {t('limits.validation.authorityIn', {
                  band: bandLabel,
                  amount:
                    authority === null
                      ? EM_DASH
                      : authority === Number.POSITIVE_INFINITY
                        ? t('limits.validation.unlimited')
                        : `${formatAmount(authority, locale)} UZS`,
                })}
              </span>
            </span>
          </label>
        )
      })}
    </div>
  )
}

export interface SendForValidationProps {
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
  onSubmit: (validatorId: string, comment: string | null, validatorName: string) => Promise<unknown>
  onClose: () => void
}

export function SendForValidationModal({
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
  const [validator, setValidator] = useState<ValidationCandidate | null>(null)
  const [validatorId, setValidatorId] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)

  const commentRequired = submitNeedsComment(kind)
  const commentMissing = commentRequired && comment.trim() === ''
  const bandLabel = t(`limits.bands.${band}`)

  const submit = async () => {
    if (!validatorId) return
    setError(null)
    try {
      await onSubmit(validatorId, comment.trim() || null, validator?.full_name?.trim() || validator?.email || '')
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
          <Button onClick={() => void submit()} loading={pending} disabled={!validatorId || commentMissing}>
            {t('limits.validation.send')}
          </Button>
        </>
      }
    >
      {kind === 'required' ? (
        <Callout tone="warn" title={t('limits.validation.kinds.required')}>
          {figures
            ? t('limits.validation.requiredNote', {
                amount: formatAmount(figures.amountUzs, locale),
                band: bandLabel,
                authority: formatAmount(figures.authorityUzs, locale),
              })
            : t('limits.validation.requiredNoteShort', { band: bandLabel })}
        </Callout>
      ) : kind === 'voluntary' ? (
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

      <Field label={t('limits.validation.validator')} hint={t(`limits.validation.validatorHint.${stream}`, { band: bandLabel })}>
        <ValidatorPicker
          stream={stream}
          band={band}
          amount={amount}
          currency={currency}
          value={validatorId}
          onChange={(id, candidate) => {
            setValidatorId(id)
            setValidator(candidate)
          }}
        />
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
