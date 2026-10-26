import { describe, expect, it } from 'vitest'

import { CLAIM_STATUSES } from '../claims/types'
import { INSURANCE_REQUEST_STATUSES } from '../requests/types'
import { TIMELINE_STEPS, timelineStep, waitsOnYou } from './timelines'

describe('portal timelines', () => {
  it('a limit request is sent, then reviewed; decided ones have no timeline', () => {
    expect(timelineStep('limit', 'submitted')).toBe(0)
    expect(timelineStep('limit', 'information_gathering')).toBe(0)
    expect(timelineStep('limit', 'escalated')).toBe(1)
    expect(timelineStep('limit', 'decided')).toBeNull()
    expect(timelineStep('limit', 'draft')).toBeNull()
  })

  it('every open submission status sits on a step inside the range', () => {
    const open = INSURANCE_REQUEST_STATUSES.filter((s) => !['draft', 'declined', 'withdrawn', 'bound'].includes(s))
    for (const status of open) {
      const step = timelineStep('submission', status)
      expect(step, status).not.toBeNull()
      expect(step!).toBeLessThan(TIMELINE_STEPS.submission.length)
    }
    expect(timelineStep('submission', 'bound')).toBeNull()
  })

  it('every open claim status sits on a step; finished ones have none', () => {
    for (const status of CLAIM_STATUSES) {
      const step = timelineStep('claim', status)
      if (['draft', 'declined', 'paid', 'closed', 'withdrawn'].includes(status)) expect(step, status).toBeNull()
      else expect(step!, status).toBeLessThan(TIMELINE_STEPS.claim.length)
    }
  })

  it('names what waits on the policyholder', () => {
    expect(waitsOnYou('submission', 'client_review')).toBe(true)
    expect(waitsOnYou('claim', 'info_requested')).toBe(true)
    expect(waitsOnYou('limit', 'under_review')).toBe(false)
  })
})
