import { describe, expect, it } from 'vitest'

import M43 from '../../../supabase/migrations/0043_security_closure.sql?raw'
import { resolvePeriodLink } from './periodLink'

const row = (id: string, period_start: string, status: 'draft' | 'submitted' | 'accepted' | 'disputed' | 'corrected') => ({
  id,
  period_start,
  status,
})

describe('the declaration-period deep link', () => {
  it('opens the one live declaration of the period', () => {
    const rows = [row('a', '2026-06-01', 'accepted'), row('b', '2026-07-01', 'submitted')]
    expect(resolvePeriodLink(rows, 'p', '2026-07-01')).toEqual({ kind: 'open', id: 'b' })
  })

  it('opens a draft too: it is the declaration of that period', () => {
    expect(resolvePeriodLink([row('d', '2026-07-01', 'draft')], 'p', '2026-07-01')).toEqual({ kind: 'open', id: 'd' })
  })

  it('skips corrected declarations: the replacement is the live one', () => {
    const rows = [row('old', '2026-07-01', 'corrected'), row('new', '2026-07-01', 'accepted')]
    expect(resolvePeriodLink(rows, 'p', '2026-07-01')).toEqual({ kind: 'open', id: 'new' })
  })

  it('reports a period with nothing live as missing', () => {
    expect(resolvePeriodLink([], 'p', '2026-07-01')).toEqual({ kind: 'missing', period: '2026-07-01' })
    expect(resolvePeriodLink([row('old', '2026-07-01', 'corrected')], 'p', '2026-07-01')).toEqual({
      kind: 'missing',
      period: '2026-07-01',
    })
  })

  it('does nothing without a policy, or with no usable period', () => {
    const rows = [row('b', '2026-07-01', 'submitted')]
    expect(resolvePeriodLink(rows, undefined, '2026-07-01')).toEqual({ kind: 'none' })
    expect(resolvePeriodLink(rows, 'p', null)).toEqual({ kind: 'none' })
    expect(resolvePeriodLink(rows, 'p', '2026-07')).toEqual({ kind: 'none' })
  })

  it('guesses nothing if two live rows ever shared a period', () => {
    const rows = [row('x', '2026-07-01', 'accepted'), row('y', '2026-07-01', 'submitted')]
    expect(resolvePeriodLink(rows, 'p', '2026-07-01')).toEqual({ kind: 'none' })
  })

  it('uses the same "declared" rule as the Agenda task that links here', () => {
    expect(M43).toContain("and d.period_start = v_row.period_start\n         and d.status <> 'corrected'")
  })
})
