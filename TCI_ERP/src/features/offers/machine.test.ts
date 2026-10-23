/** Contract tests: the offer rules the screens mirror, locked to the text of
 * migration 0058 — and the pure helpers around them. */

import { describe, expect, it } from 'vitest'

import MIGRATION from '../../../supabase/migrations/0058_commercial_offers.sql?raw'
import ru from '../../i18n/locales/ru.json'
import {
  addDays,
  canEdit,
  canPublishOffers,
  canWriteOffers,
  clientCanAccept,
  clientCanRequestChanges,
  effectiveStatus,
  isLive,
  LIVE_STATUSES,
  OFFER_PUBLISHERS,
  OFFER_REQUEST_STATUSES,
  OFFER_WRITERS,
  offerDocumentTitle,
  offerToday,
  publishBlocker,
  requestAllowsOffer,
  versionState,
} from './machine'
import { defaultOfferParams, NOTE_MAX, paramsForSave } from './kp/params'
import { EFFECTIVE_OFFER_STATUSES, OFFER_STATUSES } from './model'

describe('the offer statuses', () => {
  it('lists exactly the values of tci.offer_status', () => {
    expect(MIGRATION).toContain(
      "create type tci.offer_status as enum\n  ('draft', 'published', 'viewed', 'accepted', 'changes_requested', 'declined', 'withdrawn');",
    )
    expect([...OFFER_STATUSES]).toEqual(['draft', 'published', 'viewed', 'accepted', 'changes_requested', 'declined', 'withdrawn'])
  })

  it('derives expiry exactly as tci.offer_effective_status does', () => {
    expect(MIGRATION).toContain(
      "when p_status in ('published', 'viewed') and p_valid_until < tci.offer_today() then 'expired'",
    )
    expect(effectiveStatus('published', '2026-10-21', '2026-10-22')).toBe('expired')
    expect(effectiveStatus('viewed', '2026-10-21', '2026-10-22')).toBe('expired')
    // the last valid day is still valid
    expect(effectiveStatus('published', '2026-10-22', '2026-10-22')).toBe('published')
    // only an offer out with the client expires
    expect(effectiveStatus('draft', '2026-01-01', '2026-10-22')).toBe('draft')
    expect(effectiveStatus('accepted', '2026-01-01', '2026-10-22')).toBe('accepted')
    expect(effectiveStatus('changes_requested', '2026-01-01', '2026-10-22')).toBe('changes_requested')
  })

  it('counts the day in Tashkent, as tci.offer_today does', () => {
    expect(MIGRATION).toContain("select (now() at time zone 'Asia/Tashkent')::date")
    // 20:30 UTC on the 21st is 01:30 on the 22nd in Tashkent (UTC+5)
    expect(offerToday(new Date('2026-10-21T20:30:00Z'))).toBe('2026-10-22')
    expect(offerToday(new Date('2026-10-21T18:59:00Z'))).toBe('2026-10-21')
  })

  it('has a label for every status the screens can show', () => {
    for (const s of EFFECTIVE_OFFER_STATUSES) expect(ru.offers.statuses[s], s).toBeTruthy()
  })
})

