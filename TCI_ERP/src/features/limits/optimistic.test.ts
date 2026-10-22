import { describe, expect, it } from 'vitest'

import MIGRATION_0013 from '../../../supabase/migrations/0013_credit_limit_workflow.sql?raw'
import MIGRATION_0020 from '../../../supabase/migrations/0020_two_stage_decisions.sql?raw'
import MIGRATION_0043 from '../../../supabase/migrations/0043_security_closure.sql?raw'
import { held, released, REQUEST_ACTION_STATUS, withStatus } from './optimistic'
import type { EffectiveLimit } from './types'

describe('limit request statuses painted before the answer', () => {
  it('are the statuses the SQL functions set', () => {
    // submit and withdraw were restated in 0043; start review is 0013's.
    expect(MIGRATION_0043).toContain(`set status = '${REQUEST_ACTION_STATUS.submit_limit_request}', submitted_at = now()`)
    expect(MIGRATION_0013).toContain(
      `update tci.credit_limit_requests set status = '${REQUEST_ACTION_STATUS.start_limit_review}'`,
    )
    expect(MIGRATION_0043).toContain(
      `set status = '${REQUEST_ACTION_STATUS.withdraw_limit_request}', withdrawn_at = now(), withdraw_comment = p_comment`,
    )
  })

  it('change the status and nothing else', () => {
    expect(withStatus({ id: 'r', status: 'draft' as string, amount: 5 }, 'submitted')).toEqual({ id: 'r', status: 'submitted', amount: 5 })
  })
})

describe('release and hold', () => {
  const limit = {
    decision_id: 'd',
    released_at: null,
    release_kind: null,
    held: true,
    hold_comment: 'wait',
  } as unknown as EffectiveLimit

  it('release mirrors release_decision: confirmed now, unheld', () => {
    expect(MIGRATION_0020).toContain("release_kind = coalesce(release_kind, 'sales_confirmed')")
    expect(MIGRATION_0020).toContain('set released_at = coalesce(released_at, now())')
    expect(released(limit, 'T')).toMatchObject({ released_at: 'T', release_kind: 'sales_confirmed', held: false, hold_comment: null })
    expect(released({ ...limit, released_at: 'EARLIER' }, 'T').released_at).toBe('EARLIER')
  })

  it('hold mirrors hold_decision', () => {
    expect(MIGRATION_0020).toContain('set held = true, hold_comment = p_comment')
    expect(held({ ...limit, held: false, hold_comment: null }, 'why')).toMatchObject({ held: true, hold_comment: 'why' })
  })
})
