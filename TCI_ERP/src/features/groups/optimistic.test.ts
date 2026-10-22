import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0043_security_closure.sql?raw'
import { edgeEdited, edgeEnded } from './optimistic'
import type { EntityRelationship } from './types'

const edge = {
  id: 'r',
  relationship_type: 'ownership',
  ownership_pct: 60,
  valid_from: '2025-01-01',
  valid_to: null,
  is_live: true,
  source_note: 'register',
} as unknown as EntityRelationship

describe('relationship edits', () => {
  it('an edit takes exactly what was typed', () => {
    expect(edgeEdited(edge, { relationshipType: 'control', ownershipPct: null, sourceNote: null })).toMatchObject({
      relationship_type: 'control',
      ownership_pct: null,
      valid_from: '2025-01-01',
      valid_to: null,
      source_note: null,
    })
  })

  it('ending defaults to today, which is inclusive: live through today, not after', () => {
    expect(MIGRATION).toContain('set valid_to = coalesce(p_valid_to, current_date), updated_at = now()')
    expect(edgeEnded(edge, null, '2026-10-22')).toMatchObject({ valid_to: '2026-10-22', is_live: true })
    expect(edgeEnded(edge, '2026-10-21', '2026-10-22')).toMatchObject({ valid_to: '2026-10-21', is_live: false })
  })
})
