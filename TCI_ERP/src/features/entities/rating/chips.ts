/**
 * Strengths / weaknesses chips from the 13-factor breakdown (sample-report
 * style): green tint for strong factors, red for weak, sorted by severity.
 * Chip building logic (pure); the FactorChipList component renders them.
 */

import type { TFunction } from 'i18next'

import { formatAmount, formatDays, formatPercent, formatRatio } from '../../../lib/format'
import type { RatingComponent } from '../../../lib/analytics'

const STRENGTH_MAX = 40
const WEAKNESS_MIN = 60

type FactorFormat = 'percent' | 'ratio' | 'days' | 'years' | 'usd'

const FACTOR_FORMATS: Record<string, FactorFormat> = {
  net_profitability: 'percent',
  equity_ratio: 'percent',
  debt_to_assets: 'percent',
  total_assets_dynamic: 'percent',
  current_ratio: 'ratio',
  interest_coverage: 'ratio',
  interest_coverage_dynamic: 'percent',
  debt_to_equity: 'ratio',
  cash_conversion_cycle: 'days',
  revenue_usd: 'usd',
  age_years: 'years',
  debt_to_ebit: 'ratio',
  revenue_dynamic: 'percent',
}

function formatFactorValue(factor: string, value: number, locale: string): string {
  switch (FACTOR_FORMATS[factor]) {
    case 'percent':
      return formatPercent(value, locale)
    case 'days':
      return `${formatDays(value, locale)}`
    case 'years':
      return formatAmount(value, locale, 1)
    case 'usd':
      return `${formatAmount(value, locale, 0)} USD`
    default:
      return `${formatRatio(value, locale)}x`
  }
}

export interface FactorChip {
  factor: string
  text: string
  kind: 'strength' | 'weakness'
}

/** Build sorted chips: strongest first among strengths, weakest first
 * among weaknesses. Mid-band factors are omitted. */
export function buildFactorChips(
  components: RatingComponent[],
  t: TFunction,
  locale: string,
): { strengths: FactorChip[]; weaknesses: FactorChip[] } {
  const scored = components.filter(
    (c): c is RatingComponent & { score: number; value: number } =>
      c.status === 'scored' && c.score !== null && c.value !== null,
  )

  const chip = (c: RatingComponent & { score: number; value: number }, kind: FactorChip['kind']): FactorChip => ({
    factor: c.factor,
    kind,
    text: `${t(`rating.factors.${c.factor}`)}: ${
      c.band ? t(`rating.bands.${c.band}`, { defaultValue: c.band }) : ''
    } (${formatFactorValue(c.factor, c.value, locale)})`,
  })

  const strengths = scored
    .filter((c) => c.score <= STRENGTH_MAX)
    .sort((a, b) => a.score - b.score)
    .map((c) => chip(c, 'strength'))
  const weaknesses = scored
    .filter((c) => c.score >= WEAKNESS_MIN)
    .sort((a, b) => b.score - a.score)
    .map((c) => chip(c, 'weakness'))

  return { strengths, weaknesses }
}

