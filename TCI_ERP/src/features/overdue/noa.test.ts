import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0028_overdue_notifications.sql?raw'
import { canResolve, daysLate, daysPastDue, isReportedLate, noaDeadline } from './noa'

describe('the notification deadline', () => {
  it('is the due date plus the extension period plus the window', () => {
    expect(noaDeadline('2025-01-01', 60, 30)).toBe('2025-04-01')
  })

  it('does not let a missing window swallow the extension period', () => {
    expect(noaDeadline('2025-01-01', 60, null)).toBe('2025-03-02')
  })

  it('handles a zero window', () => {
    expect(noaDeadline('2025-01-01', 60, 0)).toBe('2025-03-02')
  })
})

describe('lateness', () => {
  it('is judged at the reporting date, not today', () => {
    // An NOA filed on time must not turn late because the file stayed open.
    expect(isReportedLate('2025-01-01', 60, 30, '2025-03-15')).toBe(false)
    expect(isReportedLate('2025-01-01', 60, 30, '2025-04-01')).toBe(false)
    expect(isReportedLate('2025-01-01', 60, 30, '2025-04-02')).toBe(true)
  })

  it('counts how late a filing was', () => {
    expect(daysLate('2025-01-01', 60, 30, '2025-04-11')).toBe(10)
    expect(daysLate('2025-01-01', 60, 30, '2025-03-22')).toBe(-10)
  })

  it('ages from the first due date', () => {
    expect(daysPastDue('2025-01-01', '2025-05-01')).toBe(120)
  })

  it('ignores a time component on the reporting timestamp', () => {
    expect(isReportedLate('2025-01-01', 60, 30, '2025-04-02T23:59:00+05:00')).toBe(true)
  })
})

describe('resolution', () => {
  it('is only possible while open', () => {
    expect(canResolve('open')).toBe(true)
    expect(canResolve('resolved_paid')).toBe(false)
    expect(canResolve('withdrawn')).toBe(false)
  })
})

describe('contract with migration 0028', () => {
  it('the SQL deadline is the same sum', () => {
    expect(MIGRATION).toContain('select p_first_due_date')
    expect(MIGRATION).toContain('+ coalesce(p_max_extension_period_days, 0)')
    expect(MIGRATION).toContain('+ coalesce(p_noa_window_days, 0)')
  })

  it('lateness is still measured at reported_at, not now()', () => {
    expect(MIGRATION).toContain('(n.reported_at::date')
    expect(MIGRATION).toContain(
      'Lateness is judged at the moment of REPORTING, not now',
    )
  })

  it('the suspension still goes through the emergency release path', () => {
    expect(MIGRATION).toContain("v_limit.request_id, 'revoked', 0, v_limit.currency_code")
    expect(MIGRATION).toContain("'limits.systemReason.noaSuspension'")
  })

  it('the suspension supersedes the prior decision, or it would not take effect', () => {
    expect(MIGRATION).toContain("set lifecycle = 'superseded'")
  })

  it('a system decision has no human decider but must name a reason', () => {
    expect(MIGRATION).toContain('decided_by is not null or system_generated')
    expect(MIGRATION).toContain('system_generated = (system_reason_key is not null)')
  })

  it('resolving an NOA deliberately does NOT reinstate the limit', () => {
    expect(MIGRATION).toContain('Resolution does NOT reinstate the limit')
  })
})
