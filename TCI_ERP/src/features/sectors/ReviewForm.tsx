/**
 * «Написать обзор сектора» — a credit analyst's quarterly or ad hoc review:
 * the grade A–D in the grade scale's colours, the outlook, each of the seven
 * factors scored favourable / neutral / adverse with a note, the narrative the
 * grade rests on (required) and the sources, one per line. The scores and
 * notes start from the review in force, the narrative never does. Checked on
 * leaving a field and all at once on sending; the database checks again
 * (submit_sector_review) and its refusal is shown in words.
 */

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Callout, Field, FormSection, Input, Modal, Segmented, Textarea, checkRequired, useTouched } from '../../components/ui'
import { gradeBadgeTone } from '../../components/ui/gradeTone'
import { refusalKey } from '../../lib/refusals'
import { useSubmitSectorReview } from '../risk/api'
import type { SectorReview } from '../risk/api'
import { FACTOR_SCORES, OUTLOOKS, REVIEW_KINDS, SECTOR_FACTORS, SECTOR_GRADES } from '../risk/rules'
import type { FactorScore, Outlook, ReviewKind, SectorGrade } from '../risk/rules'
import { completeFactors, defaultReviewKind, emptyFactors, parseSources } from './model'
import type { FactorDraft } from './model'

type FieldKey = 'grade' | 'outlook' | 'factors' | 'narrative'

