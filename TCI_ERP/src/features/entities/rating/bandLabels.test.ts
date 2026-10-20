/**
 * Every factor band the rating engine can emit has a label in all three
 * locales. The bands are the third element of each (bound, score, band) row
 * in credit_engine's scoring tables; RatingTab and the risk report render
 * them through `rating.bands.*`, falling back to the raw key — so a missing
 * label would show «very_low» to the reader instead of failing loudly.
 */

import { describe, expect, it } from 'vitest'

import TABLES from '../../../../../credit_engine/src/credit_engine/scoring/tables.py?raw'
import en from '../../../i18n/locales/en.json'
import ru from '../../../i18n/locales/ru.json'
import uz from '../../../i18n/locales/uz.json'

const ROW = /\(\s*[-\w.]+\s*,\s*[\d.]+\s*,\s*"([a-z_]+)"\s*\)/g

const engineBands = [...new Set([...TABLES.matchAll(ROW)].map((m) => m[1]))].sort()

describe('rating band labels', () => {
  it('reads the bands from the engine tables', () => {
    // a sanity floor, so a changed row format cannot make the check vacuous
    expect(engineBands.length).toBeGreaterThan(40)
    expect(engineBands).toContain('very_low')
    expect(engineBands).toContain('deep_loss')
  })

  it.each([
    ['en', en],
    ['ru', ru],
    ['uz', uz],
  ] as const)('%s labels every band the engine emits', (_lang, locale) => {
    const labels = locale.rating.bands as Record<string, string>
    expect(engineBands.filter((band) => !labels[band]?.trim())).toEqual([])
  })
})
