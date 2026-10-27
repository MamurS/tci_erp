import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../../supabase/migrations/0088_external_ratings.sql?raw'
import {
  AGENCIES,
  AGENCY_RATING_PATTERN,
  agencyName,
  gradeClass,
  isValidAgencyRating,
  mayEnterAgencyRatings,
  OUTLOOKS,
  outlookTone,
  referenceUrl,
  SCALES,
  TERMS,
} from './agencyRatings'

const list = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(', ')

describe('agency ratings mirror 0088', () => {
  it('accepts the same agencies, scales, terms, outlooks and rating text', () => {
    expect(MIGRATION).toContain(`check (agency in (${list(AGENCIES)}))`)
    expect(MIGRATION).toContain(`check (scale in (${list(SCALES)}))`)
    expect(MIGRATION).toContain(`check (term in (${list(TERMS)}))`)
    expect(MIGRATION.replace(/\s+/g, ' ')).toContain(`check (outlook in (${list(OUTLOOKS)}))`)
    expect(MIGRATION).toContain(`check (rating ~ '${AGENCY_RATING_PATTERN.source}')`)
  })

  it('lets the information desk and credit analysts enter, as the function does', () => {
    expect(MIGRATION).toContain("perform tci.require_role('information_manager', 'credit_analyst');")
    expect(mayEnterAgencyRatings('information_manager')).toBe(true)
    expect(mayEnterAgencyRatings('credit_analyst')).toBe(true)
    for (const r of ['admin', 'credit_underwriter', 'sales', 'commercial_underwriter', 'claims', 'client'] as const) {
      expect(mayEnterAgencyRatings(r)).toBe(false)
    }
  })
})

describe('reading a rating', () => {
  it('accepts ratings as agencies write them', () => {
    for (const r of ['BB-', 'Ba3', 'A-1+', 'uzA+', 'AA(uzb)', 'ruA-', 'F1+', 'P-1', 'B (EXP)']) expect(isValidAgencyRating(r)).toBe(true)
    for (const r of ['', '-A', 'BB-;x', 'a'.repeat(21)]) expect(isValidAgencyRating(r)).toBe(false)
  })

  it('classes only the international long-term scales of S&P, Moody’s and Fitch', () => {
    expect(gradeClass('sp', 'international', 'long', 'BBB-')).toBe('investment')
    expect(gradeClass('fitch', 'international', 'long', 'bb+')).toBe('speculative')
    expect(gradeClass('moodys', 'international', 'long', 'Baa3')).toBe('investment')
    expect(gradeClass('moodys', 'international', 'long', 'Ba1')).toBe('speculative')
    expect(gradeClass('sp', 'national', 'long', 'AA')).toBeNull()
    expect(gradeClass('sp', 'international', 'short', 'A-1')).toBeNull()
    expect(gradeClass('ahbor_reyting', 'international', 'long', 'BBB')).toBeNull()
    expect(gradeClass('sp', 'international', 'long', null)).toBeNull()
    expect(gradeClass('sp', 'international', 'long', 'XYZ')).toBeNull()
  })

  it('names agencies and links references', () => {
    expect(agencyName('sp', null)).toBe('S&P Global Ratings')
    expect(agencyName('sp', null, true)).toBe('S&P')
    expect(agencyName('other', ' Local Agency ')).toBe('Local Agency')
    expect(referenceUrl('https://www.fitchratings.com/research/x')).toBe('https://www.fitchratings.com/research/x')
    expect(referenceUrl('Fitch press release')).toBeNull()
    expect(outlookTone('negative')).toBe('warn')
    expect(outlookTone('stable')).toBe('neutral')
  })
})
