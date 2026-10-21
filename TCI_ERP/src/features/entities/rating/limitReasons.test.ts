import { describe, expect, it } from 'vitest'

import ENGINE from '../../../../../credit_engine/src/credit_engine/limits.py?raw'
import en from '../../../i18n/locales/en.json'
import ru from '../../../i18n/locales/ru.json'
import uz from '../../../i18n/locales/uz.json'
import { LIMIT_REASON_KEYS, limitReason } from './limitReasons'

describe('limit reasons', () => {
  it('still match the sentences the engine writes', () => {
    // The literal openings of every reason in limits.py.
    for (const opening of [
      'rating not computable',
      'is worse than',
      'rating outside creditable bands',
      'equity is zero or negative',
      'equity is zero, negative or unknown',
      'equity ratio below 1%',
      'net result is a loss or unknown',
      'intangible assets unknown',
      'DSO unavailable - default',
      'calculated limit is below the minimum ticket',
    ])
      expect(ENGINE, opening).toContain(opening)
  })

  it('maps a sentence to a key with its numbers', () => {
    expect(limitReason('rating 81 is worse than 75')).toEqual({
      key: 'ratingTooWeak',
      params: { rating: '81', threshold: '75' },
    })
    expect(limitReason('DSO unavailable - default 45 days used')).toEqual({
      key: 'dsoDefault',
      params: { days: '45' },
    })
    expect(limitReason('calculated limit is below the minimum ticket (5,000 USD equivalent)')).toEqual({
      key: 'belowMinimum',
      params: { amount: '5,000' },
    })
    expect(limitReason('something new')).toEqual({ key: 'other', params: {} })
  })

  it.each([
    ['en', en],
    ['ru', ru],
    ['uz', uz],
  ])('has a sentence for every reason in %s', (_lang, catalog) => {
    const reasons = (catalog as unknown as { rating: { limitReasons: Record<string, string> } }).rating.limitReasons
    for (const key of LIMIT_REASON_KEYS) expect(reasons[key], key).toBeTruthy()
  })
})
