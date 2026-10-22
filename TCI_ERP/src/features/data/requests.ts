/**
 * The rules of a data request, mirrored from migration 0054 so the screen
 * only offers what tci.resolve_entity_request will accept. The database is
 * what enforces; requests.test.ts locks this mirror to the migration text.
 */
import type { RequestKind, RequestStatus } from './types'

export const OPEN_STATUSES: readonly RequestStatus[] = ['new', 'in_progress']

export function isOpen(status: RequestStatus): boolean {
  return OPEN_STATUSES.includes(status)
}

export type Outcome = 'created' | 'linked' | 'updated' | 'rejected'

/** How each kind of request may end. */
export const OUTCOMES: Readonly<Record<RequestKind, readonly Outcome[]>> = {
  new_company: ['created', 'linked', 'rejected'],
  statements_update: ['updated', 'rejected'],
}

/** Who works requests: information managers and admins. */
export function canWorkRequests(roles: readonly string[]): boolean {
  return roles.includes('information_manager') || roles.includes('admin')
}

export const STATUS_TONE: Readonly<Record<RequestStatus, 'neutral' | 'accent' | 'pos' | 'warn' | 'neg'>> = {
  new: 'warn',
  in_progress: 'accent',
  created: 'pos',
  linked: 'pos',
  updated: 'pos',
  rejected: 'neutral',
}

/** Business days are not counted: the Agenda task is due two days after it
 * opens (0054), and this is the same clock for the queue's age column. */
export const DUE_AFTER_HOURS = 48
