/**
 * The tour progress kept on the server (0098, tci.user_profiles.ui_tour_state)
 * and the rule for what starts by itself after sign-in. Pure; state.test.ts
 * mirrors the migration's check against its text.
 *
 *   * The ACTING role's tour starts when the person has no record of it — on
 *     the first sign-in, and the first time they act in a role they had not
 *     toured. Completed or skipped, it never starts by itself again, on any
 *     device: the record is on the server.
 *   * A «What's new» tour starts once for the people who were here BEFORE its
 *     release — their first recorded tour is older than the release date —
 *     and only when it is newer than every release they have a record of. A
 *     newcomer (no record at all) gets the role tour only.
 */

import type { UserRole } from '../../lib/roles'
import { RELEASE_TOURS, tourForRole } from './registry'
import type { ReleaseTour, Tour, TourRecord, TourState } from './types'

/** A tour id, as 0098's check accepts it. */
export const TOUR_ID_PATTERN = /^[a-z0-9][a-z0-9_.:-]{0,63}$/

export const TOUR_STATUSES = ['completed', 'skipped'] as const

function isRecord(value: unknown): value is TourRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const r = value as Record<string, unknown>
  return (
    (TOUR_STATUSES as readonly unknown[]).includes(r.status) &&
    typeof r.last_step === 'number' &&
    Number.isInteger(r.last_step) &&
    r.last_step >= 0 &&
    typeof r.at === 'string'
  )
}

/** The column as read; anything malformed is left out (never trusted). */
export function parseTourState(value: unknown): TourState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, TourRecord> = {}
  for (const [id, record] of Object.entries(value as Record<string, unknown>)) {
    if (TOUR_ID_PATTERN.test(id) && isRecord(record)) out[id] = { status: record.status, last_step: record.last_step, at: record.at }
  }
  return out
}

/** The state with one tour's outcome recorded (replacing an older one). */
export function recordTour(state: TourState, id: string, status: TourRecord['status'], lastStep: number, at: Date): TourState {
  return { ...state, [id]: { status, last_step: Math.max(0, Math.trunc(lastStep)), at: at.toISOString() } }
}

/** «2026.11» < «2026.12» < «2027.1»: numeric parts, left to right. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

function forAudience(release: ReleaseTour, role: UserRole): boolean {
  if (release.audience === 'all') return true
  return release.audience === (role === 'client' ? 'client' : 'staff')
}

/** The «What's new» tours due for this person, oldest first. */
export function pendingReleases(state: TourState, role: UserRole, releases: readonly ReleaseTour[] = RELEASE_TOURS): ReleaseTour[] {
  const records = Object.values(state)
  if (!records.length) return []
  const firstSeen = records.map((r) => r.at.slice(0, 10)).sort()[0]!
  const seenVersions = releases.filter((r) => state[r.id]).map((r) => r.version)
  const newest = seenVersions.sort(compareVersions).at(-1)
  return releases
    .filter((r) => forAudience(r, role))
    .filter((r) => !state[r.id])
    .filter((r) => firstSeen < r.date)
    .filter((r) => newest === undefined || compareVersions(r.version, newest) > 0)
    .sort((a, b) => compareVersions(a.version, b.version))
}

/** What starts by itself after sign-in, in order (empty: nothing). */
export function pendingTours(state: TourState, role: UserRole | null, releases: readonly ReleaseTour[] = RELEASE_TOURS): Tour[] {
  if (!role) return []
  const own = tourForRole(role)
  const queue: Tour[] = []
  if (own && !state[own.id]) queue.push(own)
  queue.push(...pendingReleases(state, role, releases))
  return queue
}

/** Does the browser's location already show this step's route? The path must
 * be equal and every query parameter the route names must hold its value. */
export function routeMatches(route: string, pathname: string, search: string): boolean {
  const target = new URL(route, 'http://tour.invalid')
  if (target.pathname !== pathname) return false
  const current = new URLSearchParams(search)
  for (const [key, value] of target.searchParams) if (current.get(key) !== value) return false
  return true
}

/** «Step n of N», counting only the steps that were not skipped. */
export function stepPosition(index: number, total: number, skipped: ReadonlySet<number>): { n: number; of: number } {
  let before = 0
  for (const i of skipped) if (i < index) before++
  return { n: index - before + 1, of: Math.max(1, total - skipped.size) }
}
