import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0033_coverage_verification.sql?raw'
import {
  BREACH_REASONS,
  SHORTFALL_REASONS,
  coverageTotals,
  noaWarning,
  reasonTone,
  sortReasons,
  verdictTone,
} from './coverage'
import { COVERAGE_REASONS, COVERAGE_VERDICTS } from './types'

describe('coverage reason catalogue — contract with 0033', () => {
  it('lists exactly the codes the SQL enum declares', () => {
    const start = MIGRATION.indexOf('create type tci.coverage_reason as enum (')
    const block = MIGRATION.slice(start, MIGRATION.indexOf(');', start))
    for (const reason of COVERAGE_REASONS) {
      expect(block, `${reason} missing from the SQL enum`).toContain(`'${reason}'`)
    }
    const declared = new Set(block.match(/'[a-z_]+'/g)?.map((s) => s.slice(1, -1)) ?? [])
    expect(declared.size).toBe(COVERAGE_REASONS.length)
  })

  it('lists exactly the verdicts the SQL enum declares', () => {
    expect(MIGRATION).toContain(
      "create type tci.coverage_verdict as enum ('covered', 'partial', 'not_covered');",
    )
    expect(COVERAGE_VERDICTS).toEqual(['covered', 'partial', 'not_covered'])
  })

  it('classifies as breaches exactly the reasons the engine zeroes cover for', () => {
    // Each of these sets v_covered := 0 in tci.verify_claim_coverage.
    for (const reason of [
      'payment_terms_exceeded',
      'shipment_before_inception',
      'shipment_after_expiry',
      'noa_late',
      'noa_missing',
    ] as const) {
      const at = MIGRATION.indexOf(`'${reason}'::tci.coverage_reason;`)
      expect(at, `${reason} not raised by the engine`).toBeGreaterThan(-1)
      expect(MIGRATION.slice(at, at + 120)).toContain('v_covered := 0;')
      expect(BREACH_REASONS).toContain(reason)
    }
  })

  it('treats running past a limit as a shortfall, not a breach', () => {
    expect(SHORTFALL_REASONS).toEqual(['limit_exceeded', 'dl_exceeded'])
    expect(reasonTone('limit_exceeded')).toBe('warn')
    expect(reasonTone('limit_revoked')).toBe('neg')
    expect(reasonTone('covered_by_dl')).toBe('pos')
  })

  it('reads the problem before the reassurance', () => {
    expect(sortReasons(['covered_by_limit', 'noa_late', 'limit_exceeded'])).toEqual([
      'noa_late',
      'limit_exceeded',
      'covered_by_limit',
    ])
  })

  it('tones a verdict the way the financial display rules expect', () => {
    expect(verdictTone('covered')).toBe('pos')
    expect(verdictTone('partial')).toBe('warn')
    expect(verdictTone('not_covered')).toBe('neg')
    expect(verdictTone(null)).toBe('neutral')
  })

  it('raises the notification warning at claim level', () => {
    expect(
      noaWarning({
        cause_of_loss: 'protracted_default',
        overdue_notification_id: null,
        noa_reported_late: null,
        noa_days_late: null,
      }),
    ).toEqual({ key: 'missing', days: 0 })
    // An insolvency does not need an overdue notification behind it.
    expect(
      noaWarning({
        cause_of_loss: 'insolvency',
        overdue_notification_id: null,
        noa_reported_late: null,
        noa_days_late: null,
      }),
    ).toBeNull()
    expect(
      noaWarning({
        cause_of_loss: 'protracted_default',
        overdue_notification_id: 'n1',
        noa_reported_late: true,
        noa_days_late: 5,
      }),
    ).toEqual({ key: 'late', days: 5 })
  })

  it('totals from the effective amounts, so an override is already in', () => {
    const totals = coverageTotals([
      { claimable_amount: 30000, effective_covered_amount: 30000, is_overridden: false },
      { claimable_amount: 40000, effective_covered_amount: 20000, is_overridden: false },
      { claimable_amount: 10000, effective_covered_amount: 10000, is_overridden: true },
    ])
    expect(totals).toEqual({ claimable: 80000, covered: 60000, uncovered: 20000, overridden: 1 })
  })

  it('keeps the balance on the DEBT, not on the covered part', () => {
    // The comment is the contract: an uninsured shipment still fills the limit.
    expect(MIGRATION).toContain(
      'v_balance := v_balance + greatest(coalesce(v_inv.claimable_amount, 0), 0);',
    )
  })

  it('never lets a recompute touch a human override', () => {
    expect(MIGRATION).toContain('-- The override columns are deliberately absent from this list.')
    expect(MIGRATION).toContain(
      'effective_covered_amount numeric(18,2)\n    generated always as (coalesce(override_covered_amount, system_covered_amount)) stored,',
    )
  })
})
