/**
 * Admin › Полномочия › «Веса субрейтингов» (migration 0079): the default
 * weights of the rating scorecard's four pillars — whole per cents adding up
 * to 100. The rater starts from them and may change them per rating.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { Button, Callout, Card, Input, SectionTitle } from '../../components/ui'
import { refusalOr } from '../../lib/optimistic'
import { tci } from '../../lib/supabase'
import { SCORECARD_SETTINGS_KEY, useScorecardSettings } from '../entities/rating/proposalsApi'
import { PILLARS } from '../entities/rating/scorecard'
import type { Weights } from '../entities/rating/scorecard'

export function RatingWeightsCard() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const settings = useScorecardSettings()
  const [draft, setDraft] = useState<Weights | null>(null)
  const [error, setError] = useState<string | null>(null)
  const weights = draft ?? settings.data ?? null
  const sum = weights ? PILLARS.reduce((s, p) => s + weights[p], 0) : 0

  const save = useMutation({
    mutationFn: async (next: Weights) => {
      const { data, error: failure } = await tci().rpc('set_rating_pillar_weights', { p_weights: next })
      if (failure) throw failure
      return (data as { weights: Weights }).weights
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(SCORECARD_SETTINGS_KEY, saved)
      setDraft(null)
    },
    onError: (failure) => setError(t(refusalOr(failure, 'common.saveFailed'))),
  })

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle hint={t('admin.ratingWeights.hint')}>{t('admin.ratingWeights.title')}</SectionTitle>
      {weights && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PILLARS.map((pillar) => (
            <label key={pillar} className="flex flex-col gap-1">
              <span className="text-small font-medium text-slate-700">
                {t(`rating.scorecard.pillars.${pillar}.name`)}
              </span>
              <span className="relative">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  step={1}
                  value={String(weights[pillar])}
                  className="w-full pr-7 text-right tabular-nums"
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10)
                    setError(null)
                    setDraft({ ...weights, [pillar]: Number.isFinite(n) ? Math.min(Math.max(n, 0), 100) : 0 })
                  }}
                />
                <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-small text-slate-500">
                  %
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-small text-slate-600">{t('rating.scorecard.weightSum', { sum })}</span>
        <Button
          disabled={draft === null || sum !== 100}
          loading={save.isPending}
          onClick={() => draft && save.mutate(draft)}
        >
          {t('common.save')}
        </Button>
      </div>
      {error && <Callout tone="neg" title={error} />}
    </Card>
  )
}
