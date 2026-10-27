/**
 * The rating scorecard on screen (migration 0079): the form that builds a
 * grade from its four pillars — grade, weight, standard reason, optional
 * comment — with the weighted grade computed as it is filled in, and the
 * read-only view of a scorecard already sent (a pending proposal, the
 * history, the grade in force). The rules live in `scorecard.ts`; the
 * database checks them again.
 */

import { useTranslation } from 'react-i18next'

import { Button, Field, GradeBadge, Input, Select } from '../../../components/ui'
import { EM_DASH, formatRatio } from '../../../lib/format'
import { gradeCodes, isGradeCode } from '../../../lib/gradeCatalogue'
import type { GradeBand } from '../../../lib/gradeScale'
import { GradePicker } from './GradePicker'
import { overallReasonsFor, PILLAR_REASONS, PILLARS, rebalance, weightedGrade, weightSum } from './scorecard'
import type { Pillar, PillarInput, PillarPolarity, StoredScorecard, Weights } from './scorecard'

const POLARITY_GROUPS: Exclude<PillarPolarity, 'na'>[] = ['pos', 'neg', 'neutral']

export function ScorecardEditor({
  pillars,
  onPillars,
  defaults,
  suggestions,
  bands,
  final,
  onFinal,
  overallReason,
  onOverallReason,
  locale,
}: {
  pillars: PillarInput[]
  onPillars: (next: PillarInput[]) => void
  defaults: Weights
  /** The engine's view of each pillar, marked in the grade list. */
  suggestions: Partial<Record<Pillar, string>>
  bands: GradeBand[] | undefined
  final: string
  /** `touched` is false when the form follows the weighted grade by itself. */
  onFinal: (grade: string, touched: boolean) => void
  overallReason: string
  onOverallReason: (code: string) => void
  locale: string
}) {
  const { t } = useTranslation()
  const weighted = weightedGrade(pillars)
  const sum = weightSum(pillars)
  const codes = gradeCodes(bands)
  const named = (code: string) => (isGradeCode(code) ? `${code} — ${t(`rating.grades.${code}.name`)}` : code)

  const set = (pillar: Pillar, patch: Partial<PillarInput>) => {
    let next = pillars.map((p) => (p.pillar === pillar ? { ...p, ...patch } : p))
    // Grading a pillar or leaving it out spreads the default weights again
    // over what is graded.
    if ('grade' in patch && (patch.grade === null) !== (pillars.find((p) => p.pillar === pillar)?.grade === null)) {
      const graded = next.filter((p) => p.grade !== null).map((p) => p.pillar)
      const w = rebalance(defaults, graded)
      next = next.map((p) => ({ ...p, weight: w[p.pillar], reason: p.grade === null ? null : p.reason }))
    }
    onPillars(next)
  }

  const reasons = weighted && final ? overallReasonsFor(final, weighted.grade) : []

  return (
    <div className="flex flex-col gap-4" data-testid="rating-scorecard">
      <div className="flex flex-col gap-3">
        {PILLARS.map((pillar) => {
          const row = pillars.find((p) => p.pillar === pillar) as PillarInput
          const graded = row.grade !== null
          return (
            <div key={pillar} className="rounded-md border border-slate-200 px-3 py-3">
              <div className="mb-2">
                <span className="block text-body font-semibold text-slate-800">{t(`rating.scorecard.pillars.${pillar}.name`)}</span>
                <span className="block text-caption text-slate-500">{t(`rating.scorecard.pillars.${pillar}.hint`)}</span>
              </div>
              <div className="grid gap-2 md:grid-cols-[minmax(0,11rem)_6rem_minmax(0,1fr)]">
                <label className="flex flex-col gap-1">
                  <span className="text-caption font-medium text-slate-500">{t('rating.scorecard.grade')}</span>
                  <Select
                    value={row.grade ?? ''}
                    aria-label={`${t(`rating.scorecard.pillars.${pillar}.name`)} — ${t('rating.scorecard.grade')}`}
                    onChange={(e) => set(pillar, { grade: e.target.value || null })}
                  >
                    <option value="">{t('rating.scorecard.notAssessed')}</option>
                    {codes.map((code) => (
                      <option key={code} value={code}>
                        {suggestions[pillar] === code
                          ? t('rating.scorecard.engineOption', { grade: named(code) })
                          : named(code)}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-caption font-medium text-slate-500">{t('rating.scorecard.weight')}</span>
                  <span className="relative">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      step={1}
                      disabled={!graded}
                      value={graded ? String(row.weight) : '0'}
                      aria-label={`${t(`rating.scorecard.pillars.${pillar}.name`)} — ${t('rating.scorecard.weight')}`}
                      className="w-full pr-7 text-right tabular-nums"
                      onChange={(e) => {
                        const n = Number.parseInt(e.target.value, 10)
                        set(pillar, { weight: Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : 0 })
                      }}
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-small text-slate-500">
                      %
                    </span>
                  </span>
                </label>
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-caption font-medium text-slate-500">{t('rating.scorecard.reason')}</span>
                  <Select
                    value={graded ? (row.reason ?? '') : ''}
                    disabled={!graded}
                    aria-label={`${t(`rating.scorecard.pillars.${pillar}.name`)} — ${t('rating.scorecard.reason')}`}
                    onChange={(e) => set(pillar, { reason: e.target.value || null })}
                  >
                    <option value="">{graded ? t('rating.scorecard.pickReason') : t('rating.scorecard.reasons.not_assessed')}</option>
                    {POLARITY_GROUPS.map((polarity) => (
                      <optgroup key={polarity} label={t(`rating.scorecard.polarity.${polarity}`)}>
                        {PILLAR_REASONS[pillar]
                          .filter((r) => r.polarity === polarity)
                          .map((r) => (
                            <option key={r.code} value={r.code}>
                              {t(`rating.scorecard.reasons.${pillar}.${r.code}`)}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </Select>
                </label>
              </div>
              <Input
                className="mt-2 w-full"
                value={row.comment}
                maxLength={500}
                disabled={!graded}
                placeholder={t('rating.scorecard.commentPlaceholder')}
                aria-label={`${t(`rating.scorecard.pillars.${pillar}.name`)} — ${t('rating.scorecard.comment')}`}
                onChange={(e) => set(pillar, { comment: e.target.value })}
              />
            </div>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-md bg-slate-50 px-3 py-2 text-small">
        <span className={sum === 100 ? 'text-slate-600' : 'font-medium text-slate-800'}>
          <span
            aria-hidden
            className={`mr-2 inline-block size-2 rounded-full align-middle ${sum === 100 ? 'bg-pos-500' : 'bg-warn-500'}`}
          />
          {t('rating.scorecard.weightSum', { sum })}
          {sum !== 100 && pillars.some((p) => p.grade !== null) && (
            <Button
              variant="ghost"
              className="ml-2"
              onClick={() => {
                const w = rebalance(
                  defaults,
                  pillars.filter((p) => p.grade !== null).map((p) => p.pillar),
                )
                onPillars(pillars.map((p) => ({ ...p, weight: w[p.pillar] })))
              }}
            >
              {t('rating.scorecard.rebalance')}
            </Button>
          )}
        </span>
        <span className="flex items-center gap-2 text-slate-600">
          {t('rating.scorecard.weighted')}
          {weighted ? (
            <>
              <GradeBadge grade={weighted.grade} />
              <span className="text-slate-500 tabular-nums">({formatRatio(weighted.value, locale)})</span>
            </>
          ) : (
            <span className="text-slate-500">{EM_DASH}</span>
          )}
        </span>
      </div>

      <GradePicker
        value={final}
        onChange={(g) => onFinal(g, true)}
        bands={bands}
        label={t('rating.scorecard.finalGrade')}
        hint={t('rating.scorecard.finalGradeHint')}
        recommended={weighted?.grade ?? null}
      />
      <Field
        label={t('rating.scorecard.overallReason')}
        hint={
          weighted && final && final !== weighted.grade
            ? t('rating.scorecard.adjusted', { weighted: weighted.grade, grade: final })
            : t('rating.scorecard.overallHint')
        }
      >
        <Select value={overallReason} disabled={!weighted || !final} onChange={(e) => onOverallReason(e.target.value)}>
          <option value="">{t('rating.scorecard.pickReason')}</option>
          {reasons.map((r) => (
            <option key={r.code} value={r.code}>
              {t(`rating.scorecard.overall.${r.code}`)}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  )
}

/** A scorecard already sent, read-only. */
export function ScorecardView({ card, locale }: { card: StoredScorecard; locale: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-2 text-small" data-testid="rating-scorecard-view">
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[34%]" />
          <col className="w-[4.5rem]" />
          <col className="w-[4.5rem]" />
          <col />
        </colgroup>
        <thead>
          <tr className="text-left text-caption text-slate-500">
            <th className="py-1 pr-2 font-medium">{t('rating.scorecard.pillar')}</th>
            <th className="py-1 pr-2 font-medium">{t('rating.scorecard.grade')}</th>
            <th className="py-1 pr-2 text-right font-medium">{t('rating.scorecard.weight')}</th>
            <th className="py-1 pl-2 font-medium">{t('rating.scorecard.reason')}</th>
          </tr>
        </thead>
        <tbody>
          {card.pillars.map((p) => (
            <tr key={p.pillar} className="border-t border-slate-100 align-top">
              <td className="py-2 pr-2 text-slate-700">{t(`rating.scorecard.pillars.${p.pillar}.name`)}</td>
              <td className="py-2 pr-2">
                {p.grade ? <GradeBadge grade={p.grade} /> : <span className="text-slate-500">{EM_DASH}</span>}
              </td>
              <td className="py-2 pr-2 text-right text-slate-600 tabular-nums">{p.grade ? `${p.weight} %` : EM_DASH}</td>
              <td className="py-2 pl-2 text-slate-700">
                {p.grade ? t(`rating.scorecard.reasons.${p.pillar}.${p.reason}`) : t('rating.scorecard.reasons.not_assessed')}
                {p.comment && <span className="block text-slate-500">«{p.comment}»</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-slate-200 pt-2 text-slate-600">
        <span className="flex items-center gap-2">
          {t('rating.scorecard.weighted')}
          <GradeBadge grade={card.weighted_grade} />
          <span className="text-slate-500 tabular-nums">({formatRatio(card.weighted_value, locale)})</span>
        </span>
        <span className="flex items-center gap-2">
          {t('rating.scorecard.finalGrade')}
          <GradeBadge grade={card.grade} />
          <span className="text-slate-700">{t(`rating.scorecard.overall.${card.reason}`)}</span>
        </span>
      </div>
    </div>
  )
}
