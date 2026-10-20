import { describe, expect, it } from 'vitest'

import { buildWordingContext, wordingLocale } from './context'
import type { MergeData } from './context'

const base: MergeData = {
  source: { kind: 'submission', id: 'r1' },
  insurer: null,
  policyholder: null,
  policy: { number: 'R-1', insured_percentage: 85.5, premium_rate: 0.125, minimum_premium: 1234.5, deductible: null },
  limits: [],
}
const labels = { enumLabel: (_k: string, v: string) => v, countryName: (c: string) => c }

describe('wording context', () => {
  it('formats in the template language, not the UI language', () => {
    const ru = buildWordingContext(base, 'ru', labels) as { policy: Record<string, string> }
    const en = buildWordingContext(base, 'en', labels) as { policy: Record<string, string> }
    expect(ru.policy.minimum_premium).toMatch(/^1\s234,50$/)
    expect(en.policy.minimum_premium).toBe('1,234.50')
    expect(ru.policy.insured_percentage).toBe('85,5%')
    expect(en.policy.premium_rate).toBe('0.125%')
  })

  it('prints a missing value as nothing, never as a dash', () => {
    const ctx = buildWordingContext(base, 'en', labels) as { policy: Record<string, string>; insurer: Record<string, string> }
    expect(ctx.policy.deductible).toBe('')
    expect(ctx.policy.inception_date).toBe('')
    expect(ctx.insurer.name).toBe('')
  })

  it('uses the international convention for languages the app is not in', () => {
    expect(wordingLocale('de')).toBe('en')
    expect(wordingLocale('uz')).toBe('uz')
  })
})
