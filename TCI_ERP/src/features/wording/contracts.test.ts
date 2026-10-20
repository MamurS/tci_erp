import { describe, expect, it } from 'vitest'

import { INSURANCE_REQUEST_STATUSES } from '../requests/types'
import { contractSubmissions } from './contracts'

describe('submissions offered on the contracts page', () => {
  it('leaves out drafts and the dead ones, keeps every live status', () => {
    const all = INSURANCE_REQUEST_STATUSES.map((status) => ({ status }))
    const offered = contractSubmissions(all).map((r) => r.status)
    expect(offered).not.toContain('draft')
    expect(offered).not.toContain('declined')
    expect(offered).not.toContain('withdrawn')
    expect(offered).toEqual(
      INSURANCE_REQUEST_STATUSES.filter((s) => s !== 'draft' && s !== 'declined' && s !== 'withdrawn'),
    )
  })
})
