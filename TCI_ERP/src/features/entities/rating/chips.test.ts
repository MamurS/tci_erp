import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'

import type { RatingComponent } from '../../../lib/analytics'
import { buildFactorBullets, buildFactorChips, formatFactorValue, isUnchangedDynamic } from './chips'

// Echoes the key, with the interpolated value where there is one, so the
// assertions read what the chip would say without a locale behind it.
const t = ((key: string, opts?: { value?: string }) =>
  opts?.value !== undefined ? `${opts.value} ${key}` : key) as unknown as TFunction

const c = (factor: string, value: number, score: number, band: string): RatingComponent => ({
  factor,
  value,
  score,
  weight: 1,
  status: 'scored',
  band,
})

describe('factor chips', () => {
  it('reads a dynamic that shows as 0.0% as «unchanged», never as improving or declining', () => {
    expect(isUnchangedDynamic('interest_coverage_dynamic', 0)).toBe(true)
    expect(isUnchangedDynamic('total_assets_dynamic', 0.0004)).toBe(true)
    expect(isUnchangedDynamic('total_assets_dynamic', 0.002)).toBe(false)
    // A level is never "unchanged", whatever its value.
    expect(isUnchangedDynamic('equity_ratio', 0)).toBe(false)

    const chips = buildFactorChips(
      [
        c('interest_coverage_dynamic', 0, 40, 'improving'),
        c('total_assets_dynamic', 0, 70, 'decline'),
      ],
      t,
      'en',
    )
    // Neither a strength nor a weakness: nothing moved.
    expect(chips.strengths).toEqual([])
    expect(chips.weaknesses).toEqual([])
  })

  it('names the unchanged dynamic in the bullets, neutral', () => {
    const [bullet] = buildFactorBullets([c('total_assets_dynamic', 0, 70, 'decline')], t, 'en')
    expect(bullet).toMatchObject({ tone: 'neutral', text: 'rating.factors.total_assets_dynamic: rating.bands.unchanged' })
  })

  it('keeps a real decline as a weakness, with its sign', () => {
    const { weaknesses } = buildFactorChips([c('total_assets_dynamic', -0.35, 80, 'strong_decline')], t, 'en')
    expect(weaknesses).toHaveLength(1)
    expect(weaknesses[0].text).toBe('rating.factors.total_assets_dynamic: rating.bands.strong_decline (−35.0%)')
  })

  it('formats each kind of value the way it is read', () => {
    expect(formatFactorValue('revenue_dynamic', 0.22, t, 'en')).toBe('+22.0%')
    expect(formatFactorValue('equity_ratio', 0.9, t, 'en')).toBe('90.0%')
    expect(formatFactorValue('current_ratio', 4.596, t, 'en')).toBe('4.60x')
    expect(formatFactorValue('cash_conversion_cycle', -9.002, t, 'en')).toBe('-9 rating.units.days')
    expect(formatFactorValue('age_years', 20, t, 'en')).toBe('20 rating.units.years')
    expect(formatFactorValue('revenue_usd', 1198988888.889, t, 'en')).toBe('1,198,988,889 USD')
  })
})
