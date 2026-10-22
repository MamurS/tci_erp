import { describe, expect, it } from 'vitest'

import M26 from '../../supabase/migrations/0026_declarations.sql?raw'
import M27 from '../../supabase/migrations/0027_premium.sql?raw'
import M28 from '../../supabase/migrations/0028_overdue_notifications.sql?raw'
import M29 from '../../supabase/migrations/0029_phase4_agenda_portal.sql?raw'
import M54 from '../../supabase/migrations/0054_data_management.sql?raw'
import M55 from '../../supabase/migrations/0055_agenda_redesign.sql?raw'
import M56 from '../../supabase/migrations/0056_premium_payments.sql?raw'
import M58 from '../../supabase/migrations/0058_commercial_offers.sql?raw'
import { OPERATIONS_REFUSALS, refusalKey } from './refusals'

const ALL = [M26, M27, M28, M29, M54, M55, M56, M58].join('\n')

describe('operations refusal mapping — contract with 0026-0029', () => {
  it('maps only refusals the database actually raises', () => {
    for (const { fragment } of OPERATIONS_REFUSALS) {
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
    expect(refusalKey({ message: 'brochure_not_draft: version 3 is published', code: 'P0001' })).toBe(
      'brochure.errors.notDraft',
    )
    expect(refusalKey({ message: 'media_not_uploaded: the file is not in the media library bucket', code: 'P0002' })).toBe(
      'media.errors.notUploaded',
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
