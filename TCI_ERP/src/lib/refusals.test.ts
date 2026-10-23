import { describe, expect, it } from 'vitest'

import M26 from '../../supabase/migrations/0026_declarations.sql?raw'
import M27 from '../../supabase/migrations/0027_premium.sql?raw'
import M28 from '../../supabase/migrations/0028_overdue_notifications.sql?raw'
import M29 from '../../supabase/migrations/0029_phase4_agenda_portal.sql?raw'
import M54 from '../../supabase/migrations/0054_data_management.sql?raw'
import M55 from '../../supabase/migrations/0055_agenda_redesign.sql?raw'
import M56 from '../../supabase/migrations/0056_premium_payments.sql?raw'
import M58 from '../../supabase/migrations/0058_commercial_offers.sql?raw'
import M13 from '../../supabase/migrations/0013_credit_limit_workflow.sql?raw'
import M60 from '../../supabase/migrations/0060_limit_validation.sql?raw'
import M61 from '../../supabase/migrations/0061_auto_decisions.sql?raw'
import M62 from '../../supabase/migrations/0062_sign_in_notice.sql?raw'
import M63 from '../../supabase/migrations/0063_acting_role.sql?raw'
import M65 from '../../supabase/migrations/0065_admin_technical_only.sql?raw'
import M67 from '../../supabase/migrations/0067_information_gathering.sql?raw'
import M69 from '../../supabase/migrations/0069_credit_analysis.sql?raw'
import { OPERATIONS_REFUSALS, refusalKey } from './refusals'

const ALL = [M13, M26, M27, M28, M29, M54, M55, M56, M58, M60, M61, M62, M63, M65, M67, M69].join('\n')

describe('operations refusal mapping — contract with 0026-0029', () => {
  it('maps only refusals the database actually raises', () => {
    for (const { fragment } of OPERATIONS_REFUSALS) {
      // 0063: the four-eyes texts are RETURNED by tci.limit_four_eyes_refusal
      // and raised as '%' — or as 'validator_%' for a named validator.
      const fourEyes = /^(validator_)?(four_eyes_\w+)$/.exec(fragment)
      if (fourEyes) {
        // 0069 adds four_eyes_own_rating to the same function
        expect(M63 + M69, fragment).toContain(`'${fourEyes[2]}: `)
        if (fourEyes[1]) expect(M63).toContain("raise exception 'validator_%', v_refusal")
        else expect(M63).toContain("raise exception '%', v_refusal using errcode = '42501';")
        continue
      }
      // The fragment is inside a raise literal; it may follow a placeholder
      // ('task % not found or not yours').
      const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expect(ALL, `no exception in the migrations says "${fragment}"`).toMatch(
        new RegExp(`raise exception '[^']*${escaped}`),
      )
    }
  })

  it('finds the key for a real refusal', () => {
    expect(refusalKey({ message: 'a declaration cannot go from accepted to submitted', code: 'P0001' })).toBe(
      'declarations.errors.invalidTransition',
    )
    expect(refusalKey({ message: 'this notification is already resolved_paid', code: 'P0001' })).toBe(
      'overdues.errors.alreadyResolved',
    )
    expect(refusalKey({ message: 'offer_version_conflict: version 3 was saved since you opened version 2', code: 'P0001' })).toBe(
      'offers.errors.versionConflict',
    )
    // 0060: every refusal of the validation chain is named
    expect(
      refusalKey({ message: 'validator_lacks_authority: the validator\'s authority does not cover this amount in rating band B', code: 'P0001' }),
    ).toBe('limits.validation.errors.lacksAuthority')
    expect(refusalKey({ message: 'validation_comment_required: say why', code: 'P0001' })).toBe(
      'limits.validation.errors.commentRequired',
    )
    expect(refusalKey({ message: 'limit_validation_pending: this request is on validation', code: 'P0001' })).toBe(
      'limits.validation.errors.pending',
    )
    expect(refusalKey({ message: 'manager_is_self: a person cannot be their own manager', code: 'P0001' })).toBe(
      'admin.manager.errors.self',
    )
    // 0069: one's own rating — confirming it, and deciding on it
    expect(
      refusalKey({ message: 'four_eyes_own_rating: you calculated this rating and cannot confirm it', code: '42501' }),
    ).toBe('rating.confirmation.errors.ownRating')
    expect(
      refusalKey({ message: 'four_eyes_own_rating: you rated this buyer and cannot decide its limit', code: '42501' }),
    ).toBe('limits.errors.fourEyesOwnRating')
    expect(
      refusalKey({ message: 'validator_four_eyes_own_rating: you rated this buyer and cannot decide its limit', code: 'P0001' }),
    ).toBe('limits.validation.errors.fourEyes')
    // 0063: four eyes — the caller, and a named validator, each by name
    expect(
      refusalKey({ message: 'four_eyes_own_request: you raised this limit request and cannot decide or change it', code: '42501' }),
    ).toBe('limits.errors.fourEyesOwnRequest')
    expect(
      refusalKey({ message: 'validator_four_eyes_own_request: you raised this limit request and cannot decide or change it', code: 'P0001' }),
    ).toBe('limits.validation.errors.fourEyesOwnRequest')
    expect(
      refusalKey({ message: 'validator_four_eyes_own_credit_decision: you made the credit decision on this request and cannot adjust it commercially', code: 'P0001' }),
    ).toBe('limits.validation.errors.fourEyesOwnCredit')
    expect(refusalKey({ message: 'validator_four_eyes: the validator proposed or validated an earlier step', code: 'P0001' })).toBe(
      'limits.validation.errors.fourEyes',
    )
    expect(refusalKey({ message: 'acting_role_not_held: you do not hold the role admin', code: '42501' })).toBe(
      'roles.errors.notHeld',
    )
  })

  it('falls back by SQLSTATE, and never to the raw text', () => {
    expect(refusalKey({ message: 'permission denied for table declarations', code: '42501' })).toBe(
      'common.notPermitted',
    )
    expect(refusalKey({ message: 'declaration not found', code: 'P0002' })).toBe('common.recordNotFound')
    expect(refusalKey({ message: 'socket hang up' })).toBe('common.somethingWentWrong')
    expect(refusalKey(null)).toBe('common.somethingWentWrong')
  })
})
