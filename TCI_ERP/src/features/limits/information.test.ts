import { describe, expect, it } from 'vitest'

import M67 from '../../../supabase/migrations/0067_information_gathering.sql?raw'
import { DESTINATIONS } from '../agenda/destinations'
import { taskLink } from '../agenda/catalogue'
import { INFORMATION_GAPS, mayWaiveInformation, missingStatements, parseGaps } from './information'

describe('information gathering (0067)', () => {
  it('names the gaps in the order tci.buyer_information_gaps returns them', () => {
    const body = M67.slice(M67.indexOf('create function tci.buyer_information_gaps'))
    const named = [...body.slice(0, body.indexOf('$$;')).matchAll(/then '([a-z_]+)'/g)].map((m) => m[1])
    expect(named).toEqual([...INFORMATION_GAPS])
  })

  it('keeps only known gaps and tells statements from the card', () => {
    expect(parseGaps(['address', 'bogus', 3, 'stale_statements'])).toEqual(['address', 'stale_statements'])
    expect(parseGaps(null)).toEqual([])
    expect(missingStatements(['address'])).toBe(false)
    expect(missingStatements(['no_statements'])).toBe(true)
  })

  it('lets credit underwriting waive, never on its own request — as the function does', () => {
    expect(M67).toContain("perform tci.require_role('credit_underwriter');")
    expect(M67).toContain("v_refusal := tci.limit_four_eyes_refusal(p_request_id, (select auth.uid()), 'credit');")
    expect(mayWaiveInformation(['credit_underwriter'], false)).toBe(true)
    expect(mayWaiveInformation(['credit_underwriter'], true)).toBe(false)
    for (const r of ['sales', 'commercial_underwriter', 'information_manager', 'admin'] as const) {
      expect(mayWaiveInformation([r], false)).toBe(false)
    }
  })

  it('sends the information desk to the buyer card, at the statements when those are missing', () => {
    const task = (gaps: string[]) => ({
      object_type: 'credit_limit_request' as const,
      object_id: 'r1',
      task_type: 'limit_information_needed' as const,
      params: { entity_id: 'e1', entity_name: 'Buyer', gaps },
    })
    expect(taskLink(task(['address']))).toBe('/entities/e1')
    const lead = task(['no_statements']) as unknown as Parameters<(typeof DESTINATIONS)['limit_information_needed']>[1]
    expect(DESTINATIONS.limit_information_needed({} as never, lead, {}).path).toBe('/entities/e1?tab=financials')
    // the routing opens the task for the information desk, AUTO-closed
    expect(M67).toContain("'information_manager'::tci.user_role, null, null, 'high', new.id);")
    expect(M67).toContain("perform tci.close_tasks(array['limit_information_needed']::tci.task_type[], new.object_id, 'done');")
  })
})