export function ReviewFormModal({
  sectorId,
  sectorName,
  current,
  fourEyes,
  onClose,
}: {
  sectorId: string
  sectorName: string
  /** The review in force: its grade, outlook and factors seed the form. */
  current: SectorReview | null
  /** A second analyst approves before it is in force (workflow setting). */
  fourEyes: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const submit = useSubmitSectorReview()
  const { touched, blur, all } = useTouched<FieldKey>()
  const [kind, setKind] = useState<ReviewKind>(() => defaultReviewKind(current?.quarter_start ?? null))
  const [grade, setGrade] = useState<SectorGrade | null>(current?.grade ?? null)
  const [outlook, setOutlook] = useState<Outlook | null>(current?.outlook ?? null)
  const [factors, setFactors] = useState<FactorDraft>(() => emptyFactors(current?.factors))
  const [narrative, setNarrative] = useState('')
  const [sources, setSources] = useState('')
  const [error, setError] = useState<string | null>(null)

  const complete = completeFactors(factors)
  const errors: Record<FieldKey, string | null> = {
    grade: grade ? null : t('risk.sectors.form.gradeRequired'),
    outlook: outlook ? null : t('risk.sectors.form.outlookRequired'),
    factors: complete ? null : t('risk.errors.sectorReviewFactors'),
    narrative: checkRequired(narrative) ? t(`ui.validation.${checkRequired(narrative)}`) : null,
  }
  const shown = (key: FieldKey) => (touched(key) ? errors[key] : null)

  const setFactor = (key: (typeof SECTOR_FACTORS)[number], patch: Partial<FactorDraft[typeof key]>) =>
    setFactors((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }))

  const send = () => {
    all()
    setError(null)
    if (!grade || !outlook || !complete || errors.narrative) return
    submit
      .mutateAsync({
        sectorId,
        grade,
        outlook,
        factors: complete,
        narrative: narrative.trim(),
        sources: parseSources(sources),
        kind,
      })
      .then(onClose)
      .catch((e: unknown) => setError(t(refusalKey(e))))
  }

  return (
    <Modal
      open
      wide
      title={t('risk.sectors.form.title', { sector: sectorName })}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={submit.isPending} onClick={send}>
            {t(fourEyes ? 'risk.sectors.form.submitForApproval' : 'risk.sectors.form.submit')}
          </Button>
        </>
      }
    >
      {error && <Callout tone="neg" title={error} />}
      <p className="text-small text-slate-600">
        {t(fourEyes ? 'risk.sectors.form.hintFourEyes' : 'risk.sectors.form.hint')}
      </p>

      <FormSection title={t('risk.sectors.form.gradeSection')}>
        <GroupField label={t('risk.sectors.fields.kind')}>
          <span>
            <Segmented
              value={kind}
              onChange={(k) => setKind(k as ReviewKind)}
              ariaLabel={t('risk.sectors.fields.kind')}
              options={REVIEW_KINDS.map((k) => ({ key: k, label: t(`risk.sectors.kinds.${k}`) }))}
            />
          </span>
        </GroupField>

        <GroupField
          label={t('risk.sectors.fields.grade')}
          hint={grade ? t(`risk.sectors.gradeMeaning.${grade}`) : t('risk.sectors.form.gradeHint')}
          error={shown('grade')}
        >
          <span className="flex flex-wrap gap-2" onBlur={blur('grade')}>
            {SECTOR_GRADES.map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={grade === g}
                title={t(`risk.sectors.gradeMeaning.${g}`)}
                onClick={() => setGrade(g)}
                // Selection is a ring (box-shadow): the button keeps its box.
                className={`inline-flex h-9 min-w-12 items-center justify-center rounded-full px-4 font-sans text-body font-semibold focus-visible:outline-2 focus-visible:outline-accent-500 ${gradeBadgeTone(g)} ${
                  grade === g ? 'shadow-[0_0_0_2px_var(--color-accent-600)]' : 'ring-1 ring-slate-200 ring-inset'
                }`}
              >
                {g}
              </button>
            ))}
          </span>
        </GroupField>

        <GroupField label={t('risk.sectors.fields.outlook')} error={shown('outlook')}>
          <span onBlur={blur('outlook')}>
            <Segmented
              value={outlook ?? ''}
              onChange={(k) => setOutlook(k as Outlook)}
              ariaLabel={t('risk.sectors.fields.outlook')}
              options={OUTLOOKS.map((o) => ({ key: o, label: t(`risk.sectors.outlooks.${o}`) }))}
            />
          </span>
        </GroupField>
      </FormSection>

      <FormSection title={t('risk.sectors.form.factorsSection')} hint={t('risk.sectors.form.factorsHint')}>
        {shown('factors') && <Callout tone="neg" title={shown('factors') as string} />}
        <div className="grid gap-4" onBlur={blur('factors')}>
          {SECTOR_FACTORS.map((key) => (
            <div key={key} className="grid gap-2 border-b border-slate-100 pb-4 last:border-b-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-small font-medium text-slate-700">{t(`risk.sectors.factors.${key}`)}</span>
                <Segmented
                  value={factors[key].score ?? ''}
                  onChange={(s) => setFactor(key, { score: s as FactorScore })}
                  ariaLabel={t(`risk.sectors.factors.${key}`)}
                  options={FACTOR_SCORES.map((s) => ({ key: s, label: t(`risk.sectors.scores.${s}`) }))}
                />
              </div>
              <Input
                value={factors[key].note}
                onChange={(e) => setFactor(key, { note: e.target.value })}
                placeholder={t('risk.sectors.form.notePlaceholder')}
                aria-label={t('risk.sectors.form.noteFor', { factor: t(`risk.sectors.factors.${key}`) })}
              />
            </div>
          ))}
        </div>
      </FormSection>

      <FormSection title={t('risk.sectors.form.textSection')}>
        <Field label={t('risk.sectors.review.narrative')} hint={t('risk.sectors.form.narrativeHint')} error={shown('narrative')}>
          <Textarea rows={5} value={narrative} onChange={(e) => setNarrative(e.target.value)} onBlur={blur('narrative')} />
        </Field>
        <Field label={t('risk.sectors.review.sources')} hint={t('risk.sectors.form.sourcesHint')}>
          <Textarea rows={3} value={sources} onChange={(e) => setSources(e.target.value)} />
        </Field>
      </FormSection>
    </Modal>
  )
}

/** A label above a group of buttons. Not a <label>: a click on the caption
 * would press the group's first button. */
function GroupField({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: ReactNode
  error?: string | null
  children: ReactNode
}) {
  const id = useId()
  return (
    <div role="group" aria-labelledby={id} className="flex flex-col gap-2" data-invalid={error ? '' : undefined}>
      <span id={id} className="text-small font-medium text-slate-700">
        {label}
      </span>
      {children}
      {error ? (
        <span className="text-caption font-medium text-danger-700" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="text-caption text-slate-500">{hint}</span>
      )}
    </div>
  )
}
