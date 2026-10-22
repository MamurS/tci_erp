import { describe, expect, it } from 'vitest'

import MAIN from '../main.tsx?raw'
import { mutationLabel, timingLine } from './mutationTiming'

describe('dev mutation timing', () => {
  it('says the key, the round trip and the click-to-paint', () => {
    expect(timingLine('agenda.complete', 412.4, 8.6, false)).toBe('[mutation] agenda.complete 412ms · paint 9ms')
    expect(timingLine('limits.decide', 300, null, true)).toBe('[mutation] limits.decide 300ms · refused')
  })

  it('labels a mutation by its key, or by its id when it has none', () => {
    expect(mutationLabel({ options: { mutationKey: ['agenda', 'snooze'] }, mutationId: 3 })).toBe('agenda.snooze')
    expect(mutationLabel({ options: {}, mutationId: 7 })).toBe('mutation#7')
  })

  it('is only ever loaded behind import.meta.env.DEV', () => {
    expect(MAIN).toContain("if (import.meta.env.DEV) void import('./lib/mutationTiming')")
    expect(MAIN).not.toMatch(/^import .*mutationTiming/m)
  })
})
