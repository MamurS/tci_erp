/**
 * Admin › «Уровни страхователей» (migration 0094): the thresholds in UZS at
 * which a policyholder's insured turnover or premium reaches silver, gold and
 * platinum — rising from silver to platinum. A technical setting: admin sets
 * the scale, commercial underwriting sets a tier by hand on the card.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AmountInput, Button, Callout, Card, SectionTitle, useFlash } from '../../components/ui'
import { parseAmount } from '../../components/ui/amount'
import { refusalOr } from '../../lib/optimistic'
import { useSetTierThresholds, useTierThresholds } from './api'
import { THRESHOLD_TIERS, TIER_MEASURES, thresholdsValid } from './model'
import type { TierThresholds } from './model'
import { TierBadge } from './TierBadge'

type Draft = Record<string, string>

const key = (tier: string, measure: string) => `${tier}.${measure}`

function toDraft(th: TierThresholds): Draft {
  const out: Draft = {}
  for (const tier of THRESHOLD_TIERS) for (const m of TIER_MEASURES) out[key(tier, m)] = String(th[tier][m])
  return out
}

function fromDraft(d: Draft): TierThresholds | null {
  const out = {} as TierThresholds
  for (const tier of THRESHOLD_TIERS) {
    const turnover = parseAmount(d[key(tier, 'turnover_uzs')] ?? '')
    const premium = parseAmount(d[key(tier, 'premium_uzs')] ?? '')
    if (turnover === null || premium === null) return null
    out[tier] = { turnover_uzs: turnover, premium_uzs: premium }
  }
  return out
}

export function TierThresholdsCard() {
  const { t } = useTranslation()
  const settings = useTierThresholds()
  const save = useSetTierThresholds()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, flashSaved] = useFlash()
  const shown = draft ?? (settings.data ? toDraft(settings.data) : null)
  const parsed = draft ? fromDraft(draft) : null
  const valid = parsed !== null && thresholdsValid(parsed)

  return (
    <Card className="flex flex-col gap-4 p-5">
      <SectionTitle hint={t('tiers.thresholds.hint')}>{t('tiers.thresholds.title')}</SectionTitle>
      {shown && (
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
          <span />
          {TIER_MEASURES.map((m) => (
            <span key={m} className="hidden text-small font-medium text-slate-600 sm:block">
              {t(`tiers.measure.${m}`)}
            </span>
          ))}
          {THRESHOLD_TIERS.map((tier) => (
            <div key={tier} className="contents">
              <span className="self-center">
                <TierBadge tier={tier} size="sm" />
              </span>
              {TIER_MEASURES.map((m) => (
                <label key={m} className="flex flex-col gap-1">
                  <span className="text-small text-slate-600 sm:sr-only">{t(`tiers.measure.${m}`)}</span>
                  <AmountInput
                    value={shown[key(tier, m)] ?? ''}
                    decimals={0}
                    suffix="UZS"
                    aria-label={`${t(`tiers.name.${tier}`)} · ${t(`tiers.measure.${m}`)}`}
                    onChange={(plain) => {
                      setError(null)
                      setDraft({ ...shown, [key(tier, m)]: plain })
                    }}
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-small text-slate-600">
          {draft && !valid ? t('tiers.thresholds.rising') : t('tiers.thresholds.rule')}
        </span>
        <Button
          disabled={!draft || !valid}
          loading={save.isPending}
          done={saved}
          onClick={() =>
            parsed &&
            save.mutate(parsed, {
              onSuccess: () => {
                setDraft(null)
                flashSaved()
              },
              onError: (failure) => setError(t(refusalOr(failure, 'common.saveFailed'))),
            })
          }
        >
          {t('tiers.thresholds.save')}
        </Button>
      </div>
      {error && <Callout tone="neg" title={error} />}
    </Card>
  )
}
