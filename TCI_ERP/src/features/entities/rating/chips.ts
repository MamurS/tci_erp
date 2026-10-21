/**
 * Strengths / weaknesses chips from the 13-factor breakdown (sample-report
 * style): green tint for strong factors, red for weak, sorted by severity.
 * Chip building logic (pure); the FactorChipList component renders them.
 */

import type { TFunction } from 'i18next'

import { formatAmount, formatDays, formatPercent, formatRatio, formatSignedPercent, isZeroChange } from '../../../lib/format'
import type { RatingComponent } from '../../../lib/analytics'

const STRENGTH_MAX = 40
const WEAKNESS_MIN = 60

type FactorFormat = 'percent' | 'change' | 'ratio' | 'days' | 'years' | 'usd'

const FACTOR_FORMATS: Record<string, FactorFormat> = {
  net_profitability: 'percent',
  equity_ratio: 'percent',
  debt_to_assets: 'percent',
  total_assets_dynamic: 'change',
  current_ratio: 'ratio',
  interest_coverage: 'ratio',
  interest_coverage_dynamic: 'change',
  debt_to_equity: 'ratio',
  cash_conversion_cycle: 'days',
  revenue_usd: 'usd',
  age_years: 'years',
  debt_to_ebit: 'ratio',
  revenue_dynamic: 'change',
}

/** A factor's value as a person reads it: 37.4%, +22.0%, 4.60x, −9 days,
 * 20 years, 1,198,988,889 USD — the chips, the bullets and the component
 * table all print it this way. */
export function formatFactorValue(factor: string, value: number, t: TFunction, locale: string): string {
  switch (FACTOR_FORMATS[factor]) {
    case 'percent':
      return formatPercent(value, locale)
    case 'change':
      // A dynamic is a change: it carries its sign (+22.0%, −5.0%).
      return formatSignedPercent(value, locale, 1)
    case 'days':
      return `${formatDays(value, locale)} ${t('rating.units.days')}`
    case 'years':
      return t('rating.units.years', { count: Math.floor(value), value: formatAmount(Math.floor(value), locale, 0) })
    case 'usd':
      return `${formatAmount(value, locale, 0)} USD`
    default:
      return `${formatRatio(value, locale)}x`
  }
}

/**
 * A dynamic that SHOWS as 0.0% did not move. The engine still puts it in a
 * band (0 falls in «decline» for assets, in «improving» for interest cover),
 * which read as «improving (0.0%)» or as a weakness nobody could explain.
 * It is reported as «unchanged» and is neither a strength nor a weakness.
 */
export function isUnchangedDynamic(factor: string, value: number): boolean {
  return FACTOR_FORMATS[factor] === 'change' && isZeroChange(value)
}

function factorText(c: RatingComponent & { value: number }, t: TFunction, locale: string): string {
  const name = t(`rating.factors.${c.factor}`)
  if (isUnchangedDynamic(c.factor, c.value)) return `${name}: ${t('rating.bands.unchanged')}`
  // "Factor: band (value)" rather than "band Factor": an adjective in front
  // of the factor would need gender agreement in ru and uz.
  const band = c.band ? t(`rating.bands.${c.band}`, { defaultValue: c.band }) : ''
  return `${name}: ${band} (${formatFactorValue(c.factor, c.value, t, locale)})`
}

type Scored = RatingComponent & { score: number; value: number }

function scoredOnly(components: RatingComponent[]): Scored[] {
  return components.filter(
    (c): c is Scored => c.status === 'scored' && c.score !== null && c.value !== null,
  )
}

function toneOf(c: Scored): 'strength' | 'neutral' | 'weakness' {
  if (isUnchangedDynamic(c.factor, c.value)) return 'neutral'
  return c.score <= STRENGTH_MAX ? 'strength' : c.score >= WEAKNESS_MIN ? 'weakness' : 'neutral'
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
  const scored = scoredOnly(components)
  const chip = (c: Scored, kind: FactorChip['kind']): FactorChip => ({
    factor: c.factor,
    kind,
    text: factorText(c, t, locale),
  })

  const strengths = scored
    .filter((c) => toneOf(c) === 'strength')
    .sort((a, b) => a.score - b.score)
    .map((c) => chip(c, 'strength'))
  const weaknesses = scored
    .filter((c) => toneOf(c) === 'weakness')
    .sort((a, b) => b.score - a.score)
    .map((c) => chip(c, 'weakness'))

  return { strengths, weaknesses }
}

export interface FactorBullet {
  factor: string
  text: string
  /** strength ≤ 40, weakness ≥ 60, otherwise neutral (the reference
   * report's green / amber / red squares). */
  tone: 'strength' | 'neutral' | 'weakness'
  score: number
}

/** Every scored factor, best first — the bullet list beside the gauge. */
export function buildFactorBullets(
  components: RatingComponent[],
  t: TFunction,
  locale: string,
): FactorBullet[] {
  return scoredOnly(components)
    .sort((a, b) => a.score - b.score)
    .map((c) => ({
      factor: c.factor,
      score: c.score,
      tone: toneOf(c),
      text: factorText(c, t, locale),
    }))
}
