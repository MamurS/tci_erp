import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({ tci: () => ({}) }))

const { normaliseConcentration } = await import('./api')

describe('normaliseConcentration', () => {
  it('fills the lists a partial answer leaves out', () => {
    const c = normaliseConcentration({ buyers: 2, total_uzs: 10, warn: false })
    expect(c?.by_sector).toEqual([])
    expect(c?.by_country).toEqual([])
    expect(c?.blocked).toEqual([])
    expect(c?.buyers).toBe(2)
  })

  it('answers null for anything that is not an object', () => {
    expect(normaliseConcentration(null)).toBeNull()
    expect(normaliseConcentration([])).toBeNull()
    expect(normaliseConcentration('x')).toBeNull()
  })
})
