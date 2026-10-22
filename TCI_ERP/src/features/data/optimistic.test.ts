import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0054_data_management.sql?raw'
import { assigned, resolved, taken } from './optimistic'
import type { EntityRequest } from './types'

const request = {
  id: 'r',
  status: 'new',
  assigned_to: 'other',
  assigned_at: 'EARLIER',
  entity_id: 'e0',
  resolved_by: null,
  resolved_at: null,
  resolution_note: null,
} as unknown as EntityRequest

describe('data request moves', () => {
  it('take mirrors take_entity_request', () => {
    expect(MIGRATION).toContain("set assigned_to = v_me, assigned_at = now(), status = 'in_progress'")
    expect(MIGRATION).toContain("update tci.entity_requests set status = 'in_progress' where id = p_request_id")
    expect(taken(request, 'me', 'T')).toMatchObject({ assigned_to: 'me', assigned_at: 'T', status: 'in_progress' })
    // already mine and new: it only starts
    expect(taken({ ...request, assigned_to: 'me' }, 'me', 'T')).toMatchObject({ assigned_at: 'EARLIER', status: 'in_progress' })
  })

  it('handing over mirrors assign_entity_request: the new holder starts from new', () => {
    expect(MIGRATION).toContain("set assigned_to = p_user_id, assigned_at = now(), status = 'new'")
    expect(assigned({ ...request, status: 'in_progress' }, 'x', 'T')).toMatchObject({ assigned_to: 'x', status: 'new' })
    expect(assigned(request, 'other', 'T')).toBe(request)
  })

  it('resolving closes with the typed outcome; updated keeps the company it was about', () => {
    expect(resolved(request, 'linked', 'e1', null, 'me', 'T')).toMatchObject({ status: 'linked', entity_id: 'e1', resolved_by: 'me' })
    expect(resolved(request, 'updated', 'e9', null, 'me', 'T').entity_id).toBe('e0')
    expect(resolved(request, 'rejected', null, 'duplicate', 'me', 'T')).toMatchObject({ status: 'rejected', resolution_note: 'duplicate' })
  })
})
