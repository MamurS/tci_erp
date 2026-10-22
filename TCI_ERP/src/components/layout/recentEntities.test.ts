import { describe, expect, it } from 'vitest'

import { RECENT_LIMIT, parseRecent, withRecent } from './recentEntities'

describe('recent companies', () => {
  it('moves a reopened company to the front without duplicating it', () => {
    const list = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]
    expect(withRecent(list, { id: 'b', name: 'B' }).map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('keeps only the last few', () => {
    let list: { id: string; name: string }[] = []
    for (let i = 0; i < 9; i += 1) list = withRecent(list, { id: `e${i}`, name: `E${i}` })
    expect(list).toHaveLength(RECENT_LIMIT)
    expect(list[0].id).toBe('e8')
  })

  it('survives whatever storage holds', () => {
    expect(parseRecent(null)).toEqual([])
    expect(parseRecent('not json')).toEqual([])
    expect(parseRecent('{"id":"x"}')).toEqual([])
    expect(parseRecent('[{"id":"x","name":"X"},{"id":3},null]')).toEqual([{ id: 'x', name: 'X' }])
  })
})