describe('the rules the buttons mirror', () => {
  it('a live offer is what tci.offer_is_live says', () => {
    expect(MIGRATION).toContain("as $$ select p_status in ('draft', 'published', 'viewed', 'changes_requested') $$;")
    expect([...LIVE_STATUSES].sort()).toEqual(['changes_requested', 'draft', 'published', 'viewed'])
    expect(isLive('accepted')).toBe(false)
    expect(isLive('withdrawn')).toBe(false)
  })

  it('an offer is prepared in the steps tci.offer_request_status_ok allows', () => {
    expect(MIGRATION).toContain("as $$ select p_status in ('commercial_review', 'sales_confirmation', 'client_review') $$;")
    expect([...OFFER_REQUEST_STATUSES]).toEqual(['commercial_review', 'sales_confirmation', 'client_review'])
    expect(requestAllowsOffer('underwriting')).toBe(false)
    expect(requestAllowsOffer('accepted')).toBe(false)
  })

  it('who writes and who publishes, as the functions gate it', () => {
    expect(MIGRATION).toContain("perform tci.require_role('admin', 'sales', 'commercial_underwriter');")
    expect(MIGRATION).toContain("perform tci.require_role('admin', 'sales');")
    expect([...OFFER_WRITERS]).toEqual(['admin', 'sales', 'commercial_underwriter'])
    expect([...OFFER_PUBLISHERS]).toEqual(['admin', 'sales'])
    expect(canWriteOffers(['commercial_underwriter'])).toBe(true)
    expect(canPublishOffers(['commercial_underwriter'])).toBe(false)
    expect(canWriteOffers(['credit_underwriter'])).toBe(false)
    expect(canPublishOffers(['client'])).toBe(false)
  })

  it('editing needs a live offer and an offer step', () => {
    expect(canEdit({ status: 'published', request_status: 'client_review' })).toBe(true)
    expect(canEdit({ status: 'changes_requested', request_status: 'sales_confirmation' })).toBe(true)
    expect(canEdit({ status: 'accepted', request_status: 'accepted' })).toBe(false)
    expect(canEdit({ status: 'draft', request_status: 'bound' })).toBe(false)
  })

  it('publish is refused for the reasons publish_offer refuses', () => {
    expect(MIGRATION).toContain("raise exception 'offer_nothing_new: the latest version is already published'")
    expect(MIGRATION).toContain("if v_request.status = 'sales_confirmation' then\n    perform tci.advance_insurance_request(v_request.id, 'client_review', null);")
    const base = { status: 'draft' as const, request_status: 'sales_confirmation', current_version_no: 1, published_version_no: null }
    expect(publishBlocker(base, '2026-11-01', '2026-10-22')).toBeNull()
    expect(publishBlocker({ ...base, request_status: 'commercial_review' }, '2026-11-01', '2026-10-22')).toBe('request_step')
    expect(publishBlocker(base, '2026-10-01', '2026-10-22')).toBe('expired_version')
    expect(
      publishBlocker({ ...base, status: 'published', request_status: 'client_review', published_version_no: 1 }, '2026-11-01', '2026-10-22'),
    ).toBe('nothing_new')
    // a newer version may be published over the one the client sees
    expect(
      publishBlocker(
        { ...base, status: 'viewed', request_status: 'client_review', current_version_no: 2, published_version_no: 1 },
        '2026-11-01',
        '2026-10-22',
      ),
    ).toBeNull()
    expect(publishBlocker({ ...base, status: 'accepted' }, '2026-11-01', '2026-10-22')).toBe('closed')
  })

  it('the client accepts only an open offer in date, and may ask for changes after expiry', () => {
    expect(MIGRATION).toContain("v_offer := tci.client_open_offer(p_offer_id, false);")
    expect(MIGRATION).toContain("v_offer := tci.client_open_offer(p_offer_id, true);")
    expect(clientCanAccept('viewed')).toBe(true)
    expect(clientCanAccept('expired')).toBe(false)
    expect(clientCanRequestChanges('expired')).toBe(true)
    expect(clientCanRequestChanges('accepted')).toBe(false)
    expect(clientCanRequestChanges('withdrawn')).toBe(false)
  })

  it('accepting the offer IS the submission step', () => {
    expect(MIGRATION).toContain(
      "perform tci.client_respond_to_submission(v_offer.insurance_request_id, 'accept', null);",
    )
    expect(MIGRATION).toContain(
      "perform tci.client_respond_to_submission(v_offer.insurance_request_id, 'request_changes', btrim(p_comment));",
    )
  })
})

describe('helpers', () => {
  it('names a version relative to what the client sees', () => {
    expect(versionState(3, null)).toBe('unpublished')
    expect(versionState(2, 2)).toBe('published')
    expect(versionState(1, 2)).toBe('superseded')
    expect(versionState(3, 2)).toBe('unpublished')
  })

  it('defaults to a 30-day validity like create_commercial_offer', () => {
    expect(MIGRATION).toContain('v_until   date := coalesce(p_valid_until, tci.offer_today() + 30);')
    expect(addDays('2026-10-22', 30)).toBe('2026-11-21')
    expect(addDays('2026-12-15', 30)).toBe('2027-01-14')
  })

  it('cleans the PDF title for a file name', () => {
    expect(offerDocumentTitle('KP-2026-0001', 'ООО "Тест/Альфа"\n')).toBe('KP-2026-0001 — ООО ТестАльфа')
  })

  it('stores parameters that tci.offer_texts_ok accepts: an object of at most 256 KB', () => {
    expect(MIGRATION).toContain(
      "as $$ select p is not null and jsonb_typeof(p) = 'object' and octet_length(p::text) <= 262144 $$;",
    )
    for (const p of [defaultOfferParams(), paramsForSave({ cover: 'blue', note: 'я'.repeat(NOTE_MAX * 3) })]) {
      expect(typeof p === 'object' && p !== null && !Array.isArray(p)).toBe(true)
      expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThanOrEqual(262144)
    }
  })
})
