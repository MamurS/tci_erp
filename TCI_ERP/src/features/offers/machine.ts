/**
 * The offer rules the screens need to grey out a button — a mirror of
 * migration 0058, locked to its text by machine.test.ts. The database is what
 * refuses; this only decides what to offer.
 */

import type { UserRole } from '../../lib/roles'
import type { EffectiveOfferStatus, OfferRow, OfferStatus } from './model'

/** tci.offer_today(): the calendar day in Tashkent. */
export function offerToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tashkent',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** tci.offer_effective_status: an offer out with the client whose last valid
 * day has passed reads 'expired'. */
export function effectiveStatus(status: OfferStatus, validUntil: string, today: string = offerToday()): EffectiveOfferStatus {
  return (status === 'published' || status === 'viewed') && validUntil < today ? 'expired' : status
}

/** tci.offer_is_live: can still be edited, (re)published or withdrawn. */
export const LIVE_STATUSES: readonly OfferStatus[] = ['draft', 'published', 'viewed', 'changes_requested']
export function isLive(status: OfferStatus): boolean {
  return LIVE_STATUSES.includes(status)
}

/** tci.offer_request_status_ok: the submission steps an offer is prepared in. */
export const OFFER_REQUEST_STATUSES = ['commercial_review', 'sales_confirmation', 'client_review'] as const
export function requestAllowsOffer(requestStatus: string): boolean {
  return (OFFER_REQUEST_STATUSES as readonly string[]).includes(requestStatus)
}

/** create_commercial_offer / save_offer_version: require_role('sales', 'commercial_underwriter') (0065). */
export const OFFER_WRITERS: readonly UserRole[] = ['sales', 'commercial_underwriter']
/** publish_offer / withdraw_offer: require_role('sales') (0065). */
export const OFFER_PUBLISHERS: readonly UserRole[] = ['sales']

const holds = (roles: readonly UserRole[], allowed: readonly UserRole[]) => roles.some((r) => allowed.includes(r))
export const canWriteOffers = (roles: readonly UserRole[]) => holds(roles, OFFER_WRITERS)
export const canPublishOffers = (roles: readonly UserRole[]) => holds(roles, OFFER_PUBLISHERS)

/** Edit = save a new version: the offer is live and the submission still at
 * an offer step. */
export function canEdit(offer: Pick<OfferRow, 'status' | 'request_status'>): boolean {
  return isLive(offer.status) && requestAllowsOffer(offer.request_status)
}

/** Why publish is not offered, or null when it is. Mirrors publish_offer. */
export type PublishBlocker = 'closed' | 'nothing_new' | 'request_step' | 'expired_version'
export function publishBlocker(
  offer: Pick<OfferRow, 'status' | 'request_status' | 'current_version_no' | 'published_version_no'>,
  latestValidUntil: string | null,
  today: string = offerToday(),
): PublishBlocker | null {
  if (!isLive(offer.status)) return 'closed'
  if ((offer.status === 'published' || offer.status === 'viewed') && offer.published_version_no === offer.current_version_no) {
    return 'nothing_new'
  }
  if (latestValidUntil !== null && latestValidUntil < today) return 'expired_version'
  if (offer.request_status !== 'sales_confirmation' && offer.request_status !== 'client_review') return 'request_step'
  return null
}

/** What a version row is, relative to what the client sees. */
export type VersionState = 'published' | 'superseded' | 'unpublished'
export function versionState(versionNo: number, publishedVersionNo: number | null): VersionState {
  if (publishedVersionNo === null || versionNo > publishedVersionNo) return 'unpublished'
  return versionNo === publishedVersionNo ? 'published' : 'superseded'
}

/** The client may accept while the offer is out with them and in date;
 * asking for changes is allowed after expiry too (client_open_offer). */
export function clientCanAccept(status: EffectiveOfferStatus): boolean {
  return status === 'published' || status === 'viewed'
}
export function clientCanRequestChanges(status: EffectiveOfferStatus): boolean {
  return status === 'published' || status === 'viewed' || status === 'expired'
}

export type Tone = 'neutral' | 'accent' | 'pos' | 'warn' | 'neg'
export function statusTone(status: EffectiveOfferStatus): Tone {
  switch (status) {
    case 'published':
    case 'viewed':
      return 'accent'
    case 'accepted':
      return 'pos'
    case 'changes_requested':
      return 'warn'
    case 'expired':
    case 'declined':
      return 'neg'
    default:
      return 'neutral'
  }
}

/** Default validity: 30 days (create_commercial_offer's default). */
export const DEFAULT_VALIDITY_DAYS = 30

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** «KP-2026-0001 — Client» for the PDF title, cleaned for a file name. */
export function offerDocumentTitle(number: string, clientName: string): string {
  const clean = (s: string) =>
    s
      // eslint-disable-next-line no-control-regex -- stripping control characters on purpose
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  return `${clean(number)} — ${clean(clientName)}`.slice(0, 150).trim()
}
