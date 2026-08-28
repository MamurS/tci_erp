import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0029_phase4_agenda_portal.sql?raw'
import { lastClosedPeriodStart, periodEnd, periodLabel, periodStart } from './period'

describe('declaration periods', () => {
  it('finds the monthly period containing a date', () => {
    expect(periodStart('2025-07-14', 'monthly')).toBe('2025-07-01')
    expect(periodEnd('2025-07-01', 'monthly')).toBe('2025-07-31')
  })

  it('finds the quarterly period containing a date', () => {
    expect(periodStart('2025-07-14', 'quarterly')).toBe('2025-07-01')
    expect(periodEnd('2025-07-01', 'quarterly')).toBe('2025-09-30')
    expect(periodStart('2025-02-28', 'quarterly')).toBe('2025-01-01')
    expect(periodEnd('2025-01-01', 'quarterly')).toBe('2025-03-31')
  })

  it('handles February in a leap year', () => {
    expect(periodEnd('2024-02-01', 'monthly')).toBe('2024-02-29')
    expect(periodEnd('2025-02-01', 'monthly')).toBe('2025-02-28')
  })

  it('crosses a year boundary going back', () => {
    expect(lastClosedPeriodStart('2025-01-15', 'monthly')).toBe('2024-12-01')
    expect(lastClosedPeriodStart('2025-01-15', 'quarterly')).toBe('2024-10-01')
  })

  it('labels a period the way a person would name it', () => {
    expect(periodLabel('2026-07-01', 'monthly')).toBe('2026-07')
    expect(periodLabel('2026-07-01', 'quarterly')).toBe('2026-Q3')
    expect(periodLabel('2026-01-01', 'quarterly')).toBe('2026-Q1')
  })

  it('is not moved by the time of day or a timezone', () => {
    // A period is a calendar fact; parsing must never go through a local Date.
    expect(periodStart('2025-07-01T23:30:00+05:00', 'monthly')).toBe('2025-07-01')
  })
})

describe('contract with migration 0029', () => {
  it('the SQL truncates to month and quarter exactly as this module does', () => {
    expect(MIGRATION).toContain("when 'monthly'   then date_trunc('month',   p_as_of)::date")
    expect(MIGRATION).toContain("when 'quarterly' then date_trunc('quarter', p_as_of)::date")
    expect(MIGRATION).toContain(
      "when 'monthly'   then (p_period_start + interval '1 month'  - interval '1 day')::date",
    )
    expect(MIGRATION).toContain(
      "when 'quarterly' then (p_period_start + interval '3 months' - interval '1 day')::date",
    )
  })
})
