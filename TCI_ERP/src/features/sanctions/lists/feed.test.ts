import { describe, expect, it } from 'vitest'

import M0091 from '../../../../supabase/migrations/0091_sanctions_screening.sql?raw'
import M0095 from '../../../../supabase/migrations/0095_sanctions_feed_account.sql?raw'
import WORKFLOW from '../../../../../.github/workflows/sanctions-lists.yml?raw'
import RUNNER from '../../../../tools/sanctions-feed/run.mjs?raw'
import { FEED_SOURCES, feedPublishedAt, feedRefusal } from './feed'
import { REQUIRED_LISTS } from './parse'

describe('feed sources', () => {
  it('covers exactly the lists the reminder requires, each once, over https', () => {
    expect(FEED_SOURCES.map((s) => s.list).sort()).toEqual([...REQUIRED_LISTS].sort())
    for (const s of FEED_SOURCES) {
      expect(s.url).toMatch(/^https:\/\//)
      if (s.aliasUrl) expect(s.aliasUrl).toMatch(/^https:\/\//)
    }
  })
})

describe('feedPublishedAt', () => {
  it('takes the date the file states', () => {
    expect(feedPublishedAt('2026-10-27', 'Wed, 21 Oct 2026 16:35:16 GMT', '2026-10-28')).toBe('2026-10-27')
    expect(feedPublishedAt('2026-10-27T13:00:00Z', null, '2026-10-28')).toBe('2026-10-27')
  })
  it('falls back to Last-Modified (UTC) when the file states none', () => {
    expect(feedPublishedAt(null, 'Wed, 21 Oct 2026 16:35:16 GMT', '2026-10-28')).toBe('2026-10-21')
    expect(feedPublishedAt('not a date', 'Wed, 21 Oct 2026 23:59:59 GMT', '2026-10-28')).toBe('2026-10-21')
  })
  it('is never later than today, and null when nothing is known', () => {
    expect(feedPublishedAt('2026-10-29', null, '2026-10-28')).toBe('2026-10-28')
    expect(feedPublishedAt(null, null, '2026-10-28')).toBeNull()
    expect(feedPublishedAt(null, 'garbage', '2026-10-28')).toBeNull()
  })
})

describe('feedRefusal', () => {
  it('reads the refusals of 0091 and 0095', () => {
    expect(feedRefusal('sanctions_list_same: this file is the list in use')).toBe('unchanged')
    expect(feedRefusal('sanctions_list_older: the list in use was published on 2026-10-27')).toBe('older')
    expect(feedRefusal('sanctions_list_shrunk: 10 parties against 900 in the list in use')).toBe('shrunk')
    expect(feedRefusal('sanctions_import_only: …')).toBe('failed')
    expect(feedRefusal('fetch failed')).toBe('failed')
  })
  it('matches what the migrations raise', () => {
    for (const fragment of ['sanctions_list_same', 'sanctions_list_older', 'sanctions_list_shrunk']) {
      expect(M0091).toContain(`raise exception '${fragment}:`)
    }
    expect(M0095).toContain("raise exception ''sanctions_shrink_needs_person:")
    expect(M0095).toContain("and not exists (select 1 from tci.user_roles r where r.user_id = f.user_id)")
  })
})

describe('the job', () => {
  it('runs the runner daily and on demand, and skips without its secrets', () => {
    expect(WORKFLOW).toContain('tools/sanctions-feed/run.mjs')
    expect(WORKFLOW).toMatch(/schedule:[\s\S]*?- cron: '\d+ \d+ \* \* \*'/)
    expect(WORKFLOW).toContain('workflow_dispatch')
    expect(WORKFLOW).toContain('SANCTIONS_FEED_EMAIL')
    expect(WORKFLOW).toContain('SANCTIONS_FEED_PASSWORD')
    expect(WORKFLOW).toContain('ready=false')
  })
  it('never confirms a shrunken list and signs in through the gate', () => {
    expect(RUNNER).toContain('p_confirm_shrink: false')
    expect(RUNNER).not.toMatch(/p_confirm_shrink:\s*true/)
    expect(RUNNER).toContain("rpc('login_begin'")
    expect(RUNNER).toContain("rpc('record_sign_in'")
    expect(RUNNER).toContain('/auth/v1/logout')
  })
})
