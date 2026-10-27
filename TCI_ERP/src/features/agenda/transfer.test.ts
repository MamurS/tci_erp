import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0092_task_transfers.sql?raw'
import { rowActions } from './rowActions'
import { TRANSFER_BLOCKED, transferable } from './transfer'
import type { AgendaRow } from './board'
import type { Task } from './types'

describe('handing tasks to a colleague (0092)', () => {
  it('blocks exactly the types the database blocks', () => {
    expect(MIGRATION).toContain(`select p_type in (${TRANSFER_BLOCKED.map((x) => `'${x}'`).join(', ')})`)
  })

  it('offers an open task of a department, never a blocked type or a client task', () => {
    expect(transferable({ task_type: 'rating_stale', target_role: 'credit_underwriter', status: 'open' })).toBe(true)
    expect(transferable({ task_type: 'limit_validation', target_role: 'credit_underwriter', status: 'open' })).toBe(false)
    expect(transferable({ task_type: 'rating_proposal', target_role: 'credit_analyst', status: 'open' })).toBe(false)
    expect(transferable({ task_type: 'claim_ready_to_file', target_role: 'client', status: 'open' })).toBe(false)
    expect(transferable({ task_type: 'rating_stale', target_role: 'credit_underwriter', status: 'done' })).toBe(false)
  })

  it('the row menu offers the hand-over only where a task may move', () => {
    const task = { id: 't1', task_type: 'rating_stale', target_role: 'credit_underwriter', status: 'open', object_type: 'legal_entity', object_id: 'e1', params: {}, snoozed_until: null } as unknown as Task
    const row = { key: 'r1', lead: task, tasks: [task] } as unknown as AgendaRow
    const ctx = { now: new Date(), setCommentingKey: () => undefined, onComplete: () => undefined, onUnsnooze: () => undefined, onTransfer: () => undefined }
    const keys = (r: AgendaRow) => rowActions(r, ctx, (k) => k, () => undefined).map((a) => a.key)
    expect(keys(row)).toContain('transfer')
    const blocked = { ...task, task_type: 'limit_validation' } as Task
    expect(keys({ ...row, lead: blocked, tasks: [blocked] } as AgendaRow)).not.toContain('transfer')
  })
})
