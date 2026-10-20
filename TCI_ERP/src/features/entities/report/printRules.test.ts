import { describe, expect, it } from 'vitest'

import { cssString, pageCounterContent } from './printRules'

describe('print rules', () => {
  it('escapes quotes and backslashes in CSS strings', () => {
    expect(cssString('A "B" \\ C')).toBe('"A \\"B\\" \\\\ C"')
  })

  it('places the counters wherever the language puts them', () => {
    expect(pageCounterContent('Page \u0001 of \u0002', '\u0001', '\u0002')).toBe(
      '"Page " counter(page) " of " counter(pages)',
    )
    expect(pageCounterContent('\u0001-sahifa / \u0002', '\u0001', '\u0002')).toBe(
      'counter(page) "-sahifa / " counter(pages)',
    )
  })
})
