import { describe, expect, it } from 'vitest'

import { firstTabOf, SECTION_OF, sectionsFor } from './cardTabs'
import type { CardTab } from './cardTabs'

describe('company card sections', () => {
  const all: CardTab[] = ['overview', 'financials', 'rating', 'sanctions', 'limits', 'policies', 'requests', 'claims', 'group', 'access']

  it('groups ten tabs into six sections, in order', () => {
    expect(sectionsFor(all).map((s) => [s.section, s.tabs])).toEqual([
      ['overview', ['overview']],
      ['analysis', ['financials', 'rating', 'sanctions']],
      ['cover', ['limits', 'policies', 'requests']],
      ['claims', ['claims']],
      ['group', ['group']],
      ['access', ['access']],
    ])
  })

  it('drops a section with no tab available (a prospect: no limits, policies, claims)', () => {
    const prospect: CardTab[] = ['overview', 'financials', 'rating', 'requests', 'group']
    expect(sectionsFor(prospect).map((s) => s.section)).toEqual(['overview', 'analysis', 'cover', 'group'])
    expect(firstTabOf('cover', prospect)).toBe('requests')
  })

  it('keeps every tab in exactly one section', () => {
    for (const tab of all) expect(sectionsFor(all).filter((s) => s.tabs.includes(tab))).toHaveLength(1)
    expect(Object.keys(SECTION_OF).sort()).toEqual([...all].sort())
  })
})
