/**
 * Choosing a grade by hand: a list of the scale's grades, each named with
 * its credit quality and risk («B1 — Хороший · низкий кредитный риск»), and
 * under it the description of the grade chosen — so whoever proposes,
 * confirms or caps a rating sees what the grade says about the buyer.
 *
 * The grades are the served scale when the analytics service answers, else
 * the contract-tested mirror (`gradeCatalogue.ts`); a grade with no wording
 * (a future grade the service serves first) is listed by its code alone.
 */
import { useTranslation } from 'react-i18next'

import { Field, Select } from '../../../components/ui'
import { gradeCodes, isGradeCode } from '../../../lib/gradeCatalogue'
import type { GradeBand } from '../../../lib/gradeScale'

interface GradePickerProps {
  value: string
  onChange: (grade: string) => void
  label: string
  hint?: string
  bands: GradeBand[] | undefined
  /** The engine's grade, marked «recommended» in the list. */
  recommended?: string | null
  /** Offer «not selected» first (a grade must then be chosen). */
  allowEmpty?: boolean
  /** Only these grades may be chosen (e.g. not better than a group cap). */
  allowed?: (code: string) => boolean
}

export function GradePicker({
  value,
  onChange,
  label,
  hint,
  bands,
  recommended,
  allowEmpty = true,
  allowed,
}: GradePickerProps) {
  const { t } = useTranslation()
  const named = (code: string) =>
    isGradeCode(code)
      ? `${code} — ${t(`rating.grades.${code}.name`)} · ${t(`rating.grades.${code}.risk`)}`
      : code
  const option = (code: string) =>
    code === recommended
      ? t('rating.confirmation.engineOption', { grade: named(code) })
      : named(code)

  return (
    <div className="flex flex-col gap-2">
      <Field label={label} hint={hint}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          {allowEmpty && <option value="">{t('common.notSelected')}</option>}
          {gradeCodes(bands).map((code) => (
            <option key={code} value={code} disabled={allowed ? !allowed(code) : false}>
              {option(code)}
            </option>
          ))}
        </Select>
      </Field>
      {/* The space is kept whether or not a grade is chosen, so choosing one
          moves nothing below it. */}
      <div className="min-h-[4.5rem] rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-small leading-snug">
        {isGradeCode(value) ? (
          <>
            <div className="font-semibold text-slate-800">
              {value} — {t(`rating.grades.${value}.name`)}
              <span className="font-normal text-slate-500">
                {' '}
                · {t(`rating.grades.${value}.risk`)}
              </span>
            </div>
            <p className="mt-0.5 text-slate-600">{t(`rating.grades.${value}.description`)}</p>
          </>
        ) : (
          <p className="text-slate-500">{t('rating.grades.pick')}</p>
        )}
      </div>
    </div>
  )
}
