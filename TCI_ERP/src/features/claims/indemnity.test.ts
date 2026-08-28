import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0034_indemnity_recoveries.sql?raw'
import { INDEMNITY_STEP_KEYS, calculateIndemnity, round2, splitRecovery } from './indemnity'

describe('indemnity — contract with 0034', () => {
  it('uses the same step keys, in the same order', () => {
    let cursor = -1
    for (const key of INDEMNITY_STEP_KEYS) {
      const at = MIGRATION.indexOf(`'key', '${key}'`)
      expect(at, `${key} missing from the migration`).toBeGreaterThan(-1)
      expect(at, `${key} out of order`).toBeGreaterThan(cursor)
      cursor = at
    }
  })

  it('applies the insured percentage before the money deductions', () => {
    expect(MIGRATION).toContain('v_running := round(v_running * v_policy.insured_percentage / 100.0, 2);')
    expect(MIGRATION.indexOf('insured_percentage / 100.0')).toBeLessThan(
      MIGRATION.indexOf('v_nql := least('),
    )
  })

  it('floors every deduction at what is left', () => {
    expect(MIGRATION).toContain('v_nql := least(round(coalesce(v_policy.nql_amount, 0), 2), v_running);')
    expect(MIGRATION).toContain(
      'v_ded := least(round(coalesce(v_policy.deductible_each_loss, 0), 2), v_running);',
    )
    expect(MIGRATION).toContain('v_afl_applied   := least(v_afl_available, v_running);')
  })

  it('caps at what is left of the maximum liability', () => {
    expect(MIGRATION).toContain('v_capped := least(v_running, v_liab_available);')
  })

  it('reproduces the worked example the live smoke asserts', () => {
    // 75 000 covered, 90% insured, NQL 1 000, deductible 500, AFL 2 000 unused,
    // maximum liability 200 000 untouched.
    const t = calculateIndemnity({
      coveredAmount: 75000,
      claimableAmount: 110000,
      insuredPercentage: 90,
      nqlAmount: 1000,
      deductibleEachLoss: 500,
      aggregateFirstLoss: 2000,
      aflAlreadyConsumed: 0,
      maxLiabilityAmount: 200000,
      liabilityAlreadyConsumed: 0,
      currency: 'USD',
    })
    expect(t.steps.map((s) => s.amount)).toEqual([75000, 67500, 66500, 66000, 64000, 64000])
    expect(t.payable).toBe(64000)
    expect(t.fully_covered).toBe(false)
  })

  it('exhausts the aggregate first loss and then lets the cap bind', () => {
    const t = calculateIndemnity({
      coveredAmount: 85000,
      claimableAmount: 110000,
      insuredPercentage: 90,
      nqlAmount: 1000,
      deductibleEachLoss: 500,
      aggregateFirstLoss: 2000,
      aflAlreadyConsumed: 2000, // an earlier claim took all of it
      maxLiabilityAmount: 200000,
      liabilityAlreadyConsumed: 150000,
      currency: 'USD',
    })
    expect(t.steps[4]!.amount).toBe(75000)
    expect(t.steps[4]!.detail.available).toBe(0)
    expect(t.steps[5]!.detail.capped).toBe(true)
    expect(t.payable).toBe(50000)
  })

  it('never returns a negative indemnity', () => {
    const t = calculateIndemnity({
      coveredAmount: 1000,
      claimableAmount: 1000,
      insuredPercentage: 90,
      nqlAmount: 5000,
      deductibleEachLoss: 5000,
      aggregateFirstLoss: 5000,
      aflAlreadyConsumed: 0,
      maxLiabilityAmount: null,
      liabilityAlreadyConsumed: 0,
      currency: 'UZS',
    })
    expect(t.payable).toBe(0)
    expect(t.steps.every((s) => s.amount >= 0)).toBe(true)
  })

  it('leaves the calculation uncapped when no maximum liability was agreed', () => {
    const t = calculateIndemnity({
      coveredAmount: 100000,
      claimableAmount: 100000,
      insuredPercentage: 100,
      nqlAmount: null,
      deductibleEachLoss: null,
      aggregateFirstLoss: null,
      aflAlreadyConsumed: 0,
      maxLiabilityAmount: null,
      liabilityAlreadyConsumed: 0,
      currency: 'EUR',
    })
    expect(t.payable).toBe(100000)
    expect(t.steps[5]!.detail.available).toBeNull()
    expect(t.steps[5]!.detail.capped).toBe(false)
    expect(t.fully_covered).toBe(true)
  })

  it('rounds the way numeric does', () => {
    expect(round2(9090.90909)).toBe(9090.91)
    expect(round2(0.145)).toBe(0.15)
    expect(round2(2.005)).toBe(2.01)
  })
})

describe('recovery distribution — contract with 0034', () => {
  it('takes the costs off the top and splits the rest by what each side bore', () => {
    expect(MIGRATION).toContain('v_net := round(p_gross - coalesce(p_costs, 0), 2);')
    expect(MIGRATION).toContain('v_ins := round(v_net * v_ins_borne / v_total_borne, 2);')
    expect(MIGRATION).toContain('v_ins, v_net - v_ins, v_ins_borne, v_ph_borne,')
  })

  it('reproduces the two recoveries the live smoke asserts', () => {
    const first = splitRecovery({ gross: 22000, costs: 2000, indemnityPaid: 50000, claimableAmount: 110000 })
    expect(first.net).toBe(20000)
    expect(first.insurerShare).toBe(9090.91)
    expect(first.policyholderShare).toBe(10909.09)
    expect(first.insurerShare + first.policyholderShare).toBe(first.net)

    const second = splitRecovery({ gross: 11000, costs: 0, indemnityPaid: 50000, claimableAmount: 110000 })
    expect(second.insurerShare).toBe(5000)
    expect(second.policyholderShare).toBe(6000)
  })

  it('gives the whole recovery to the policyholder when the insurer paid nothing', () => {
    const r = splitRecovery({ gross: 5000, costs: 500, indemnityPaid: 0, claimableAmount: 40000 })
    expect(r.insurerShare).toBe(0)
    expect(r.policyholderShare).toBe(4500)
  })

  it('keeps the shares adding back to the net whatever the rounding', () => {
    for (const gross of [1, 7, 33.33, 1234.56, 999999.99]) {
      const r = splitRecovery({ gross, costs: 0, indemnityPaid: 1, claimableAmount: 3 })
      expect(round2(r.insurerShare + r.policyholderShare)).toBe(r.net)
    }
  })
})
