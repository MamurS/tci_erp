import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0034_indemnity_recoveries.sql?raw'
import NQL from '../../../supabase/migrations/0037_nql_threshold.sql?raw'
import {
  BELOW_NQL_REASON,
  INDEMNITY_STEP_KEYS,
  calculateIndemnity,
  round2,
  splitRecovery,
} from './indemnity'

// 0037 replaced tci.calculate_indemnity, so the indemnity contract is read
// from THERE; 0034 is still the authority for the recovery split.
describe('indemnity — contract with 0037', () => {
  it('uses the same step keys, in the same order', () => {
    let cursor = -1
    for (const key of INDEMNITY_STEP_KEYS) {
      const at = NQL.indexOf(`'key', '${key}'`)
      expect(at, `${key} missing from the migration`).toBeGreaterThan(-1)
      expect(at, `${key} out of order`).toBeGreaterThan(cursor)
      cursor = at
    }
  })

  it('tests the NQL threshold BEFORE the insured percentage', () => {
    expect(NQL.indexOf("'key', 'claims.indemnity.step.nqlThreshold'")).toBeLessThan(
      NQL.indexOf("'key', 'claims.indemnity.step.insuredPercentage'"),
    )
    expect(INDEMNITY_STEP_KEYS.indexOf('claims.indemnity.step.nqlThreshold')).toBeLessThan(
      INDEMNITY_STEP_KEYS.indexOf('claims.indemnity.step.insuredPercentage'),
    )
  })

  it('never subtracts the NQL — it is a gate, not a haircut', () => {
    expect(NQL).toContain('v_nql_met := (v_covered >= v_nql);')
    // Read the FUNCTION BODY, not the whole file: the migration's own
    // assertion block deliberately mentions the forbidden expression.
    const body = NQL.slice(
      NQL.indexOf('create or replace function tci.calculate_indemnity'),
      NQL.indexOf('comment on function tci.calculate_indemnity'),
    )
    expect(body).not.toContain('v_running - v_nql')
    expect(body).not.toContain("'key', 'claims.indemnity.step.nql'")
    // ...and the migration asserts the same thing about itself, on the live
    // function's source, so a future edit cannot quietly reintroduce it.
    expect(NQL).toContain(
      "raise exception 'the NQL must not be subtracted - it is a threshold, not a deduction'",
    )
  })

  it('lets a loss exactly equal to the threshold qualify', () => {
    expect(NQL).toContain('v_nql_met := (v_covered >= v_nql);')
    expect(NQL).toContain(
      'raise exception \'a loss exactly equal to the threshold must qualify (>=, not >)\'',
    )
  })

  it('applies the insured percentage before the money deductions', () => {
    expect(NQL).toContain('v_running := round(v_running * v_policy.insured_percentage / 100.0, 2);')
    expect(NQL.indexOf('insured_percentage / 100.0')).toBeLessThan(NQL.indexOf('v_ded := least('))
  })

  it('floors every deduction at what is left', () => {
    expect(NQL).toContain(
      'v_ded := least(round(coalesce(v_policy.deductible_each_loss, 0), 2), v_running);',
    )
    expect(NQL).toContain('v_afl_applied   := least(v_afl_available, v_running);')
  })

  it('caps at what is left of the maximum liability', () => {
    expect(NQL).toContain('v_capped := least(v_running, v_liab_available);')
  })

  it('names the refusal when the loss is below the threshold', () => {
    expect(NQL).toContain('is below the non-qualifying loss threshold')
    expect(NQL).toContain("'claims.indemnity.belowNql'")
    expect(BELOW_NQL_REASON).toBe('claims.indemnity.belowNql')
  })

  it('reproduces the worked example the live smoke asserts', () => {
    // 75 000 covered clears the 1 000 threshold, so the FULL amount proceeds:
    // 90% insured, deductible 500, AFL 2 000 unused, cap 200 000 untouched.
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
    expect(t.steps.map((s) => s.amount)).toEqual([75000, 75000, 67500, 67000, 65000, 65000])
    expect(t.nql_met).toBe(true)
    expect(t.not_indemnifiable_reason).toBeNull()
    expect(t.payable).toBe(65000)
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
    expect(t.steps[4]!.amount).toBe(76000)
    expect(t.steps[4]!.detail.available).toBe(0)
    expect(t.steps[5]!.detail.capped).toBe(true)
    expect(t.payable).toBe(50000)
  })

  it('pays nothing when the covered loss is below the threshold', () => {
    const t = calculateIndemnity({
      coveredAmount: 999.99,
      claimableAmount: 999.99,
      insuredPercentage: 90,
      nqlAmount: 1000,
      deductibleEachLoss: 0,
      aggregateFirstLoss: null,
      aflAlreadyConsumed: 0,
      maxLiabilityAmount: null,
      liabilityAlreadyConsumed: 0,
      currency: 'USD',
    })
    expect(t.nql_met).toBe(false)
    expect(t.not_indemnifiable_reason).toBe(BELOW_NQL_REASON)
    expect(t.steps[1]!.amount).toBe(0)
    expect(t.steps[1]!.detail.shortfall).toBe(0.01)
    expect(t.payable).toBe(0)
    // Every later step is zero, not negative.
    expect(t.steps.slice(1).every((s) => s.amount === 0)).toBe(true)
  })

  it('pays a loss exactly equal to the threshold — equal qualifies', () => {
    const t = calculateIndemnity({
      coveredAmount: 1000,
      claimableAmount: 1000,
      insuredPercentage: 90,
      nqlAmount: 1000,
      deductibleEachLoss: 0,
      aggregateFirstLoss: null,
      aflAlreadyConsumed: 0,
      maxLiabilityAmount: null,
      liabilityAlreadyConsumed: 0,
      currency: 'USD',
    })
    expect(t.nql_met).toBe(true)
    expect(t.not_indemnifiable_reason).toBeNull()
    // The threshold takes NOTHING off: the full 1 000 goes to the percentage.
    expect(t.steps[1]!.amount).toBe(1000)
    expect(t.steps[1]!.detail.shortfall).toBe(0)
    expect(t.payable).toBe(900)
  })

  it('one tiyin above the threshold is payable in full', () => {
    const t = calculateIndemnity({
      coveredAmount: 1000.01,
      claimableAmount: 1000.01,
      insuredPercentage: 100,
      nqlAmount: 1000,
      deductibleEachLoss: 0,
      aggregateFirstLoss: null,
      aflAlreadyConsumed: 0,
      maxLiabilityAmount: null,
      liabilityAlreadyConsumed: 0,
      currency: 'USD',
    })
    expect(t.nql_met).toBe(true)
    expect(t.payable).toBe(1000.01)
  })

  it('never returns a negative indemnity', () => {
    const t = calculateIndemnity({
      coveredAmount: 6000,
      claimableAmount: 6000,
      insuredPercentage: 90,
      nqlAmount: 5000,
      deductibleEachLoss: 5000,
      aggregateFirstLoss: 5000,
      aflAlreadyConsumed: 0,
      maxLiabilityAmount: null,
      liabilityAlreadyConsumed: 0,
      currency: 'UZS',
    })
    expect(t.nql_met).toBe(true)
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
